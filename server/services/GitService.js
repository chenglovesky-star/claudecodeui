/**
 * GIT SERVICE
 * ===========
 * Git repository validation and info retrieval for team projects.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const EXEC_TIMEOUT = 5000; // 5s timeout for local git commands
const HEAVY_EXEC_TIMEOUT = 10000; // 10s timeout for heavier git commands (log, ls-tree on large repos)
const NETWORK_EXEC_TIMEOUT = 15000; // 15s timeout for network-dependent commands (gh CLI)

function gitExec(cmd, cwd, timeout = EXEC_TIMEOUT) {
    return execSync(cmd, { cwd, timeout, encoding: 'utf-8' }).trim();
}

/**
 * Validate that a path is a valid Git repository.
 * Includes path traversal protection (Task 1.4).
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateGitRepo(repoPath) {
    // Path existence check
    if (!repoPath || typeof repoPath !== 'string') {
        return { valid: false, error: '仓库路径不能为空' };
    }

    // Resolve and normalize path
    const resolved = path.resolve(repoPath);

    // Path safety: must be absolute and not contain traversal sequences after resolution
    if (resolved !== path.normalize(repoPath) && !path.isAbsolute(repoPath)) {
        return { valid: false, error: '无效的 Git 仓库路径' };
    }

    // Block sensitive system directories
    const blockedPrefixes = ['/etc', '/var', '/usr', '/sys', '/proc', '/dev', '/boot', '/root'];
    if (blockedPrefixes.some(prefix => resolved === prefix || resolved.startsWith(prefix + '/'))) {
        return { valid: false, error: '无效的 Git 仓库路径' };
    }

    if (!fs.existsSync(resolved)) {
        return { valid: false, error: '无效的 Git 仓库路径' };
    }

    // Resolve symlinks and verify the real path matches expectations
    let realPath;
    try {
        realPath = fs.realpathSync(resolved);
    } catch {
        return { valid: false, error: '无效的 Git 仓库路径' };
    }

    if (blockedPrefixes.some(prefix => realPath === prefix || realPath.startsWith(prefix + '/'))) {
        return { valid: false, error: '无效的 Git 仓库路径' };
    }

    const stat = fs.statSync(realPath);
    if (!stat.isDirectory()) {
        return { valid: false, error: '无效的 Git 仓库路径' };
    }

    // Check it's a git work tree
    try {
        const result = gitExec('git rev-parse --is-inside-work-tree', realPath);
        if (result !== 'true') {
            return { valid: false, error: '无效的 Git 仓库路径' };
        }
    } catch {
        return { valid: false, error: '无效的 Git 仓库路径' };
    }

    return { valid: true };
}

/**
 * Get basic info about a Git repository.
 * @returns {{ currentBranch: string, remoteUrl: string|null, lastCommit: string|null }}
 */
export function getRepoInfo(repoPath) {
    const resolved = path.resolve(repoPath);
    let currentBranch = 'main';
    let remoteUrl = null;
    let lastCommit = null;

    try {
        currentBranch = gitExec('git rev-parse --abbrev-ref HEAD', resolved);
    } catch {
        // No commits yet or detached HEAD
    }

    try {
        remoteUrl = gitExec('git remote get-url origin', resolved);
    } catch {
        // No remote configured
    }

    try {
        lastCommit = gitExec('git log -1 --format=%H||%s||%ai||%an', resolved);
    } catch {
        // No commits
    }

    return { currentBranch, remoteUrl, lastCommit };
}

/**
 * Get all branches for a repository.
 * @returns {{ branches: Array, currentBranch: string }}
 */
export function getBranches(repoPath) {
    const resolved = path.resolve(repoPath);
    let currentBranch = 'main';

    try {
        currentBranch = gitExec('git rev-parse --abbrev-ref HEAD', resolved);
    } catch {
        // detached or no commits
    }

    const branches = [];
    try {
        const output = gitExec(
            'git branch -a --format=%(refname:short)|%(objectname:short)|%(authorname)|%(committerdate:iso)',
            resolved
        );
        for (const line of output.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const [name, shortHash, author, date] = trimmed.split('|');
            if (!name) continue;
            // Skip HEAD pointer refs like origin/HEAD
            if (name.endsWith('/HEAD')) continue;
            branches.push({
                name,
                shortHash: shortHash || '',
                author: author || '',
                lastCommitDate: date || '',
                isCurrent: name === currentBranch,
                isRemote: name.startsWith('origin/')
            });
        }
    } catch {
        // No branches or git error
    }

    return { branches, currentBranch };
}

/**
 * Get pull requests using gh CLI (GitHub) with graceful fallback.
 * @returns {{ pullRequests: Array, remoteType: string|null, error?: string }}
 */
export function getPullRequests(repoPath) {
    const resolved = path.resolve(repoPath);

    // Detect remote type
    let remoteUrl = null;
    try {
        remoteUrl = gitExec('git remote get-url origin', resolved);
    } catch {
        return { pullRequests: [], remoteType: null, error: '无远程仓库' };
    }

    const isGitHub = remoteUrl.includes('github.com');

    if (isGitHub) {
        try {
            const output = gitExec(
                'gh pr list --json number,title,state,author,createdAt --limit 20',
                resolved,
                NETWORK_EXEC_TIMEOUT
            );
            const prs = JSON.parse(output).map(pr => ({
                number: pr.number,
                title: pr.title,
                state: pr.state,
                author: pr.author?.login || '',
                createdAt: pr.createdAt
            }));
            return { pullRequests: prs, remoteType: 'github' };
        } catch {
            return { pullRequests: [], remoteType: 'github', error: '需要安装 gh CLI 并登录' };
        }
    }

    return { pullRequests: [], remoteType: 'other', error: '仅支持 GitHub PR 查询' };
}

/**
 * Get file tree for a repository at a given ref.
 * @returns {{ tree: Array<{name, type, path, children?}>, ref: string }}
 */
export function getFileTree(repoPath, ref = 'HEAD') {
    const resolved = path.resolve(repoPath);

    // Sanitize ref: only allow safe git ref characters, block anything starting with '-'
    const safeRef = ref.replace(/[^a-zA-Z0-9_\-/.~^]/g, '');
    if (!safeRef || safeRef.startsWith('-') || safeRef.includes('..')) return { tree: [], ref: 'HEAD' };

    let actualRef = safeRef;
    try {
        // Verify the ref exists — use '--' to prevent ref being interpreted as a flag
        gitExec(`git rev-parse --verify -- ${safeRef}`, resolved);
    } catch {
        actualRef = 'HEAD';
    }

    const MAX_FILES = 5000;
    const files = [];
    try {
        const output = gitExec(`git ls-tree -r --name-only -- ${actualRef}`, resolved, HEAVY_EXEC_TIMEOUT);
        for (const line of output.split('\n')) {
            const trimmed = line.trim();
            if (trimmed) {
                files.push(trimmed);
                if (files.length >= MAX_FILES) break;
            }
        }
    } catch {
        return { tree: [], ref: actualRef };
    }

    // Convert flat file list to tree structure
    const root = [];
    const dirMap = new Map();

    for (const filePath of files) {
        const parts = filePath.split('/');
        let currentLevel = root;
        let currentPath = '';

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const isFile = i === parts.length - 1;

            if (isFile) {
                currentLevel.push({ name: part, type: 'file', path: currentPath });
            } else {
                if (!dirMap.has(currentPath)) {
                    const dir = { name: part, type: 'directory', path: currentPath, children: [] };
                    currentLevel.push(dir);
                    dirMap.set(currentPath, dir);
                }
                currentLevel = dirMap.get(currentPath).children;
            }
        }
    }

    // Sort: directories first, then files, alphabetically
    const sortTree = (nodes) => {
        nodes.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        for (const node of nodes) {
            if (node.children) sortTree(node.children);
        }
    };
    sortTree(root);

    return { tree: root, ref: actualRef };
}

/**
 * Get commit log for a repository.
 * @returns {{ commits: Array<{hash, shortHash, message, author, email, date}>, total: number }}
 */
export function getCommitLog(repoPath, limit = 20, offset = 0) {
    const resolved = path.resolve(repoPath);
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 20), 100);
    const safeOffset = Math.max(0, parseInt(offset) || 0);

    const SEP = '\x1f'; // ASCII Unit Separator — safe delimiter unlikely to appear in commit messages
    const commits = [];
    try {
        const output = gitExec(
            `git log --format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%ci --skip=${safeOffset} -n ${safeLimit}`,
            resolved,
            HEAVY_EXEC_TIMEOUT
        );
        for (const line of output.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parts = trimmed.split(SEP);
            if (parts.length < 6) continue;
            const [hash, shortHash, message, author, email, date] = parts;
            if (!hash) continue;
            commits.push({ hash, shortHash, message: message || '', author: author || '', email: email || '', date: date || '' });
        }
    } catch {
        // No commits or error
    }

    let total = 0;
    try {
        const countOutput = gitExec('git rev-list --count HEAD', resolved, HEAVY_EXEC_TIMEOUT);
        total = parseInt(countOutput) || 0;
    } catch {
        // No commits
    }

    return { commits, total };
}
