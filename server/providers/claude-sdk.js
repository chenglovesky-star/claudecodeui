// server/providers/claude-sdk.js
// Claude Agent SDK Provider adapter (P2: IProvider interface)
import { BaseProvider } from './base-provider.js';
import {
  queryClaudeSDK,
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  reconnectSessionWriter,
} from '../claude-sdk.js';

export class ClaudeSDKProvider extends BaseProvider {
  #writer = null;
  #capturedSessionId = null;

  constructor() {
    super('claude-sdk');
  }

  /**
   * Start a Claude SDK query session.
   * @param {object} config - { command, options, writer }
   * writer is a WebSocketWriter that has send() method
   */
  async start(config) {
    const { command, options, writer, transport, connectionId } = config;
    this.isRunning = true;
    this.#writer = writer;

    // Proxy writer: route through transport.send() for backpressure,
    // then emit provider events for SessionManager state tracking
    writer.send = (data) => {
      // Send via transport (backpressure-aware, seqId-stamped)
      if (transport && connectionId) {
        transport.send(connectionId, data);
      } else {
        // Fallback: direct WebSocket send (shouldn't happen in normal flow)
        if (writer.ws?.readyState === 1) writer.ws.send(JSON.stringify(data));
      }

      // Emit provider events for pipeline state tracking
      if (data.type === 'claude-response') {
        this.emitOutput(data);
      } else if (data.type === 'claude-complete') {
        this.#capturedSessionId = data.sessionId;
        this.sessionId = data.sessionId;
        this.emitComplete(data);
      } else if (data.type === 'claude-error') {
        this.emitError(new Error(data.error || 'Claude SDK error'));
      } else if (
        data.type === 'claude-phase' ||
        data.type === 'token-budget' ||
        data.type === 'claude-permission-request'
      ) {
        this.emitOutput(data);
      }
    };

    try {
      await queryClaudeSDK(command, options, writer);
      // queryClaudeSDK resolves when the query completes
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
      console.log(`[Provider:claude-sdk] Aborting session: ${sid}`);
      await abortClaudeSDKSession(sid);
    }
    this.isRunning = false;
  }

  isActive() {
    const sid = this.sessionId || this.#writer?.getSessionId?.();
    return sid ? isClaudeSDKSessionActive(sid) : false;
  }

  reconnectWriter(newWriter) {
    const sid = this.sessionId || this.#writer?.getSessionId?.();
    if (sid) {
      reconnectSessionWriter(sid, newWriter);
    }
  }

  dispose() {
    this.#writer = null;
    this.#capturedSessionId = null;
    super.dispose();
  }
}
