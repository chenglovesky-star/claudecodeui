import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage, PendingPermissionRequest } from '../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import { appendStreamingChunk, finalizeStreamingMessage } from './handlers/streamUtils';
import type { HandlerContext, LatestChatMessage, PendingViewSession } from './handlers/types';

// Claude handlers
import {
  handleClaudePhase,
  handleClaudeResponse,
  handleClaudeOutput,
  handleClaudeInteractivePrompt,
  handleClaudePermissionRequest,
  handleClaudePermissionCancelled,
  handleClaudeError,
  handleClaudeComplete,
  handleClaudeCliError,
} from './handlers/claudeHandler';

// Cursor handlers
import {
  handleCursorSystem,
  handleCursorUser,
  handleCursorToolUse,
  handleCursorError,
  handleCursorResult,
  handleCursorOutput,
} from './handlers/cursorHandler';

// Codex handlers
import {
  handleCodexResponse,
  handleCodexComplete,
  handleCodexError,
} from './handlers/codexHandler';

// Gemini handlers
import {
  handleGeminiResponse,
  handleGeminiError,
  handleGeminiToolUse,
  handleGeminiToolResult,
} from './handlers/geminiHandler';

// Pipeline handlers
import {
  handleSessionTimeout,
  handleSessionError,
  handleQuotaExceeded,
  handleSessionCompleted,
  handleResumeResponse,
} from './handlers/pipelineHandler';

interface UseChatRealtimeHandlersArgs {
  latestMessage: LatestChatMessage | null;
  provider: SessionProvider;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setIsSystemSessionChange: (isSystemSessionChange: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (sessionId: string) => void;
}

export function useChatRealtimeHandlers({
  latestMessage,
  provider,
  selectedProject,
  selectedSession,
  currentSessionId,
  setCurrentSessionId,
  setChatMessages,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setTokenBudget,
  setIsSystemSessionChange,
  setPendingPermissionRequests,
  pendingViewSessionRef,
  streamBufferRef,
  streamTimerRef,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onReplaceTemporarySession,
  onNavigateToSession,
}: UseChatRealtimeHandlersArgs) {
  const lastProcessedMessageRef = useRef<LatestChatMessage | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const startFallbackTimer = useCallback(() => {
    clearFallbackTimer();
    const timeout = 90000;
    fallbackTimerRef.current = setTimeout(() => {
      console.warn('[Chat] Fallback timeout triggered - server appears unresponsive');
      setChatMessages(prev => [...prev, {
        type: 'error',
        content: '响应超时，请重试或中止当前会话',
        timestamp: new Date(),
        isTimeout: true,
        timeoutType: 'clientFallback',
      }]);
      setIsLoading(false);
    }, timeout);
  }, [clearFallbackTimer, setChatMessages, setIsLoading]);

  const resetFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current) {
      startFallbackTimer();
    }
  }, [startFallbackTimer]);

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    // Guard against duplicate processing when dependency updates occur without a new message object.
    if (lastProcessedMessageRef.current === latestMessage) {
      return;
    }
    lastProcessedMessageRef.current = latestMessage;

    const messageData = latestMessage.data?.message || latestMessage.data;
    const structuredMessageData =
      messageData && typeof messageData === 'object' ? (messageData as Record<string, any>) : null;
    const rawStructuredData =
      latestMessage.data && typeof latestMessage.data === 'object'
        ? (latestMessage.data as Record<string, any>)
        : null;
    const messageType = String(latestMessage.type);

    const globalMessageTypes = ['projects_updated', 'taskmaster-project-updated', 'session-created', 'claude-phase'];
    const isGlobalMessage = globalMessageTypes.includes(messageType);
    const lifecycleMessageTypes = new Set([
      'claude-complete',
      'codex-complete',
      'cursor-result',
      'session-aborted',
      'claude-error',
      'cursor-error',
      'codex-error',
      'gemini-error',
      'claude-cli-error',
      'error',
    ]);

    const isClaudeSystemInit =
      latestMessage.type === 'claude-response' &&
      structuredMessageData &&
      structuredMessageData.type === 'system' &&
      structuredMessageData.subtype === 'init';

    const isCursorSystemInit =
      latestMessage.type === 'cursor-system' &&
      rawStructuredData &&
      rawStructuredData.type === 'system' &&
      rawStructuredData.subtype === 'init';

    const systemInitSessionId = isClaudeSystemInit
      ? structuredMessageData?.session_id
      : isCursorSystemInit
        ? rawStructuredData?.session_id
        : null;

    const activeViewSessionId =
      selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || null;
    const hasPendingUnboundSession =
      Boolean(pendingViewSessionRef.current) && !pendingViewSessionRef.current?.sessionId;
    const isSystemInitForView =
      systemInitSessionId && (!activeViewSessionId || systemInitSessionId === activeViewSessionId);
    const shouldBypassSessionFilter = isGlobalMessage || Boolean(isSystemInitForView);
    const isLifecycleMessage = lifecycleMessageTypes.has(messageType);
    const isUnscopedError =
      !latestMessage.sessionId &&
      pendingViewSessionRef.current &&
      !pendingViewSessionRef.current.sessionId &&
      (latestMessage.type === 'claude-error' ||
        latestMessage.type === 'cursor-error' ||
        latestMessage.type === 'codex-error' ||
        latestMessage.type === 'gemini-error' ||
        latestMessage.type === 'claude-cli-error');

    const handleBackgroundLifecycle = (sessionId?: string) => {
      if (!sessionId) {
        return;
      }
      onSessionInactive?.(sessionId);
      onSessionNotProcessing?.(sessionId);
    };

    const collectSessionIds = (...sessionIds: Array<string | null | undefined>) =>
      Array.from(
        new Set(
          sessionIds.filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0),
        ),
      );

    const clearLoadingIndicators = () => {
      setIsLoading(false);
      setCanAbortSession(false);
      setClaudeStatus(null);
    };

    const clearPendingViewSession = (resolvedSessionId?: string | null) => {
      const pendingSession = pendingViewSessionRef.current;
      if (!pendingSession) {
        return;
      }

      // If the in-view request never received a concrete session ID (or this terminal event
      // resolves the same pending session), clear it to avoid stale "in-flight" UI state.
      if (!pendingSession.sessionId || !resolvedSessionId || pendingSession.sessionId === resolvedSessionId) {
        pendingViewSessionRef.current = null;
      }
    };

    const flushStreamingState = () => {
      if (streamTimerRef.current) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      const pendingChunk = streamBufferRef.current;
      streamBufferRef.current = '';
      appendStreamingChunk(setChatMessages, pendingChunk, false);
      finalizeStreamingMessage(setChatMessages);
    };

    const markSessionsAsCompleted = (...sessionIds: Array<string | null | undefined>) => {
      const normalizedSessionIds = collectSessionIds(...sessionIds);
      normalizedSessionIds.forEach((sessionId) => {
        onSessionInactive?.(sessionId);
        onSessionNotProcessing?.(sessionId);
      });
    };

    const finalizeLifecycleForCurrentView = (...sessionIds: Array<string | null | undefined>) => {
      const pendingSessionId = typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;
      const resolvedSessionIds = collectSessionIds(...sessionIds, pendingSessionId, pendingViewSessionRef.current?.sessionId);
      const resolvedPrimarySessionId = resolvedSessionIds[0] || null;

      flushStreamingState();
      clearLoadingIndicators();
      markSessionsAsCompleted(...resolvedSessionIds);
      setPendingPermissionRequests([]);
      clearPendingViewSession(resolvedPrimarySessionId);
    };

    if (!shouldBypassSessionFilter) {
      if (!activeViewSessionId) {
        if (latestMessage.sessionId && isLifecycleMessage && !hasPendingUnboundSession) {
          handleBackgroundLifecycle(latestMessage.sessionId);
          return;
        }
        if (!isUnscopedError && !hasPendingUnboundSession) {
          return;
        }
      }

      if (!latestMessage.sessionId && !isUnscopedError && !hasPendingUnboundSession) {
        return;
      }

      if (latestMessage.sessionId !== activeViewSessionId) {
        const shouldTreatAsPendingViewLifecycle =
          !activeViewSessionId &&
          hasPendingUnboundSession &&
          latestMessage.sessionId &&
          isLifecycleMessage;

        if (!shouldTreatAsPendingViewLifecycle) {
          if (latestMessage.sessionId && isLifecycleMessage) {
            handleBackgroundLifecycle(latestMessage.sessionId);
          }
          return;
        }
      }
    }

    // Build the handler context object
    const ctx: HandlerContext = {
      provider,
      selectedProject,
      selectedSession,
      currentSessionId,
      setCurrentSessionId,
      setChatMessages,
      setIsLoading,
      setCanAbortSession,
      setClaudeStatus,
      setTokenBudget,
      setIsSystemSessionChange,
      setPendingPermissionRequests,
      pendingViewSessionRef,
      streamBufferRef,
      streamTimerRef,
      onSessionInactive,
      onSessionProcessing,
      onSessionNotProcessing,
      onReplaceTemporarySession,
      onNavigateToSession,
      finalizeLifecycleForCurrentView,
      clearFallbackTimer,
      startFallbackTimer,
      resetFallbackTimer,
      clearLoadingIndicators,
      isSystemInitForView,
    };

    switch (latestMessage.type) {
      case 'claude-phase':
        handleClaudePhase(ctx, latestMessage);
        break;

      case 'session-created':
        if (latestMessage.sessionId && !currentSessionId) {
          sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);
          if (pendingViewSessionRef.current && !pendingViewSessionRef.current.sessionId) {
            pendingViewSessionRef.current.sessionId = latestMessage.sessionId;
          }

          setIsSystemSessionChange(true);
          onReplaceTemporarySession?.(latestMessage.sessionId);

          setPendingPermissionRequests((previous) =>
            previous.map((request) =>
              request.sessionId ? request : { ...request, sessionId: latestMessage.sessionId },
            ),
          );
        }
        // Start fallback timer for all providers (not just Claude)
        startFallbackTimer();
        break;

      case 'token-budget':
        if (latestMessage.data) {
          setTokenBudget(latestMessage.data);
        }
        break;

      case 'claude-response':
        handleClaudeResponse(ctx, latestMessage);
        break;

      case 'claude-output':
        handleClaudeOutput(ctx, latestMessage);
        break;

      case 'claude-interactive-prompt':
        handleClaudeInteractivePrompt(ctx, latestMessage);
        break;

      case 'claude-permission-request':
        handleClaudePermissionRequest(ctx, latestMessage);
        break;

      case 'claude-permission-cancelled':
        handleClaudePermissionCancelled(ctx, latestMessage);
        break;

      case 'claude-error':
        handleClaudeError(ctx, latestMessage);
        break;

      case 'claude-complete':
        handleClaudeComplete(ctx, latestMessage);
        break;

      case 'claude-cli-error':
        handleClaudeCliError(ctx, latestMessage);
        break;

      case 'cursor-system':
        handleCursorSystem(ctx, latestMessage);
        break;

      case 'cursor-user':
        handleCursorUser(ctx, latestMessage);
        break;

      case 'cursor-tool-use':
        handleCursorToolUse(ctx, latestMessage);
        break;

      case 'cursor-error':
        handleCursorError(ctx, latestMessage);
        break;

      case 'cursor-result':
        handleCursorResult(ctx, latestMessage);
        break;

      case 'cursor-output':
        handleCursorOutput(ctx, latestMessage);
        break;

      case 'codex-response':
        handleCodexResponse(ctx, latestMessage);
        break;

      case 'codex-complete':
        handleCodexComplete(ctx, latestMessage);
        break;

      case 'codex-error':
        handleCodexError(ctx, latestMessage);
        break;

      case 'gemini-response':
        handleGeminiResponse(ctx, latestMessage);
        break;

      case 'gemini-error':
        handleGeminiError(ctx, latestMessage);
        break;

      case 'gemini-tool-use':
        handleGeminiToolUse(ctx, latestMessage);
        break;

      case 'gemini-tool-result':
        handleGeminiToolResult(ctx, latestMessage);
        break;

      case 'session-aborted': {
        clearFallbackTimer();
        const pendingSessionId =
          typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;
        const abortedSessionId = latestMessage.sessionId || currentSessionId;
        const abortSucceeded = latestMessage.success !== false;

        if (abortSucceeded) {
          finalizeLifecycleForCurrentView(abortedSessionId, currentSessionId, selectedSession?.id, pendingSessionId);
          if (pendingSessionId && (!abortedSessionId || pendingSessionId === abortedSessionId)) {
            sessionStorage.removeItem('pendingSessionId');
          }

          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: 'Session interrupted by user.',
              timestamp: new Date(),
            },
          ]);
        } else {
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'error',
              content: 'Stop request failed. The session is still running.',
              timestamp: new Date(),
            },
          ]);
        }
        break;
      }

      case 'session-status': {
        const statusSessionId = latestMessage.sessionId;
        if (!statusSessionId) {
          break;
        }

        const isCurrentSession =
          statusSessionId === currentSessionId || (selectedSession && statusSessionId === selectedSession.id);

        if (latestMessage.isProcessing) {
          onSessionProcessing?.(statusSessionId);
          if (isCurrentSession) {
            setIsLoading(true);
            setCanAbortSession(true);
          }
          break;
        }

        onSessionInactive?.(statusSessionId);
        onSessionNotProcessing?.(statusSessionId);
        if (isCurrentSession) {
          clearLoadingIndicators();
        }
        break;
      }

      case 'claude-status': {
        const statusData = latestMessage.data;
        if (!statusData) {
          break;
        }

        const statusInfo: { text: string; tokens: number; can_interrupt: boolean } = {
          text: 'Working...',
          tokens: 0,
          can_interrupt: true,
        };

        if (statusData.message) {
          statusInfo.text = statusData.message;
        } else if (statusData.status) {
          statusInfo.text = statusData.status;
        } else if (typeof statusData === 'string') {
          statusInfo.text = statusData;
        }

        if (statusData.tokens) {
          statusInfo.tokens = statusData.tokens;
        } else if (statusData.token_count) {
          statusInfo.tokens = statusData.token_count;
        }

        if (statusData.can_interrupt !== undefined) {
          statusInfo.can_interrupt = statusData.can_interrupt;
        }

        setClaudeStatus(statusInfo);
        setIsLoading(true);
        setCanAbortSession(statusInfo.can_interrupt);
        break;
      }

      case 'pending-permissions-response': {
        // Server returned pending permissions for this session
        const permSessionId = latestMessage.sessionId;
        const isCurrentPermSession =
          permSessionId === currentSessionId || (selectedSession && permSessionId === selectedSession.id);
        if (permSessionId && !isCurrentPermSession) {
          break;
        }
        const serverRequests = latestMessage.data || [];
        setPendingPermissionRequests(serverRequests);
        break;
      }

      case 'error':
        // Generic backend failure (e.g., provider process failed before a provider-specific
        // completion event was emitted). Treat it as terminal for current view lifecycle.
        clearFallbackTimer();
        finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        if (latestMessage.error) {
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'error' as const,
              content: `Error: ${latestMessage.error}`,
              timestamp: new Date(),
            },
          ]);
        }
        break;

      case 'session-timeout':
        handleSessionTimeout(ctx, latestMessage);
        break;

      case 'session-error':
        handleSessionError(ctx, latestMessage);
        break;

      case 'quota-exceeded':
        handleQuotaExceeded(ctx, latestMessage);
        break;

      case 'session-completed':
        handleSessionCompleted(ctx, latestMessage);
        break;

      case 'resume-response':
        handleResumeResponse(ctx, latestMessage);
        break;

      default:
        break;
    }
  }, [
    latestMessage,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setChatMessages,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setTokenBudget,
    setIsSystemSessionChange,
    setPendingPermissionRequests,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onReplaceTemporarySession,
    onNavigateToSession,
    startFallbackTimer,
    resetFallbackTimer,
    clearFallbackTimer,
  ]);

  useEffect(() => {
    return () => {
      clearFallbackTimer();
    };
  }, [clearFallbackTimer]);
}
