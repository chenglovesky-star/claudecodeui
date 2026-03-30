// server/shell-log-manager.js
import os from 'os';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';

const ANSI_ESCAPE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

function stripAnsi(text) {
  return text.replace(ANSI_ESCAPE_REGEX, '');
}

function formatTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

class ShellLogManager {
  constructor() {
    this.logsBaseDir = path.join(os.homedir(), '.claude', 'shell-logs');
    // Map of logId → { txtPath, metaPath, lineCount, projectName }
    this._openLogs = new Map();
  }

  /** 返回 userId 专属日志目录 */
  _userDir(userId) {
    const safeId = String(parseInt(userId, 10) || 0);
    return path.join(this.logsBaseDir, safeId);
  }

  /** 确保目录存在（同步，仅在 createLog 调用时） */
  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  createLog(projectPath, projectName, userId, sessionId, provider) {
    const userDir = this._userDir(userId);
    this._ensureDir(userDir);

    const ts = formatTimestamp();
    const safeSession = (sessionId || 'unknown').replace(/[^a-zA-Z0-9\-_]/g, '_').slice(0, 40);
    const logId = `${safeSession}_${ts}`;
    const txtPath = path.join(userDir, `${logId}.txt`);
    const metaPath = path.join(userDir, `${logId}.meta.json`);

    const meta = {
      id: logId,
      projectPath,
      projectName,
      userId,
      provider,
      startedAt: new Date().toISOString(),
      endedAt: null,
      lineCount: 0,
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    fs.writeFileSync(txtPath, '', 'utf8');

    this._openLogs.set(logId, { txtPath, metaPath, lineCount: 0, projectName });
    return logId;
  }

  appendLine(logId, rawText) {
    const entry = this._openLogs.get(logId);
    if (!entry) return;
    const clean = stripAnsi(rawText);
    if (!clean) return;
    try {
      fs.appendFileSync(entry.txtPath, clean, 'utf8');
      entry.lineCount += clean.split('\n').length;
    } catch {
      // non-fatal
    }
  }

  closeLog(logId) {
    const entry = this._openLogs.get(logId);
    if (!entry) return;
    try {
      const raw = fs.readFileSync(entry.metaPath, 'utf8');
      const meta = JSON.parse(raw);
      meta.endedAt = new Date().toISOString();
      meta.lineCount = entry.lineCount;
      fs.writeFileSync(entry.metaPath, JSON.stringify(meta, null, 2), 'utf8');
    } catch {
      // non-fatal
    }
    this._openLogs.delete(logId);
  }

  async getProjectLogs(projectName, userId) {
    const userDir = this._userDir(userId);
    try {
      await fsPromises.access(userDir);
    } catch {
      return [];
    }

    const files = await fsPromises.readdir(userDir);
    const metaFiles = files.filter(f => f.endsWith('.meta.json'));

    const results = [];
    for (const file of metaFiles) {
      try {
        const raw = await fsPromises.readFile(path.join(userDir, file), 'utf8');
        const meta = JSON.parse(raw);
        // projectName in URL is the encoded path (e.g. '-workspace-leicheng9')
        // meta.projectName stores path.basename (e.g. 'leicheng9')
        // also derive encoded form from stored projectPath for matching
        const encodedPath = meta.projectPath ? meta.projectPath.replace(/\//g, '-') : '';
        if (meta.projectName === projectName || encodedPath === projectName) {
          results.push(meta);
        }
      } catch {
        // skip corrupt meta
      }
    }

    results.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    return results;
  }

  async getLogContent(logId, userId) {
    const userDir = this._userDir(userId);
    const txtPath = path.join(userDir, `${logId}.txt`);
    if (!txtPath.startsWith(userDir + path.sep)) {
      return { content: '', lineCount: 0 };
    }
    try {
      const content = await fsPromises.readFile(txtPath, 'utf8');
      return { content, lineCount: content.split('\n').length };
    } catch {
      return { content: '', lineCount: 0 };
    }
  }

  closeAllLogs() {
    for (const [logId] of this._openLogs) {
      this.closeLog(logId);
    }
  }

  async deleteLog(logId, userId) {
    const userDir = this._userDir(userId);
    const txtPath = path.join(userDir, `${logId}.txt`);
    const metaPath = path.join(userDir, `${logId}.meta.json`);
    if (!txtPath.startsWith(userDir + path.sep)) {
      return;
    }
    await Promise.allSettled([
      fsPromises.unlink(txtPath),
      fsPromises.unlink(metaPath),
    ]);
    this._openLogs.delete(logId);
  }
}

export default new ShellLogManager();
