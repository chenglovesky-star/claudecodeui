import { EventEmitter } from 'events';

const PROVIDER_MAP = {
  'claude-command': 'claude',
  'cursor-command': 'cursor',
  'codex-command': 'codex',
  'gemini-command': 'gemini',
  'claude-cli-command': 'claude-cli',
};

export class MessageRouter extends EventEmitter {
  #transport;
  #sessionManager;
  #processManager;
  #messageBuffer;
  #registry;

  constructor({ transport, sessionManager, processManager, messageBuffer, registry }) {
    super();
    this.#transport = transport;
    this.#sessionManager = sessionManager;
    this.#processManager = processManager;
    this.#messageBuffer = messageBuffer;
    this.#registry = registry;
  }

  handleMessage(connectionId, message) {
    console.log(`[Router] handleMessage: type=${message.type} connectionId=${connectionId}`);
    switch (message.type) {
      case 'heartbeat':
        this.#transport.handleHeartbeat(connectionId, message);
        break;

      case 'claude-command':
      case 'cursor-command':
      case 'codex-command':
      case 'gemini-command':
      case 'claude-cli-command':
        this.#handleProviderCommand(connectionId, message);
        break;

      case 'abort-session':
        this.#handleAbort(connectionId, message);
        break;

      case 'resume':
        this.#handleResume(connectionId, message);
        break;

      case 'claude-permission-response':
        this.emit('router:permissionResponse', { connectionId, message });
        break;

      case 'check-session-status':
        this.emit('router:checkStatus', { connectionId, message });
        break;

      case 'get-pending-permissions':
        this.emit('router:getPendingPermissions', { connectionId, message });
        break;

      case 'get-active-sessions':
        this.emit('router:getActiveSessions', { connectionId, message });
        break;

      case 'cursor-resume':
        // Backward compat: treat as cursor-command with resume and no prompt
        message.type = 'cursor-command';
        message.command = '';
        message.options = { sessionId: message.sessionId, resume: true, cwd: message.options?.cwd };
        this.#handleProviderCommand(connectionId, message);
        break;

      case 'cursor-abort':
        // Backward compat: treat as abort-session for cursor provider
        message.provider = 'cursor';
        this.#handleAbort(connectionId, message);
        break;

      default:
        this.emit('router:unknown', { connectionId, message });
        break;
    }
  }

  #handleProviderCommand(connectionId, message) {
    const providerType = PROVIDER_MAP[message.type];
    const conn = this.#registry.get(connectionId);
    console.log(`[Router] handleProviderCommand: provider=${providerType} conn=${!!conn} userId=${conn?.userId}`);
    if (!conn) return;

    try {
      const sessionId = this.#sessionManager.create(conn.userId, connectionId, { providerType });
      console.log(`[Router] session created: ${sessionId}, transitioning to start`);
      this.#sessionManager.transition(sessionId, 'start');
      console.log(`[Router] emitting router:startSession, listeners=${this.listenerCount('router:startSession')}`);
      this.emit('router:startSession', { sessionId, providerType, connectionId, message });
    } catch (err) {
      console.error(`[Router] handleProviderCommand error:`, err.message);
      if (err.name === 'QuotaExceededError') {
        this.#transport.send(connectionId, { type: 'quota-exceeded', reason: err.message });
      } else {
        this.#transport.send(connectionId, { type: 'session-error', error: err.message });
      }
    }
  }

  #handleAbort(connectionId, message) {
    const { sessionId } = message;
    if (sessionId) {
      this.#sessionManager.abort(sessionId);
      this.#processManager.abortSession(sessionId);
      this.#transport.send(connectionId, { type: 'session-aborted', sessionId });
    }
  }

  #handleResume(connectionId, message) {
    const { sessionId, lastSeqId } = message;
    const session = this.#sessionManager.getSession(sessionId);
    const currentState = session ? session.state : 'completed';

    // Rebind session to the new connection so subsequent output/complete/error
    // events are delivered to the reconnected client instead of the stale one.
    if (session && session.connectionId !== connectionId) {
      this.#sessionManager.rebindConnection(sessionId, connectionId);

      // Also reconnect the SDK writer to the new WebSocket
      const conn = this.#registry?.get(connectionId);
      if (conn?.ws) {
        const provider = this.#processManager.getProviderForSession?.(sessionId);
        if (provider?.reconnectWriter) {
          provider.reconnectWriter({ ws: conn.ws });
        }
      }
    }

    const resumeData = this.#messageBuffer.getResumeData(sessionId, lastSeqId, currentState);
    this.#transport.send(connectionId, { type: 'resume-response', ...resumeData });
  }

  bindEvents() {
    this.#sessionManager.on('session:timeout', ({ sessionId, timeoutType }) => {
      const session = this.#sessionManager.getSession(sessionId);
      if (session) {
        this.#transport.send(session.connectionId, { type: 'session-timeout', sessionId, timeoutType });
        this.#messageBuffer.addCriticalEvent(sessionId, { type: 'session-timeout', sessionId, timeoutType });
      }
      this.#processManager.abortSession(sessionId);
    });

    this.#processManager.on('process:output', ({ sessionId, data }) => {
      const session = this.#sessionManager.getSession(sessionId);
      if (!session) return;
      this.#sessionManager.transition(sessionId, 'output');
      if (data?.data?.delta?.text) {
        this.#messageBuffer.appendContent(sessionId, data.data.delta.text);
      }
    });

    this.#processManager.on('process:complete', ({ sessionId, result }) => {
      this.#sessionManager.transition(sessionId, 'complete');
      this.#messageBuffer.addCriticalEvent(sessionId, { type: 'session-completed', sessionId });
      const session = this.#sessionManager.getSession(sessionId);
      if (session) {
        this.#transport.send(session.connectionId, { type: 'session-completed', sessionId });
      }
      this.#sessionManager.cleanup(sessionId);
      setTimeout(() => this.#messageBuffer.clearSession(sessionId), 60000);
    });

    this.#processManager.on('process:error', ({ sessionId, error }) => {
      this.#sessionManager.transition(sessionId, 'error');
      this.#messageBuffer.addCriticalEvent(sessionId, { type: 'session-error', sessionId, error: error?.message });
      const session = this.#sessionManager.getSession(sessionId);
      if (session) {
        this.#transport.send(session.connectionId, { type: 'session-error', sessionId, error: error?.message });
      }
      this.#sessionManager.cleanup(sessionId);
      setTimeout(() => this.#messageBuffer.clearSession(sessionId), 60000);
    });
  }
}

export default MessageRouter;
