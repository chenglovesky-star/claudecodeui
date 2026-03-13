/**
 * FILE TRACKING SERVICE
 * =====================
 * Monitors file changes in project directories using chokidar + periodic git diff.
 * Emits file:change events via EventBus for real-time team collaboration awareness.
 */

import path from 'path';
import { execSync } from 'child_process';
import EventBus from './EventBus.js';

const THROTTLE_MS = 2000; // Same file change throttle
const GIT_DIFF_INTERVAL = 30000; // 30 seconds
const THROTTLE_MAP_CLEANUP_INTERVAL = 60000; // 1 minute
const MAX_BUFFER = 1024 * 1024; // 1 MB max output for execSync
const IGNORED_PATTERNS = [
    '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**',
    '**/*.log', '**/.DS_Store', '**/*.swp', '**/*.tmp',
    '**/coverage/**', '**/.next/**', '**/.nuxt/**',
];

let instance = null;

export default class FileTrackingService {
    constructor() {
        if (instance) return instance;
        /** @type {Map<string, TrackedProject>} projectPath → tracking info */
        this.tracked = new Map();
        instance = this;
    }

    static getInstance() {
        if (!instance) {
            new FileTrackingService();
        }
        return instance;
    }

    /**
     * Start tracking file changes for a project.
     * @param {string} projectPath
     * @param {number} teamId
     * @param {number} userId - session owner
     * @param {string} sessionId
     */
    async startTracking(projectPath, teamId, userId, sessionId) {
        const key = projectPath;

        // If already tracked, just add the session reference
        if (this.tracked.has(key)) {
            const info = this.tracked.get(key);
            info.sessions.set(sessionId, { userId, teamId });
            return;
        }

        const chokidar = (await import('chokidar')).default;

        const info = {
            projectPath,
            teamId,
            sessions: new Map([[sessionId, { userId, teamId }]]),
            watcher: null,
            gitDiffTimer: null,
            /** @type {Map<string, number>} filePath → last emit timestamp */
            throttleMap: new Map(),
            /** @type {Set<string>} current modified files from git diff */
            gitModifiedFiles: new Set(),
        };

        // Start chokidar watcher
        info.watcher = chokidar.watch(projectPath, {
            ignored: IGNORED_PATTERNS,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        });

        const emitChange = (filePath, action) => {
            const relativePath = path.relative(projectPath, filePath);
            const now = Date.now();

            // Throttle: same file within THROTTLE_MS
            const lastEmit = info.throttleMap.get(relativePath) || 0;
            if (now - lastEmit < THROTTLE_MS) return;
            info.throttleMap.set(relativePath, now);

            // Find the userId from active sessions (use first session's user)
            let changeUserId = userId;
            for (const [, sess] of info.sessions) {
                changeUserId = sess.userId;
                break;
            }

            const eventBus = EventBus.getInstance();
            eventBus.emit('file:change', {
                teamId,
                userId: changeUserId,
                sessionId,
                filePath: relativePath,
                action,
                projectPath,
                timestamp: new Date().toISOString(),
            });
        };

        info.watcher
            .on('change', (fp) => emitChange(fp, 'modified'))
            .on('add', (fp) => emitChange(fp, 'created'))
            .on('unlink', (fp) => emitChange(fp, 'deleted'));

        // Periodic git diff calibration
        info.gitDiffTimer = setInterval(() => {
            this._runGitDiff(key);
        }, GIT_DIFF_INTERVAL);

        // Periodic throttleMap cleanup to prevent memory leak
        info.throttleCleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [fp, ts] of info.throttleMap) {
                if (now - ts > THROTTLE_MS * 5) info.throttleMap.delete(fp);
            }
        }, THROTTLE_MAP_CLEANUP_INTERVAL);

        // Initial git diff
        this._runGitDiff(key);

        this.tracked.set(key, info);
        console.log(`[FileTracking] Started tracking: ${projectPath}`);
    }

    /**
     * Stop tracking for a specific session. If no sessions remain, close watcher.
     */
    stopTracking(projectPath, sessionId) {
        const info = this.tracked.get(projectPath);
        if (!info) return;

        info.sessions.delete(sessionId);

        if (info.sessions.size === 0) {
            // No more sessions for this project — clean up
            if (info.watcher) {
                info.watcher.close().catch(() => { /* ignore close errors */ });
            }
            if (info.gitDiffTimer) {
                clearInterval(info.gitDiffTimer);
            }
            if (info.throttleCleanupTimer) {
                clearInterval(info.throttleCleanupTimer);
            }
            info.throttleMap.clear();
            this.tracked.delete(projectPath);
            console.log(`[FileTracking] Stopped tracking: ${projectPath}`);
        }
    }

    /**
     * Get currently modified files for a project (from git diff).
     */
    getModifiedFiles(projectPath) {
        const info = this.tracked.get(projectPath);
        return info ? Array.from(info.gitModifiedFiles) : [];
    }

    /**
     * Get all tracked projects' file activities grouped by user.
     * @returns {Array<{userId, files: Array<{path, action, lastModified}>}>}
     */
    getTeamFileActivities(teamId) {
        const userFiles = new Map();

        for (const [, info] of this.tracked) {
            if (info.teamId !== teamId) continue;

            for (const [, sess] of info.sessions) {
                if (!userFiles.has(sess.userId)) {
                    userFiles.set(sess.userId, []);
                }
                // Add git diff files as "modified"
                for (const fp of info.gitModifiedFiles) {
                    userFiles.get(sess.userId).push({
                        path: fp,
                        action: 'modified',
                        projectPath: info.projectPath,
                    });
                }
            }
        }

        const result = [];
        for (const [uid, files] of userFiles) {
            result.push({ userId: uid, files });
        }
        return result;
    }

    /** @private */
    _runGitDiff(key) {
        const info = this.tracked.get(key);
        if (!info) return;

        try {
            const output = execSync('git diff --name-only', {
                cwd: info.projectPath,
                encoding: 'utf-8',
                timeout: 5000,
                maxBuffer: MAX_BUFFER,
            }).trim();

            const newFiles = new Set(
                output ? output.split('\n').map(f => f.trim()).filter(Boolean) : []
            );

            // Also include untracked files
            try {
                const untrackedOutput = execSync('git ls-files --others --exclude-standard', {
                    cwd: info.projectPath,
                    encoding: 'utf-8',
                    timeout: 5000,
                    maxBuffer: MAX_BUFFER,
                }).trim();
                if (untrackedOutput) {
                    for (const f of untrackedOutput.split('\n')) {
                        const trimmed = f.trim();
                        if (trimmed) newFiles.add(trimmed);
                    }
                }
            } catch {
                // Ignore untracked file errors
            }

            info.gitModifiedFiles = newFiles;
        } catch {
            // git diff failed — repo might not have commits or not a git repo
        }
    }
}
