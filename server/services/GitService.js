/**
 * GIT SERVICE
 * ===========
 * Git repository validation and info retrieval for team projects.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const EXEC_TIMEOUT = 5000; // 5s timeout for git commands

function gitExec(cmd, cwd) {
    return execSync(cmd, { cwd, timeout: EXEC_TIMEOUT, encoding: 'utf-8' }).trim();
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
