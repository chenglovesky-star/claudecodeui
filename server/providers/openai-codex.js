// server/providers/openai-codex.js
// OpenAI Codex Provider adapter (P2: IProvider interface)
import { BaseProvider } from './base-provider.js';
import {
  queryCodex,
  abortCodexSession,
  isCodexSessionActive,
} from '../openai-codex.js';

export class OpenAICodexProvider extends BaseProvider {
  #writer = null;

  constructor() {
    super('openai-codex');
  }

  /**
   * Start an OpenAI Codex session.
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
      if (data.type === 'codex-response') {
        this.emitOutput(data);
      } else if (data.type === 'codex-complete') {
        this.sessionId = data.sessionId;
        this.emitComplete(data);
      } else if (data.type === 'codex-error') {
        this.emitError(new Error(data.error || 'OpenAI Codex error'));
      } else if (data.type === 'session-created') {
        this.sessionId = data.sessionId;
        this.emitOutput(data);
      } else if (data.type === 'token-budget') {
        this.emitOutput(data);
      }
    };

    try {
      await queryCodex(command, options, writer);
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
      console.log(`[Provider:openai-codex] Aborting session: ${sid}`);
      abortCodexSession(sid);
    }
    this.isRunning = false;
  }

  isActive() {
    const sid = this.sessionId || this.#writer?.getSessionId?.();
    return sid ? isCodexSessionActive(sid) : false;
  }

  dispose() {
    this.#writer = null;
    super.dispose();
  }
}
