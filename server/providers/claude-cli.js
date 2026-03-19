// server/providers/claude-cli.js
// Claude CLI Provider adapter (P2: IProvider interface)
import { BaseProvider } from './base-provider.js';
import {
  spawnClaudeCLI,
  abortClaudeCLISession,
  isClaudeCLISessionActive,
} from '../claude-cli.js';

export class ClaudeCLIProvider extends BaseProvider {
  #writer = null;

  constructor() {
    super('claude-cli');
  }

  /**
   * Start a Claude CLI session.
   * @param {object} config - { command, options, writer }
   * writer is a WebSocketWriter that has send() method
   */
  async start(config) {
    const { command, options, writer } = config;
    this.isRunning = true;
    this.#writer = writer;

    // Create a proxy writer that intercepts send() to emit events
    const originalSend = writer.send.bind(writer);
    writer.send = (data) => {
      // Forward to original WebSocket
      originalSend(data);

      // Also emit as provider events
      if (data.type === 'claude-response') {
        this.emitOutput(data);
      } else if (data.type === 'claude-complete') {
        this.sessionId = data.sessionId;
        this.emitComplete(data);
      } else if (data.type === 'claude-error' || data.type === 'claude-cli-error') {
        this.emitError(new Error(data.error || 'CLI error'));
      } else {
        // Pass through other types (session-created, token-budget, claude-cli-system, etc.)
        this.emitOutput(data);
      }
    };

    try {
      await spawnClaudeCLI(command, options, writer);
      // spawnClaudeCLI resolves when the process completes
      if (this.isRunning) {
        this.isRunning = false;
      }
    } catch (error) {
      this.emitError(error);
    }
  }

  async abort() {
    const sid = this.sessionId || this.#writer?.getSessionId?.();
    if (sid) {
      console.log(`[Provider:claude-cli] Aborting session: ${sid}`);
      abortClaudeCLISession(sid);
    }
    this.isRunning = false;
  }

  isActive() {
    const sid = this.sessionId || this.#writer?.getSessionId?.();
    return sid ? isClaudeCLISessionActive(sid) : false;
  }

  dispose() {
    this.#writer = null;
    super.dispose();
  }
}
