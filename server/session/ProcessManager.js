// server/session/ProcessManager.js
// Provider dispatch, lifecycle management, and force cleanup (P2)

import { EventEmitter } from 'events';
import {
  PROCESS_SIGTERM_TIMEOUT_MS,
  PROCESS_SIGKILL_TIMEOUT_MS,
} from '../config/constants.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('Process');

// ── ProcessManager ────────────────────────────────────────────────────────────
export class ProcessManager extends EventEmitter {
  /** @type {Map<string, Function>} providerType → ProviderClass */
  #registry = new Map();

  /** @type {Map<string, { provider: object, providerType: string, startedAt: number }>} */
  #activeProviders = new Map();

  constructor() {
    super();
  }

  // ── Provider registration ─────────────────────────────────────────────────

  /**
   * Register a provider class for a given type.
   * @param {string} type - e.g. 'claude', 'claude-cli', 'cursor', 'gemini', 'codex'
   * @param {Function} ProviderClass - the class itself (not an instance)
   */
  registerProvider(type, ProviderClass) {
    this.#registry.set(type, ProviderClass);
    log.info(`registered provider type: ${type}`);
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

  /**
   * Create a provider instance and start it in the background.
   * @param {string} sessionId
   * @param {string} providerType
   * @param {object} config
   */
  startSession(sessionId, providerType, config) {
    const ProviderClass = this.#registry.get(providerType);
    if (!ProviderClass) {
      throw new Error(`[Process] unknown provider type: ${providerType}`);
    }

    const provider = new ProviderClass();
    provider.sessionId = sessionId;

    // Bind lifecycle events
    provider.on('output', (data) => {
      this.emit('process:output', { sessionId, data });
    });

    provider.on('complete', (result) => {
      this.emit('process:complete', { sessionId, result });
      this.#cleanup(sessionId);
    });

    provider.on('error', (error) => {
      this.emit('process:error', { sessionId, error });
      this.#cleanup(sessionId);
    });

    // Store in active map before starting
    this.#activeProviders.set(sessionId, {
      provider,
      providerType,
      startedAt: Date.now(),
    });

    // Start in background (do not await)
    provider.start(config);

    log.info(`started ${providerType} session ${sessionId}`);
  }

  /**
   * Abort a session with SIGTERM → SIGKILL escalation.
   * @param {string} sessionId
   */
  async abortSession(sessionId) {
    const entry = this.#activeProviders.get(sessionId);
    if (!entry) {
      log.warn(`abortSession: session ${sessionId} not found`);
      return;
    }

    const { provider } = entry;

    // Step 1: send abort (SIGTERM equivalent)
    provider.abort();

    // Step 2: wait up to SIGTERM timeout for clean exit
    const cleanExit = await this.#waitForExit(provider, PROCESS_SIGTERM_TIMEOUT_MS);

    if (!cleanExit) {
      // Step 3: escalate to force kill (SIGKILL equivalent)
      log.warn(`session ${sessionId} did not exit after SIGTERM, force killing`);
      provider.dispose();

      // Step 4: wait for SIGKILL timeout
      await new Promise((resolve) => setTimeout(resolve, PROCESS_SIGKILL_TIMEOUT_MS));
    }

    // Step 5: force remove from map regardless
    this.#activeProviders.delete(sessionId);

    // Step 6: emit killed event
    this.emit('process:killed', { sessionId });
    log.info(`session ${sessionId} killed`);
  }

  // ── Query helpers ─────────────────────────────────────────────────────────

  /**
   * @param {string} sessionId
   * @returns {boolean}
   */
  isActive(sessionId) {
    return this.#activeProviders.has(sessionId);
  }

  /**
   * Get the provider instance for a session (for reconnection etc.)
   * @param {string} sessionId
   * @returns {object|undefined}
   */
  getProviderForSession(sessionId) {
    return this.#activeProviders.get(sessionId)?.provider;
  }

  /**
   * @returns {{ sessionId: string, providerType: string, startedAt: number }[]}
   */
  getActive() {
    const result = [];
    for (const [sessionId, { providerType, startedAt }] of this.#activeProviders) {
      result.push({ sessionId, providerType, startedAt });
    }
    return result;
  }

  /**
   * @param {string} type
   * @returns {{ sessionId: string, providerType: string, startedAt: number }[]}
   */
  getActiveByProvider(type) {
    return this.getActive().filter((entry) => entry.providerType === type);
  }

  // ── Dispose ───────────────────────────────────────────────────────────────

  /**
   * Abort all active sessions.
   */
  async dispose() {
    const sessionIds = [...this.#activeProviders.keys()];
    await Promise.all(sessionIds.map((id) => this.abortSession(id)));
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Remove session from map and dispose provider.
   * @param {string} sessionId
   */
  #cleanup(sessionId) {
    const entry = this.#activeProviders.get(sessionId);
    if (!entry) return;
    this.#activeProviders.delete(sessionId);
    try {
      entry.provider.dispose();
    } catch {
      // ignore dispose errors during normal cleanup
    }
    log.info(`cleaned up session ${sessionId}`);
  }

  /**
   * Race: wait for provider 'complete' or 'error' within timeoutMs.
   * @param {EventEmitter} provider
   * @param {number} timeoutMs
   * @returns {Promise<boolean>} true if exited cleanly, false if timed out
   */
  #waitForExit(provider, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;

      const onDone = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        provider.removeListener('complete', onDone);
        provider.removeListener('error', onDone);
        resolve(false);
      }, timeoutMs);

      provider.once('complete', onDone);
      provider.once('error', onDone);
    });
  }
}

export default ProcessManager;
