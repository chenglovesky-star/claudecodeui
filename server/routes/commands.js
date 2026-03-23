import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import matter from 'gray-matter';
import { CLAUDE_MODELS, CURSOR_MODELS, CODEX_MODELS } from '../../shared/modelConstants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Recursively scan directory for command files (.md)
 * @param {string} dir - Directory to scan
 * @param {string} baseDir - Base directory for relative paths
 * @param {string} namespace - Namespace for commands (e.g., 'project', 'user')
 * @returns {Promise<Array>} Array of command objects
 */
async function scanCommandsDirectory(dir, baseDir, namespace) {
  const commands = [];

  try {
    // Check if directory exists
    await fs.access(dir);

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subCommands = await scanCommandsDirectory(fullPath, baseDir, namespace);
        commands.push(...subCommands);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Parse markdown file for metadata
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          const { data: frontmatter, content: commandContent } = matter(content);

          // Calculate relative path from baseDir for command name
          const relativePath = path.relative(baseDir, fullPath);
          // Remove .md extension and convert to command name
          const commandName = '/' + relativePath.replace(/\.md$/, '').replace(/\\/g, '/');

          // Extract description from frontmatter or first line of content
          let description = frontmatter.description || '';
          if (!description) {
            const firstLine = commandContent.trim().split('\n')[0];
            description = firstLine.replace(/^#+\s*/, '').trim();
          }

          commands.push({
            name: commandName,
            path: fullPath,
            relativePath,
            description,
            namespace,
            metadata: frontmatter
          });
        } catch (err) {
          console.error(`Error parsing command file ${fullPath}:`, err.message);
        }
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be accessed - this is okay
    if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
      console.error(`Error scanning directory ${dir}:`, err.message);
    }
  }

  return commands;
}

/**
 * Scan a single skills directory for skill directories containing SKILL.md
 * @param {string} skillsDir - Directory to scan
 * @param {string} namespace - Namespace for discovered skills
 * @param {string} [descPrefix] - Optional prefix for description
 * @returns {Promise<Array>} Array of skill objects
 */
async function scanSingleSkillsDir(skillsDir, namespace, descPrefix) {
  const skills = [];
  try {
    await fs.access(skillsDir);
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      try {
        const content = await fs.readFile(skillMdPath, 'utf8');
        const { data: frontmatter, content: skillContent } = matter(content);

        let description = frontmatter.description || '';
        if (!description) {
          const firstLine = skillContent.trim().split('\n')[0];
          description = firstLine.replace(/^#+\s*/, '').trim();
        }

        skills.push({
          name: '/' + entry.name,
          path: skillMdPath,
          relativePath: entry.name + '/SKILL.md',
          description: descPrefix ? `(${descPrefix}) ${description}` : description,
          namespace,
          metadata: { ...frontmatter, type: 'skill', builtin: namespace === 'builtin-skill' }
        });
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`Error reading skill ${entry.name}:`, err.message);
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
      console.error(`Error scanning skills directory ${skillsDir}:`, err.message);
    }
  }
  return skills;
}

/**
 * Scan all skill sources: built-in (server/skills/), user (~/.claude/skills/), plugins
 */
async function scanSkillsDirectory() {
  const skills = [];

  // 1. Scan built-in skills (server/skills/) — lowest priority, can be overridden by user skills
  const builtinSkillsDir = path.join(path.dirname(__dirname), 'skills');
  const builtinSkills = await scanSingleSkillsDir(builtinSkillsDir, 'builtin-skill', '内置');
  skills.push(...builtinSkills);

  // 2. Scan user-level skills (~/.claude/skills/) — overrides built-in if same name
  const skillsDir = path.join(os.homedir(), '.claude', 'skills');
  const userSkills = await scanSingleSkillsDir(skillsDir, 'skill');

  // User skills override built-in skills with the same name
  for (const userSkill of userSkills) {
    const builtinIndex = skills.findIndex(s => s.name === userSkill.name);
    if (builtinIndex !== -1) {
      skills[builtinIndex] = userSkill; // replace built-in with user version
    } else {
      skills.push(userSkill);
    }
  }

  // Also scan ~/.claude/plugins/cache/ for plugin-installed skills
  const pluginsCacheDir = path.join(os.homedir(), '.claude', 'plugins', 'cache');
  try {
    await fs.access(pluginsCacheDir);
    const orgs = await fs.readdir(pluginsCacheDir, { withFileTypes: true });

    for (const org of orgs) {
      if (!org.isDirectory()) continue;
      const orgDir = path.join(pluginsCacheDir, org.name);
      const plugins = await fs.readdir(orgDir, { withFileTypes: true });

      for (const plugin of plugins) {
        if (!plugin.isDirectory()) continue;
        const pluginDir = path.join(orgDir, plugin.name);
        const versions = await fs.readdir(pluginDir, { withFileTypes: true });

        for (const version of versions) {
          if (!version.isDirectory()) continue;
          const skillsPath = path.join(pluginDir, version.name, 'skills');
          try {
            await fs.access(skillsPath);
            const skillEntries = await fs.readdir(skillsPath, { withFileTypes: true });

            for (const skillEntry of skillEntries) {
              if (!skillEntry.isDirectory()) continue;
              const skillMdPath = path.join(skillsPath, skillEntry.name, 'SKILL.md');
              try {
                const content = await fs.readFile(skillMdPath, 'utf8');
                const { data: frontmatter, content: skillContent } = matter(content);

                let description = frontmatter.description || '';
                if (!description) {
                  const firstLine = skillContent.trim().split('\n')[0];
                  description = firstLine.replace(/^#+\s*/, '').trim();
                }

                // Use plugin:skill naming convention
                const skillName = `/${plugin.name}:${skillEntry.name}`;

                skills.push({
                  name: skillName,
                  path: skillMdPath,
                  relativePath: `plugins/${org.name}/${plugin.name}/${version.name}/skills/${skillEntry.name}/SKILL.md`,
                  description: `(${plugin.name}) ${description}`,
                  namespace: 'skill',
                  metadata: { ...frontmatter, type: 'skill', plugin: plugin.name }
                });
              } catch (err) {
                if (err.code !== 'ENOENT') {
                  console.error(`Error reading plugin skill ${plugin.name}:${skillEntry.name}:`, err.message);
                }
              }
            }
          } catch (err) {
            // No skills directory in this plugin version, skip
          }
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
      console.error(`Error scanning plugins cache directory:`, err.message);
    }
  }

  return skills;
}

/**
 * Built-in commands that are always available
 */
const builtInCommands = [
  {
    name: '/help',
    description: 'Show help documentation for Claude Code',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/clear',
    description: 'Clear the conversation history',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/model',
    description: 'Switch or view the current AI model',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/cost',
    description: 'Display token usage and cost information',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/memory',
    description: 'Open CLAUDE.md memory file for editing',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/config',
    description: 'Open settings and configuration',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/status',
    description: 'Show system status and version information',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/rewind',
    description: 'Rewind the conversation to a previous state',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  }
];

/**
 * Built-in command handlers
 * Each handler returns { type: 'builtin', action: string, data: any }
 */
const builtInHandlers = {
  '/help': async (args, context) => {
    const helpText = `# Claude Code Commands

## Built-in Commands

${builtInCommands.map(cmd => `### ${cmd.name}
${cmd.description}
`).join('\n')}

## Custom Commands

Custom commands can be created in:
- Project: \`.claude/commands/\` (project-specific)
- User: \`~/.claude/commands/\` (available in all projects)

## Skills

Skills are automatically discovered from \`~/.claude/skills/\`.
Each skill is a directory containing a \`SKILL.md\` file.

### Creating a Skill

1. Create a directory: \`~/.claude/skills/my-skill/\`
2. Add a \`SKILL.md\` file with optional frontmatter:

\`\`\`markdown
---
description: My skill description
---
Skill prompt content here...
\`\`\`

3. The skill will appear as \`/my-skill\` in the command menu.

### Command Syntax

- **Arguments**: Use \`$ARGUMENTS\` for all args or \`$1\`, \`$2\`, etc. for positional
`;

    return {
      type: 'builtin',
      action: 'help',
      data: {
        content: helpText,
        format: 'markdown'
      }
    };
  },

  '/clear': async (args, context) => {
    return {
      type: 'builtin',
      action: 'clear',
      data: {
        message: 'Conversation history cleared'
      }
    };
  },

  '/model': async (args, context) => {
    // Read available models from centralized constants
    const availableModels = {
      claude: CLAUDE_MODELS.OPTIONS.map(o => o.value),
      cursor: CURSOR_MODELS.OPTIONS.map(o => o.value),
      codex: CODEX_MODELS.OPTIONS.map(o => o.value)
    };

    const currentProvider = context?.provider || 'claude';
    const currentModel = context?.model || CLAUDE_MODELS.DEFAULT;

    return {
      type: 'builtin',
      action: 'model',
      data: {
        current: {
          provider: currentProvider,
          model: currentModel
        },
        available: availableModels,
        message: args.length > 0
          ? `Switching to model: ${args[0]}`
          : `Current model: ${currentModel}`
      }
    };
  },

  '/cost': async (args, context) => {
    const tokenUsage = context?.tokenUsage || {};
    const provider = context?.provider || 'claude';
    const model =
      context?.model ||
      (provider === 'cursor'
        ? CURSOR_MODELS.DEFAULT
        : provider === 'codex'
          ? CODEX_MODELS.DEFAULT
          : CLAUDE_MODELS.DEFAULT);

    const used = Number(tokenUsage.used ?? tokenUsage.totalUsed ?? tokenUsage.total_tokens ?? 0) || 0;
    const total =
      Number(
        tokenUsage.total ??
          tokenUsage.contextWindow ??
          parseInt(process.env.CONTEXT_WINDOW || '160000', 10),
      ) || 160000;
    const percentage = total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0;

    const inputTokensRaw =
      Number(
        tokenUsage.inputTokens ??
          tokenUsage.input ??
          tokenUsage.cumulativeInputTokens ??
          tokenUsage.promptTokens ??
          0,
      ) || 0;
    const outputTokens =
      Number(
        tokenUsage.outputTokens ??
          tokenUsage.output ??
          tokenUsage.cumulativeOutputTokens ??
          tokenUsage.completionTokens ??
          0,
      ) || 0;
    const cacheTokens =
      Number(
        tokenUsage.cacheReadTokens ??
          tokenUsage.cacheCreationTokens ??
          tokenUsage.cacheTokens ??
          tokenUsage.cachedTokens ??
          0,
      ) || 0;

    // If we only have total used tokens, treat them as input for display/estimation.
    const inputTokens =
      inputTokensRaw > 0 || outputTokens > 0 || cacheTokens > 0 ? inputTokensRaw + cacheTokens : used;

    // Rough default rates by provider (USD / 1M tokens).
    const pricingByProvider = {
      claude: { input: 3, output: 15 },
      cursor: { input: 3, output: 15 },
      codex: { input: 1.5, output: 6 },
    };
    const rates = pricingByProvider[provider] || pricingByProvider.claude;

    const inputCost = (inputTokens / 1_000_000) * rates.input;
    const outputCost = (outputTokens / 1_000_000) * rates.output;
    const totalCost = inputCost + outputCost;

    return {
      type: 'builtin',
      action: 'cost',
      data: {
        tokenUsage: {
          used,
          total,
          percentage,
        },
        cost: {
          input: inputCost.toFixed(4),
          output: outputCost.toFixed(4),
          total: totalCost.toFixed(4),
        },
        model,
      },
    };
  },

  '/status': async (args, context) => {
    // Read version from package.json
    const packageJsonPath = path.join(path.dirname(__dirname), '..', 'package.json');
    let version = 'unknown';
    let packageName = 'claude-code-ui';

    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      version = packageJson.version;
      packageName = packageJson.name;
    } catch (err) {
      console.error('Error reading package.json:', err);
    }

    const uptime = process.uptime();
    const uptimeMinutes = Math.floor(uptime / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    const uptimeFormatted = uptimeHours > 0
      ? `${uptimeHours}h ${uptimeMinutes % 60}m`
      : `${uptimeMinutes}m`;

    return {
      type: 'builtin',
      action: 'status',
      data: {
        version,
        packageName,
        uptime: uptimeFormatted,
        uptimeSeconds: Math.floor(uptime),
        model: context?.model || 'claude-sonnet-4.5',
        provider: context?.provider || 'claude',
        nodeVersion: process.version,
        platform: process.platform
      }
    };
  },

  '/memory': async (args, context) => {
    const projectPath = context?.projectPath;

    if (!projectPath) {
      return {
        type: 'builtin',
        action: 'memory',
        data: {
          error: 'No project selected',
          message: 'Please select a project to access its CLAUDE.md file'
        }
      };
    }

    const claudeMdPath = path.join(projectPath, 'CLAUDE.md');

    // Check if CLAUDE.md exists
    let exists = false;
    try {
      await fs.access(claudeMdPath);
      exists = true;
    } catch (err) {
      // File doesn't exist
    }

    return {
      type: 'builtin',
      action: 'memory',
      data: {
        path: claudeMdPath,
        exists,
        message: exists
          ? `Opening CLAUDE.md at ${claudeMdPath}`
          : `CLAUDE.md not found at ${claudeMdPath}. Create it to store project-specific instructions.`
      }
    };
  },

  '/config': async (args, context) => {
    return {
      type: 'builtin',
      action: 'config',
      data: {
        message: 'Opening settings...'
      }
    };
  },

  '/rewind': async (args, context) => {
    const steps = args[0] ? parseInt(args[0]) : 1;

    if (isNaN(steps) || steps < 1) {
      return {
        type: 'builtin',
        action: 'rewind',
        data: {
          error: 'Invalid steps parameter',
          message: 'Usage: /rewind [number] - Rewind conversation by N steps (default: 1)'
        }
      };
    }

    return {
      type: 'builtin',
      action: 'rewind',
      data: {
        steps,
        message: `Rewinding conversation by ${steps} step${steps > 1 ? 's' : ''}...`
      }
    };
  }
};

/**
 * POST /api/commands/list
 * List all available commands from project and user directories
 */
router.post('/list', async (req, res) => {
  try {
    const { projectPath } = req.body;
    const allCommands = [...builtInCommands];

    // Scan project-level commands (.claude/commands/)
    if (projectPath) {
      const projectCommandsDir = path.join(projectPath, '.claude', 'commands');
      const projectCommands = await scanCommandsDirectory(
        projectCommandsDir,
        projectCommandsDir,
        'project'
      );
      allCommands.push(...projectCommands);
    }

    // Scan user-level commands (~/.claude/commands/)
    const homeDir = os.homedir();
    const userCommandsDir = path.join(homeDir, '.claude', 'commands');
    const userCommands = await scanCommandsDirectory(
      userCommandsDir,
      userCommandsDir,
      'user'
    );
    allCommands.push(...userCommands);

    // Scan user skills (~/.claude/skills/)
    const skillCommands = await scanSkillsDirectory();
    allCommands.push(...skillCommands);

    // Separate built-in and custom commands
    const customCommands = allCommands.filter(cmd => cmd.namespace !== 'builtin');

    // Sort commands alphabetically by name
    customCommands.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      builtIn: builtInCommands,
      custom: customCommands,
      count: allCommands.length
    });
  } catch (error) {
    console.error('Error listing commands:', error);
    res.status(500).json({
      error: 'Failed to list commands',
      message: error.message
    });
  }
});

/**
 * POST /api/commands/load
 * Load a specific command file and return its content and metadata
 */
router.post('/load', async (req, res) => {
  try {
    const { commandPath } = req.body;

    if (!commandPath) {
      return res.status(400).json({
        error: 'Command path is required'
      });
    }

    // Security: Prevent path traversal
    const resolvedPath = path.resolve(commandPath);
    const builtinSkillsBase = path.resolve(path.join(path.dirname(__dirname), 'skills'));
    if (!resolvedPath.startsWith(path.resolve(os.homedir())) &&
        !resolvedPath.startsWith(builtinSkillsBase) &&
        !resolvedPath.includes('.claude/commands') &&
        !resolvedPath.includes('.claude/skills') &&
        !resolvedPath.includes('.claude/plugins')) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Command must be in .claude/commands directory'
      });
    }

    // Read and parse the command file
    const content = await fs.readFile(commandPath, 'utf8');
    const { data: metadata, content: commandContent } = matter(content);

    res.json({
      path: commandPath,
      metadata,
      content: commandContent
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Command not found',
        message: `Command file not found: ${req.body.commandPath}`
      });
    }

    console.error('Error loading command:', error);
    res.status(500).json({
      error: 'Failed to load command',
      message: error.message
    });
  }
});

/**
 * POST /api/commands/execute
 * Execute a command with argument replacement
 * This endpoint prepares the command content but doesn't execute bash commands yet
 * (that will be handled in the command parser utility)
 */
router.post('/execute', async (req, res) => {
  try {
    const { commandName, commandPath, args = [], context = {} } = req.body;

    if (!commandName) {
      return res.status(400).json({
        error: 'Command name is required'
      });
    }

    // Handle built-in commands
    const handler = builtInHandlers[commandName];
    if (handler) {
      try {
        const result = await handler(args, context);
        return res.json({
          ...result,
          command: commandName
        });
      } catch (error) {
        console.error(`Error executing built-in command ${commandName}:`, error);
        return res.status(500).json({
          error: 'Command execution failed',
          message: error.message,
          command: commandName
        });
      }
    }

    // Handle custom commands
    if (!commandPath) {
      return res.status(400).json({
        error: 'Command path is required for custom commands'
      });
    }

    // Load command content
    // Security: validate commandPath is within allowed directories
    {
      const resolvedPath = path.resolve(commandPath);
      const userBase = path.resolve(path.join(os.homedir(), '.claude', 'commands'));
      const skillsBase = path.resolve(path.join(os.homedir(), '.claude', 'skills'));
      const pluginsBase = path.resolve(path.join(os.homedir(), '.claude', 'plugins'));
      const builtinBase = path.resolve(path.join(path.dirname(__dirname), 'skills'));
      const projectBase = context?.projectPath
        ? path.resolve(path.join(context.projectPath, '.claude', 'commands'))
        : null;
      const isUnder = (base) => {
        const rel = path.relative(base, resolvedPath);
        return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
      };
      if (!(isUnder(userBase) || isUnder(skillsBase) || isUnder(pluginsBase) || isUnder(builtinBase) || (projectBase && isUnder(projectBase)))) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Command must be in .claude/commands directory'
        });
      }
    }
    const content = await fs.readFile(commandPath, 'utf8');
    const { data: metadata, content: commandContent } = matter(content);
    // Basic argument replacement (will be enhanced in command parser utility)
    let processedContent = commandContent;

    // Replace $ARGUMENTS with all arguments joined
    const argsString = args.join(' ');
    processedContent = processedContent.replace(/\$ARGUMENTS/g, argsString);

    // Replace $1, $2, etc. with positional arguments
    args.forEach((arg, index) => {
      const placeholder = `$${index + 1}`;
      processedContent = processedContent.replace(new RegExp(`\\${placeholder}\\b`, 'g'), arg);
    });

    // For built-in skills with bundled memory, inject memory content into skill prompt
    const builtinBase = path.resolve(path.join(path.dirname(__dirname), 'skills'));
    const resolvedCmdPath = path.resolve(commandPath);
    if (resolvedCmdPath.startsWith(builtinBase)) {
      const skillMemoryDir = path.join(path.dirname(resolvedCmdPath), 'memory');
      try {
        await fs.access(skillMemoryDir);
        const memFiles = await fs.readdir(skillMemoryDir);
        const mdFiles = memFiles.filter(f => f.endsWith('.md'));
        if (mdFiles.length > 0) {
          let memoryBlock = '\n\n---\n## 内置默认记忆（开箱即用知识库）\n\n';
          memoryBlock += '> 以下为内置记忆内容。如果用户工作区存在 `./memory/` 目录且有同名文件，应优先使用用户工作区的版本。\n\n';
          for (const mdFile of mdFiles) {
            const memContent = await fs.readFile(path.join(skillMemoryDir, mdFile), 'utf8');
            const { content: memBody } = matter(memContent);
            memoryBlock += `### 📄 ${mdFile}\n\n${memBody.trim()}\n\n`;
          }
          processedContent += memoryBlock;
        }
      } catch {
        // No memory directory, skip injection
      }
    }

    res.json({
      type: 'custom',
      command: commandName,
      content: processedContent,
      metadata,
      hasFileIncludes: /(?:^|\s)@\w+/m.test(processedContent),
      hasBashCommands: /(?:^|\s)!\w+/m.test(processedContent)
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Command not found',
        message: `Command file not found: ${req.body.commandPath}`
      });
    }

    console.error('Error executing command:', error);
    res.status(500).json({
      error: 'Failed to execute command',
      message: error.message
    });
  }
});

export default router;
