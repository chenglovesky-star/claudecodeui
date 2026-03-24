import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Determine install mode (git clone vs npm install)
// routes/ -> server/ -> project root
const projectRoot = path.join(__dirname, '..', '..');
const installMode = fs.existsSync(path.join(projectRoot, '.git')) ? 'git' : 'npm';

// System update endpoint
router.post('/update', async (req, res) => {
    try {
        console.log('Starting system update from directory:', projectRoot);

        // Run the update command based on install mode
        const updateCommand = installMode === 'git'
            ? 'git checkout main && git pull && npm install'
            : 'npm install -g @siteboon/claude-code-ui@latest';

        const child = spawn('sh', ['-c', updateCommand], {
            cwd: installMode === 'git' ? projectRoot : os.homedir(),
            env: process.env
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            console.log('Update output:', text);
        });

        child.stderr.on('data', (data) => {
            const text = data.toString();
            errorOutput += text;
            console.error('Update error:', text);
        });

        child.on('close', (code) => {
            if (code === 0) {
                res.json({
                    success: true,
                    output: output || 'Update completed successfully',
                    message: 'Update completed. Please restart the server to apply changes.'
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Update command failed',
                    output: output,
                    errorOutput: errorOutput
                });
            }
        });

        child.on('error', (error) => {
            console.error('Update process error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        });

    } catch (error) {
        console.error('System update error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/system/shell-presets
// Returns preset list (id + label only, no API keys) for the shell preset switcher.
// Reads from app root: /app/shell-presets.json (Docker) or project root (dev).
router.get('/shell-presets', async (req, res) => {
    try {
        const presetsPath = path.join(projectRoot, 'shell-presets.json');
        const raw = fs.readFileSync(presetsPath, 'utf-8');
        const presets = JSON.parse(raw);
        const safePresets = Array.isArray(presets)
            ? presets.map(p => ({ id: p.id, label: p.label }))
            : [];
        res.json({ presets: safePresets });
    } catch {
        res.json({ presets: [] });
    }
});

export default router;
