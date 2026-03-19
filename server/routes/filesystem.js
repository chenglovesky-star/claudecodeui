import express from 'express';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { WORKSPACES_ROOT, validateWorkspacePath } from './projects.js';

const router = express.Router();

const expandWorkspacePath = (inputPath, userWorkspaceRoot) => {
    const root = userWorkspaceRoot || WORKSPACES_ROOT;
    if (!inputPath) return root;
    if (inputPath === '~') {
        return root;
    }
    if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
        return path.join(root, inputPath.slice(2));
    }
    return inputPath;
};

async function getFileTree(dirPath, maxDepth = 3, currentDepth = 0, showHidden = true) {
    const items = [];

    try {
        const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            // Skip heavy build directories and VCS directories
            if (entry.name === 'node_modules' ||
                entry.name === 'dist' ||
                entry.name === 'build' ||
                entry.name === '.git' ||
                entry.name === '.svn' ||
                entry.name === '.hg') continue;

            const itemPath = path.join(dirPath, entry.name);
            const item = {
                name: entry.name,
                path: itemPath,
                type: entry.isDirectory() ? 'directory' : 'file'
            };

            if (entry.isDirectory() && currentDepth < maxDepth) {
                try {
                    await fsPromises.access(item.path, fs.constants.R_OK);
                    item.children = await getFileTree(item.path, maxDepth, currentDepth + 1, showHidden);
                } catch (e) {
                    item.children = [];
                }
            }

            items.push(item);
        }
    } catch (error) {
        if (error.code !== 'EACCES' && error.code !== 'EPERM') {
            console.error('Error reading directory:', error);
        }
    }

    return items.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}

// Browse filesystem endpoint for project suggestions
router.get('/browse-filesystem', async (req, res) => {
    try {
        const { path: dirPath } = req.query;

        const userRoot = req.user && req.user.workspaceRoot ? req.user.workspaceRoot : WORKSPACES_ROOT;
        console.log('[API] Browse filesystem request for path:', dirPath);
        console.log('[API] User workspace root is:', userRoot);
        // Default to user's workspace directory if no path provided
        const defaultRoot = userRoot;
        let targetPath = dirPath ? expandWorkspacePath(dirPath, userRoot) : defaultRoot;

        // Resolve and normalize the path
        targetPath = path.resolve(targetPath);

        // Ensure user workspace directory exists
        try {
            await fs.promises.mkdir(userRoot, { recursive: true });
        } catch (mkdirErr) {
            // Ignore if already exists or cannot create
        }

        // Security check - ensure path is within allowed workspace root
        const validation = await validateWorkspacePath(targetPath, userRoot);
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }
        const resolvedPath = validation.resolvedPath || targetPath;

        // Security check - ensure path is accessible
        try {
            await fs.promises.access(resolvedPath);
            const stats = await fs.promises.stat(resolvedPath);

            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Path is not a directory' });
            }
        } catch (err) {
            return res.status(404).json({ error: 'Directory not accessible' });
        }

        // Use getFileTree with shallow depth (only direct children)
        const fileTree = await getFileTree(resolvedPath, 1, 0, false); // maxDepth=1, showHidden=false

        // Filter only directories and format for suggestions
        const directories = fileTree
            .filter(item => item.type === 'directory')
            .map(item => ({
                path: item.path,
                name: item.name,
                type: 'directory'
            }))
            .sort((a, b) => {
                const aHidden = a.name.startsWith('.');
                const bHidden = b.name.startsWith('.');
                if (aHidden && !bHidden) return 1;
                if (!aHidden && bHidden) return -1;
                return a.name.localeCompare(b.name);
            });

        // Add common directories if browsing home directory
        const suggestions = [];
        let resolvedWorkspaceRoot = defaultRoot;
        try {
            resolvedWorkspaceRoot = await fsPromises.realpath(defaultRoot);
        } catch (error) {
            // Use default root as-is if realpath fails
        }
        if (resolvedPath === resolvedWorkspaceRoot) {
            const commonDirs = ['Desktop', 'Documents', 'Projects', 'Development', 'Dev', 'Code', 'workspace'];
            const existingCommon = directories.filter(dir => commonDirs.includes(dir.name));
            const otherDirs = directories.filter(dir => !commonDirs.includes(dir.name));

            suggestions.push(...existingCommon, ...otherDirs);
        } else {
            suggestions.push(...directories);
        }

        res.json({
            path: resolvedPath,
            suggestions: suggestions
        });

    } catch (error) {
        console.error('Error browsing filesystem:', error);
        res.status(500).json({ error: 'Failed to browse filesystem' });
    }
});

// Create folder endpoint
router.post('/create-folder', async (req, res) => {
    try {
        const { path: folderPath } = req.body;
        if (!folderPath) {
            return res.status(400).json({ error: 'Path is required' });
        }
        const userRoot = req.user && req.user.workspaceRoot ? req.user.workspaceRoot : WORKSPACES_ROOT;
        // Ensure user workspace directory exists
        try {
            await fs.promises.mkdir(userRoot, { recursive: true });
        } catch (mkdirErr) {
            // Ignore if already exists or cannot create
        }
        const expandedPath = expandWorkspacePath(folderPath, userRoot);
        const resolvedInput = path.resolve(expandedPath);
        const validation = await validateWorkspacePath(resolvedInput, userRoot);
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }
        const targetPath = validation.resolvedPath || resolvedInput;
        const parentDir = path.dirname(targetPath);
        try {
            await fs.promises.access(parentDir);
        } catch (err) {
            return res.status(404).json({ error: 'Parent directory does not exist' });
        }
        try {
            await fs.promises.access(targetPath);
            return res.status(409).json({ error: 'Folder already exists' });
        } catch (err) {
            // Folder doesn't exist, which is what we want
        }
        try {
            await fs.promises.mkdir(targetPath, { recursive: false });
            res.json({ success: true, path: targetPath });
        } catch (mkdirError) {
            if (mkdirError.code === 'EEXIST') {
                return res.status(409).json({ error: 'Folder already exists' });
            }
            throw mkdirError;
        }
    } catch (error) {
        console.error('Error creating folder:', error);
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

export default router;
