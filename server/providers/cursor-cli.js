// server/providers/cursor-cli.js
// Cursor CLI Provider adapter (P2: IProvider interface)
import { BaseProvider } from './base-provider.js';
import {
  spawnCursor,
  abortCursorSession,
  isCursorSessionActive,
} from '../cursor-cli.js';

export class CursorCLIProvider extends BaseProvider {
  #writer = null;

  constructor() {
    super('cursor-cli');
  }

  /**
   * Start a Cursor CLI session.
   * @param {object} config - { command, options, writer }
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
      if (data.type === 'claude-response' || data.type === 'cursor-response' || data.type === 'cursor-output') {
        this.emitOutput(data);
      } else if (data.type === 'claude-complete') {
        this.sessionId = data.sessionId;
        this.emitComplete(data);
      } else if (data.type === 'cursor-error') {
        this.emitError(new Error(data.error || 'Cursor CLI error'));
      } else if (data.type === 'session-created') {
        this.sessionId = data.sessionId;
        this.emitOutput(data);
      } else if (data.type === 'cursor-system' || data.type === 'cursor-result' || data.type === 'cursor-user') {
        this.emitOutput(data);
      }
    };

    try {
      await spawnCursor(command, options, writer);
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
      console.log(`[Provider:cursor-cli] Aborting session: ${sid}`);
      abortCursorSession(sid);
    }
    this.isRunning = false;
  }

  isActive() {
    const sid = this.sessionId || this.#writer?.getSessionId?.();
    return sid ? isCursorSessionActive(sid) : false;
  }

  dispose() {
    this.#writer = null;
    super.dispose();
  }
}
