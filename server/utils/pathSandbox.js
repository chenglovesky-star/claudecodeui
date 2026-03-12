/**
 * Path Sandbox — restricts destructive tool operations to the project directory.
 *
 * This module is independent of the permission layer: even when
 * `bypassPermissions` is true the sandbox still applies.
 */

import path from 'path';
import { promises as fs } from 'fs';
import { parse as parseShellCommand } from 'shell-quote';
import { FORBIDDEN_PATHS } from '../routes/projects.js';

// ─── Configuration ──────────────────────────────────────────────────────────

const SANDBOX_ENABLED = process.env.SANDBOX_ENABLED !== 'false'; // default: true

/** Comma-separated list of additional allowed absolute paths */
const SANDBOX_EXTRA_ALLOWED_PATHS = (process.env.SANDBOX_EXTRA_ALLOWED_PATHS || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

// ─── Destructive command detection ──────────────────────────────────────────

/** Bash commands that can destroy / modify files */
const DESTRUCTIVE_COMMANDS = new Set([
  'rm', 'rmdir', 'mv', 'shred', 'truncate',
  'chmod', 'chown', 'dd',
  'unlink',
]);

/** Tools whose `file_path` field must be within the project */
const FILE_PATH_TOOLS = new Set([
  'Write', 'Edit', 'MultiEdit',
]);

/** Read-only tools — always allowed */
const READONLY_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch',
  'Agent', 'TodoRead', 'TaskRead',
]);

/** Shell expansion patterns that prevent static analysis */
const SHELL_EXPANSION_RE = /\$\(|`|\$\{|(?:^|\s)eval\s/;

// ─── Path helpers ───────────────────────────────────────────────────────────

/**
 * Resolve a target path to its real absolute path.
 * If the file does not exist, walk up to the nearest existing ancestor
 * and resolve from there (prevents symlink escape via non-existent intermediaries).
 */
async function resolveRealPath(targetPath, projectDir) {
  const absolute = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(projectDir, targetPath);

  try {
    return await fs.realpath(absolute);
  } catch {
    // File doesn't exist — resolve nearest existing ancestor
    let dir = path.dirname(absolute);
    const tail = [path.basename(absolute)];

    while (dir !== path.dirname(dir)) {
      try {
        const realDir = await fs.realpath(dir);
        return path.join(realDir, ...tail);
      } catch {
        tail.unshift(path.basename(dir));
        dir = path.dirname(dir);
      }
    }
    // Fallback — root reached
    return path.join(dir, ...tail);
  }
}

/**
 * Check whether `targetPath` resides within `projectDir`.
 * Both paths are resolved through `realpath` to defeat symlink escapes.
 */
async function isPathWithinProject(targetPath, projectDir) {
  const realTarget = await resolveRealPath(targetPath, projectDir);
  const realProject = await resolveRealPath(projectDir, projectDir);

  // Exact match (operating on project root itself — allowed for some tools)
  if (realTarget === realProject) return true;

  // Must be a child path
  if (!realTarget.startsWith(realProject + path.sep)) return false;

  // Extra: reject if the resolved path lands in a FORBIDDEN_PATHS directory
  for (const forbidden of FORBIDDEN_PATHS) {
    if (realTarget === forbidden || realTarget.startsWith(forbidden + path.sep)) {
      // Allow /var/tmp and /var/folders (same logic as projects.js)
      if (forbidden === '/var' &&
          (realTarget.startsWith('/var/tmp') || realTarget.startsWith('/var/folders'))) {
        continue;
      }
      return false;
    }
  }

  return true;
}

/**
 * Check a path also against the extra-allowed list.
 */
async function isPathAllowed(targetPath, projectDir) {
  if (await isPathWithinProject(targetPath, projectDir)) return true;

  const realTarget = await resolveRealPath(targetPath, projectDir);
  for (const allowed of SANDBOX_EXTRA_ALLOWED_PATHS) {
    try {
      const realAllowed = await resolveRealPath(allowed, allowed);
      if (realTarget === realAllowed || realTarget.startsWith(realAllowed + path.sep)) {
        return true;
      }
    } catch {
      // ignore unresolvable extra paths
    }
  }

  return false;
}

// ─── Bash command analysis ──────────────────────────────────────────────────

/**
 * Split shell-quote tokens into sub-commands separated by operators.
 */
function splitSubCommands(tokens) {
  const commands = [];
  let current = [];
  for (const token of tokens) {
    if (typeof token === 'object' && token.op) {
      if (current.length) commands.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length) commands.push(current);
  return commands;
}

/**
 * Extract redirect target paths from shell-quote tokens.
 * Redirect tokens look like { op: '>' } or { op: '>>' } followed by a string.
 */
function extractRedirectPaths(tokens) {
  const paths = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (typeof t === 'object' && (t.op === '>' || t.op === '>>')) {
      const next = tokens[i + 1];
      if (typeof next === 'string') {
        paths.push(next);
      }
    }
  }
  return paths;
}

/**
 * Analyse a Bash command string and return paths that need sandbox checking.
 * Returns `{ destructivePaths, redirectPaths, hasShellExpansion, error }`.
 */
function analyseBashCommand(command) {
  // Quick check for shell expansion that defeats static analysis
  if (SHELL_EXPANSION_RE.test(command)) {
    // Only reject if the command also contains destructive keywords
    const lower = command.toLowerCase();
    const hasDestructive = [...DESTRUCTIVE_COMMANDS].some(cmd => lower.includes(cmd));
    if (hasDestructive) {
      return {
        destructivePaths: [],
        redirectPaths: [],
        hasShellExpansion: true,
        error: `Shell expansion detected with destructive command — cannot statically verify paths`,
      };
    }
  }

  let tokens;
  try {
    tokens = parseShellCommand(command);
  } catch {
    return { destructivePaths: [], redirectPaths: [], hasShellExpansion: false, error: null };
  }

  const subCommands = splitSubCommands(tokens);
  const destructivePaths = [];

  for (const sub of subCommands) {
    const strings = sub.filter(t => typeof t === 'string');
    if (strings.length === 0) continue;

    const cmd = path.basename(strings[0]);

    if (!DESTRUCTIVE_COMMANDS.has(cmd)) continue;

    // Extract non-flag arguments as paths
    const args = strings.slice(1).filter(a => !a.startsWith('-'));

    if (cmd === 'mv') {
      // mv: all arguments are paths (source AND destination)
      destructivePaths.push(...args);
    } else {
      destructivePaths.push(...args);
    }
  }

  // Check redirects (> / >>) — these can overwrite files
  const redirectPaths = extractRedirectPaths(tokens);

  return { destructivePaths, redirectPaths, hasShellExpansion: false, error: null };
}

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * Enforce the path sandbox for a given tool invocation.
 *
 * @param {string} toolName  — e.g. 'Write', 'Bash', 'Edit'
 * @param {object} input     — tool input object
 * @param {string} projectDir — current project working directory
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
export async function enforceSandbox(toolName, input, projectDir) {
  // Feature gate
  if (!SANDBOX_ENABLED) return { allowed: true };

  // No project dir → block all destructive operations
  if (!projectDir) {
    if (READONLY_TOOLS.has(toolName)) return { allowed: true };
    return { allowed: false, reason: 'No project directory set — destructive operations blocked' };
  }

  // Read-only tools are always allowed
  if (READONLY_TOOLS.has(toolName)) return { allowed: true };

  // ── File-path tools (Write / Edit / MultiEdit) ────────────────────────
  if (FILE_PATH_TOOLS.has(toolName)) {
    const filePath = input?.file_path;
    if (!filePath) return { allowed: true }; // no path to check

    if (!(await isPathAllowed(filePath, projectDir))) {
      return {
        allowed: false,
        reason: `Path "${filePath}" is outside the project directory`,
      };
    }
    return { allowed: true };
  }

  // ── Bash tool ─────────────────────────────────────────────────────────
  if (toolName === 'Bash') {
    const command = input?.command;
    if (!command) return { allowed: true };

    const analysis = analyseBashCommand(command);

    if (analysis.error) {
      return { allowed: false, reason: analysis.error };
    }

    // Validate all destructive paths
    for (const p of analysis.destructivePaths) {
      if (!(await isPathAllowed(p, projectDir))) {
        return {
          allowed: false,
          reason: `Bash command targets path "${p}" outside the project directory`,
        };
      }
    }

    // Validate redirect targets
    for (const p of analysis.redirectPaths) {
      if (!(await isPathAllowed(p, projectDir))) {
        return {
          allowed: false,
          reason: `Redirect target "${p}" is outside the project directory`,
        };
      }
    }

    return { allowed: true };
  }

  // ── Unknown / MCP tools — heuristic path field check ──────────────────
  if (input && typeof input === 'object') {
    const PATH_FIELDS = ['file_path', 'path', 'target', 'destination', 'filePath'];
    for (const field of PATH_FIELDS) {
      const val = input[field];
      if (typeof val === 'string' && (val.startsWith('/') || val.startsWith('..'))) {
        if (!(await isPathAllowed(val, projectDir))) {
          return {
            allowed: false,
            reason: `Field "${field}" value "${val}" is outside the project directory`,
          };
        }
      }
    }
  }

  return { allowed: true };
}

// Export internals for testing
export { isPathWithinProject, isPathAllowed, analyseBashCommand, DESTRUCTIVE_COMMANDS, SANDBOX_ENABLED };
