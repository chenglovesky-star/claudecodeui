import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { promises as fs } from 'fs';
import path from 'path';

// Use cross-spawn on Windows for better command execution
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

let activeClaudeCliProcesses = new Map(); // Track active processes by session ID

/**
 * Handles image processing for Claude CLI queries
 * Saves base64 images to temporary files and returns modified prompt with file paths
 */
async function handleImages(command, images, cwd) {
  const tempImagePaths = [];
  let tempDir = null;

  if (!images || images.length === 0) {
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }

  try {
    const workingDir = cwd || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    for (const [index, image] of images.entries()) {
      const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.error('Invalid image data format');
        continue;
      }

      const [, mimeType, base64Data] = matches;
      const extension = mimeType.split('/')[1] || 'png';
      const filename = `image_${index}.${extension}`;
      const filepath = path.join(tempDir, filename);

      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);
    }

    let modifiedCommand = command;
    if (tempImagePaths.length > 0 && command && command.trim()) {
      const imageNote = `\n\n[Images provided at the following paths:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
      modifiedCommand = command + imageNote;
    }

    console.log(`Processed ${tempImagePaths.length} images to temp directory: ${tempDir}`);
    return { modifiedCommand, tempImagePaths, tempDir };
  } catch (error) {
    console.error('Error processing images for Claude CLI:', error);
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }
}

/**
 * Cleans up temporary image files
 */
async function cleanupTempFiles(tempImagePaths, tempDir) {
  if (!tempImagePaths || tempImagePaths.length === 0) return;

  try {
    for (const imagePath of tempImagePaths) {
      await fs.unlink(imagePath).catch(err =>
        console.error(`Failed to delete temp image ${imagePath}:`, err)
      );
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(err =>
        console.error(`Failed to delete temp directory ${tempDir}:`, err)
      );
    }
    console.log(`Cleaned up ${tempImagePaths.length} temp image files`);
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

/**
 * Extracts token usage from CLI result messages
 */
function extractTokenBudget(resultMessage) {
  if (resultMessage.type !== 'result' || !resultMessage.modelUsage) {
    return null;
  }

  const modelKey = Object.keys(resultMessage.modelUsage)[0];
  const modelData = resultMessage.modelUsage[modelKey];
  if (!modelData) return null;

  const inputTokens = modelData.cumulativeInputTokens || modelData.inputTokens || 0;
  const outputTokens = modelData.cumulativeOutputTokens || modelData.outputTokens || 0;
  const cacheReadTokens = modelData.cumulativeCacheReadInputTokens || modelData.cacheReadInputTokens || 0;
  const cacheCreationTokens = modelData.cumulativeCacheCreationInputTokens || modelData.cacheCreationInputTokens || 0;

  const totalUsed = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  const contextWindow = parseInt(process.env.CONTEXT_WINDOW) || 160000;

  console.log(`Token calculation: input=${inputTokens}, output=${outputTokens}, cache=${cacheReadTokens + cacheCreationTokens}, total=${totalUsed}/${contextWindow}`);

  return { used: totalUsed, total: contextWindow };
}

/**
 * Spawns Claude CLI process and streams responses via WebSocket
 */
async function spawnClaudeCLI(command, options = {}, ws) {
  return new Promise(async (resolve, reject) => {
    const { sessionId, projectPath, cwd, resume, model, permissionMode, toolsSettings, images } = options;
    let capturedSessionId = sessionId;
    let sessionCreatedSent = false;
    let messageBuffer = '';
    let tempImagePaths = [];
    let tempDir = null;

    // Handle images
    const imageResult = await handleImages(command, images, cwd || projectPath);
    const finalCommand = imageResult.modifiedCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    // Build CLI arguments
    const args = [];

    // Resume existing session
    if (sessionId) {
      args.push('--resume', sessionId);
    }

    if (finalCommand && finalCommand.trim()) {
      args.push('-p', finalCommand);
      args.push('--output-format', 'stream-json');
      args.push('--verbose');
    }

    // Add model flag
    if (model) {
      args.push('--model', model);
    }

    // Add permission mode
    if (permissionMode && permissionMode !== 'default') {
      if (permissionMode === 'bypassPermissions') {
        args.push('--permission-mode', 'full');
      } else if (permissionMode === 'acceptEdits') {
        args.push('--permission-mode', 'auto-accept-edits');
      } else if (permissionMode === 'plan') {
        args.push('--permission-mode', 'plan');
      } else {
        args.push('--permission-mode', permissionMode);
      }
    }

    // Add allowed tools
    const settings = toolsSettings || {};
    if (settings.allowedTools && settings.allowedTools.length > 0) {
      for (const tool of settings.allowedTools) {
        args.push('--allowedTools', tool);
      }
    }

    const workingDir = cwd || projectPath || process.cwd();
    const cliCommand = process.env.CLAUDE_CLI_PATH || 'claude';

    console.log('Spawning Claude CLI:', cliCommand, args.join(' '));
    console.log('Working directory:', workingDir);
    console.log('Session info - Input sessionId:', sessionId, 'Resume:', resume);

    const cliProcess = spawnFunction(cliCommand, args, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLAUDECODE: '',  // Bypass nested detection
        HTTPS_PROXY: process.env.HTTPS_PROXY || '',
      }
    });

    // Store process reference for potential abort
    const processKey = capturedSessionId || Date.now().toString();
    activeClaudeCliProcesses.set(processKey, cliProcess);

    // Handle stdout (streaming JSON responses)
    let lineBuffer = '';

    cliProcess.stdout.on('data', (data) => {
      const rawOutput = data.toString();
      console.log('📤 Claude CLI stdout:', rawOutput);

      // Buffer partial lines
      lineBuffer += rawOutput;
      const lines = lineBuffer.split('\n');
      // Keep the last potentially incomplete line in buffer
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        try {
          const response = JSON.parse(trimmedLine);
          console.log('📄 Parsed JSON response:', response);

          switch (response.type) {
            case 'system':
              if (response.subtype === 'init') {
                if (response.session_id && !capturedSessionId) {
                  capturedSessionId = response.session_id;
                  console.log('📝 Captured session ID:', capturedSessionId);

                  // Update process key
                  if (processKey !== capturedSessionId) {
                    activeClaudeCliProcesses.delete(processKey);
                    activeClaudeCliProcesses.set(capturedSessionId, cliProcess);
                  }

                  if (ws.setSessionId && typeof ws.setSessionId === 'function') {
                    ws.setSessionId(capturedSessionId);
                  }

                  // Send session-created event only once for new sessions
                  if (!sessionId && !sessionCreatedSent) {
                    sessionCreatedSent = true;
                    ws.send({
                      type: 'session-created',
                      sessionId: capturedSessionId,
                      model: response.model,
                      cwd: response.cwd
                    });
                  }
                }

                ws.send({
                  type: 'claude-cli-system',
                  data: response,
                  sessionId: capturedSessionId || sessionId || null
                });
              }
              break;

            case 'assistant':
              if (response.message && response.message.content && response.message.content.length > 0) {
                const textContent = response.message.content[0].text;
                messageBuffer += textContent;

                ws.send({
                  type: 'claude-response',
                  data: {
                    type: 'content_block_delta',
                    delta: {
                      type: 'text_delta',
                      text: textContent
                    }
                  },
                  sessionId: capturedSessionId || sessionId || null
                });
              }
              break;

            case 'result':
              console.log('Claude CLI session result:', response);

              if (messageBuffer) {
                ws.send({
                  type: 'claude-response',
                  data: {
                    type: 'content_block_stop'
                  },
                  sessionId: capturedSessionId || sessionId || null
                });
              }

              // Send token budget
              const tokenBudget = extractTokenBudget(response);
              if (tokenBudget) {
                ws.send({
                  type: 'token-budget',
                  data: tokenBudget,
                  sessionId: capturedSessionId || sessionId || null
                });
              }

              ws.send({
                type: 'claude-cli-result',
                sessionId: capturedSessionId || sessionId,
                data: response,
                success: response.subtype === 'success'
              });
              break;

            default:
              ws.send({
                type: 'claude-cli-response',
                data: response,
                sessionId: capturedSessionId || sessionId || null
              });
          }
        } catch (parseError) {
          console.log('📄 Non-JSON response:', trimmedLine);
          ws.send({
            type: 'claude-cli-output',
            data: trimmedLine,
            sessionId: capturedSessionId || sessionId || null
          });
        }
      }
    });

    // Handle stderr
    cliProcess.stderr.on('data', (data) => {
      console.error('Claude CLI stderr:', data.toString());
      ws.send({
        type: 'claude-cli-error',
        error: data.toString(),
        sessionId: capturedSessionId || sessionId || null
      });
    });

    // Handle process completion
    cliProcess.on('close', async (code) => {
      console.log(`Claude CLI process exited with code ${code}`);

      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeClaudeCliProcesses.delete(finalSessionId);

      // Cleanup temp files
      await cleanupTempFiles(tempImagePaths, tempDir);

      ws.send({
        type: 'claude-complete',
        sessionId: finalSessionId,
        exitCode: code,
        isNewSession: !sessionId && !!command
      });

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Claude CLI exited with code ${code}`));
      }
    });

    // Handle process errors
    cliProcess.on('error', (error) => {
      console.error('Claude CLI process error:', error);

      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeClaudeCliProcesses.delete(finalSessionId);

      ws.send({
        type: 'claude-cli-error',
        error: error.message,
        sessionId: capturedSessionId || sessionId || null
      });

      reject(error);
    });

    // Close stdin
    cliProcess.stdin.end();
  });
}

function abortClaudeCLISession(sessionId) {
  const proc = activeClaudeCliProcesses.get(sessionId);
  if (proc) {
    console.log(`🛑 Aborting Claude CLI session: ${sessionId}`);
    proc.kill('SIGTERM');
    activeClaudeCliProcesses.delete(sessionId);
    return true;
  }
  return false;
}

function isClaudeCLISessionActive(sessionId) {
  return activeClaudeCliProcesses.has(sessionId);
}

function getActiveClaudeCLISessions() {
  return Array.from(activeClaudeCliProcesses.keys());
}

/**
 * Tests context continuity by running two rounds of conversation
 * First round: ask to remember a number
 * Second round: ask to recall the number, verify with --resume
 */
async function testContextContinuity(options = {}) {
  const { projectPath, model } = options;
  const cliCommand = process.env.CLAUDE_CLI_PATH || 'claude';
  const workingDir = projectPath || process.cwd();
  const testNumber = '42857';

  const runPrompt = (prompt, resumeSessionId = null) => {
    return new Promise((resolve, reject) => {
      const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
      if (resumeSessionId) {
        args.push('--resume', resumeSessionId);
      }
      if (model) {
        args.push('--model', model);
      }

      const proc = spawnFunction(cliCommand, args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CLAUDECODE: '',
          HTTPS_PROXY: process.env.HTTPS_PROXY || '',
        }
      });

      let sessionId = null;
      let responseText = '';
      let lineBuffer = '';

      proc.stdout.on('data', (data) => {
        lineBuffer += data.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === 'system' && parsed.subtype === 'init' && parsed.session_id) {
              sessionId = parsed.session_id;
            }
            if (parsed.type === 'assistant' && parsed.message?.content?.[0]?.text) {
              responseText += parsed.message.content[0].text;
            }
            if (parsed.type === 'result' && parsed.result) {
              responseText += parsed.result;
            }
          } catch (e) { /* skip non-JSON */ }
        }
      });

      proc.stderr.on('data', (data) => {
        console.error('Context test stderr:', data.toString());
      });

      proc.on('close', (code) => {
        resolve({ sessionId, responseText, exitCode: code });
      });

      proc.on('error', (error) => {
        reject(error);
      });

      proc.stdin.end();
    });
  };

  try {
    // Round 1: Ask to remember a number
    const firstResult = await runPrompt(`记住这个数字：${testNumber}`);
    if (!firstResult.sessionId) {
      return {
        success: false,
        error: 'Failed to get session ID from first round',
        firstResponse: firstResult.responseText,
        secondResponse: null,
        contextMaintained: false
      };
    }

    // Round 2: Ask to recall the number using --resume
    const secondResult = await runPrompt(
      '请告诉我刚才让你记住的数字是什么？',
      firstResult.sessionId
    );

    const contextMaintained = secondResult.responseText.includes(testNumber);

    return {
      success: true,
      sessionId: firstResult.sessionId,
      firstResponse: firstResult.responseText,
      secondResponse: secondResult.responseText,
      contextMaintained
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      firstResponse: null,
      secondResponse: null,
      contextMaintained: false
    };
  }
}

export {
  spawnClaudeCLI,
  abortClaudeCLISession,
  isClaudeCLISessionActive,
  getActiveClaudeCLISessions,
  testContextContinuity
};
