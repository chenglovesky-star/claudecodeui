// server/providers/gemini-cli.js
// Gemini CLI Provider adapter (P2: IProvider interface)
import { BaseProvider } from './base-provider.js';
import {
  spawnGemini,
  abortGeminiSession,
  isGeminiSessionActive,
} from '../gemini-cli.js';

export class GeminiCLIProvider extends BaseProvider {
  #writer = null;

  constructor() {
    super('gemini-cli');
  }

  /**
   * Start a Gemini CLI session.
   * @param {object} config - { command, options, writer }
   */
  async start(config) {
    const { command, options, writer, transport, connectionId } = config;
    this.isRunning = true;
    this.#writer = writer;

    // Proxy writer: route through transport.send() for backpressure
    writer.send = (data) => {
      if (transport && connectionId) {
        transport.send(connectionId, data);
      } else {
        if (writer.ws?.readyState === 1) writer.ws.send(JSON.stringify(data));
      }

      // Also emit as provider events
      if (data.type === 'claude-response' || data.type === 'gemini-response') {
        this.emitOutput(data);
      } else if (data.type === 'claude-complete') {
        this.sessionId = data.sessionId;
        this.emitComplete(data);
      } else if (data.type === 'gemini-error') {
        this.emitError(new Error(data.error || 'Gemini CLI error'));
      } else if (data.type === 'session-created') {
        this.sessionId = data.sessionId;
        this.emitOutput(data);
      } else if (data.type === 'token-budget') {
        this.emitOutput(data);
      }
    };

    try {
      await spawnGemini(command, options, writer);
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
      console.log(`[Provider:gemini-cli] Aborting session: ${sid}`);
      abortGeminiSession(sid);
    }
    this.isRunning = false;
  }

  isActive() {
    const sid = this.sessionId || this.#writer?.getSessionId?.();
    return sid ? isGeminiSessionActive(sid) : false;
  }

  dispose() {
    this.#writer = null;
    super.dispose();
  }
}
