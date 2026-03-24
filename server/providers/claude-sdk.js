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
  #suppressError = false;  // When true, suppress claude-error events during auth retry

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
        if (this.#suppressError) {
          // During auth retry: suppress error event and don't send to frontend
          // The retry handler will deal with success/failure
          return;
        }
        this.emitError(new Error(data.error || 'Claude SDK error'));
      } else if (
        data.type === 'claude-phase' ||
        data.type === 'token-budget' ||
        data.type === 'claude-permission-request'
      ) {
        // Phase/meta messages: 发送给客户端但不触发 streaming 状态转换
        // 避免过早清除 firstResponse 计时器
        this.emitPhase(data);
      }
    };

    // If key pool key is assigned, suppress error events from first attempt
    // so we can transparently retry with OAuth if it fails
    const canRetryAuth = !!(options._assignedApiKey && !options._authRetried);
    if (canRetryAuth) {
      this.#suppressError = true;
    }

    try {
      await queryClaudeSDK(command, options, writer);
      // queryClaudeSDK resolves when the query completes
      this.#suppressError = false;
      if (this.isRunning) {
        this.isRunning = false;
      }
    } catch (error) {
      this.#suppressError = false;

      if (error._isRateLimit && error._rateLimitPhase === 'pre-stream') {
        // Send rate-limit-retry phase to frontend
        if (transport && connectionId) {
          transport.send(connectionId, {
            type: 'claude-phase',
            phase: 'rate-limit-retry',
            retryAfterSec: 5,
            sessionId: null,
          });
        }
        // Pre-stream 429: notify upper layer to switch key and retry
        this.emit('rate-limited', {
          keyId: options._assignedKeyId,
          phase: 'pre-stream',
          command,
          options,
          connectionId,
        });
        return;
      }

      if (error._isRateLimit && error._rateLimitPhase === 'mid-stream') {
        // Mid-stream 429: cannot transparently retry, notify user
        writer.send({
          type: 'claude-error',
          error: '请求被限速中断，请点击继续恢复对话',
          code: 'RATE_LIMIT_MID_STREAM',
          resumable: true,
        });
        this.emit('rate-limited', {
          keyId: options._assignedKeyId,
          phase: 'mid-stream',
        });
        return;
      }

      // Auth failure with key pool key: retry without assigned key (fall back to OAuth/system auth)
      const isAuthError = error.message?.includes('exited with code 1')
        || error.message?.includes('authentication')
        || error.message?.includes('invalid api key')
        || error.message?.includes('401');
      if (isAuthError && canRetryAuth) {
        console.log('[Provider:claude-sdk] Key pool key auth failed, retrying with system auth (OAuth)...');

        // Emit recovery events to pause timers
        this.emitRecoveryStart();

        // Send auth-fallback phase (replaces configuring)
        if (transport && connectionId) {
          transport.send(connectionId, {
            type: 'claude-phase',
            phase: 'auth-fallback',
            attempt: 1,
            maxAttempts: 2,
            sessionId: null,
          });
        }
        const fallbackOptions = { ...options };
        delete fallbackOptions._assignedApiKey;
        delete fallbackOptions._assignedKeyId;
        // Also clear sessionId to avoid resuming a broken session
        delete fallbackOptions.sessionId;
        fallbackOptions._authRetried = true;
        try {
          await queryClaudeSDK(command, fallbackOptions, writer);
          this.emitRecoveryEnd(true);
          if (this.isRunning) this.isRunning = false;
          return;
        } catch (retryError) {
          this.emitRecoveryEnd(false);
          this.emitError(retryError);
          return;
        }
      }

      // Non-429 error: emit error event (don't re-throw to avoid unhandled rejection)
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
