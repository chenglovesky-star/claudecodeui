import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { decodeHtmlEntities, formatUsageLimitText } from '../utils/chatFormatting';
import { safeLocalStorage } from '../utils/chatStorage';
import type { ChatMessage, PendingPermissionRequest } from '../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

type LatestChatMessage = {
  type?: string;
  data?: any;
  sessionId?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  tool?: string;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  [key: string]: any;
};

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

const appendStreamingChunk = (
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  chunk: string,
  newline = false,
) => {
  if (!chunk) {
    return;
  }

  setChatMessages((previous) => {
    const updated = [...previous];
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
      const nextContent = newline
        ? last.content
          ? `${last.content}\n${chunk}`
          : chunk
        : `${last.content || ''}${chunk}`;
      // Clone the message instead of mutating in place so React can reliably detect state updates.
      updated[lastIndex] = { ...last, content: nextContent };
    } else {
      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
    }
    return updated;
  });
};

// Typewriter effect for non-streaming (bulk) text responses
const TYPEWRITER_CHUNK_SIZE = 8; // characters per tick
const TYPEWRITER_INTERVAL_MS = 16; // ~60fps
let activeTypewriterTimer: ReturnType<typeof setInterval> | null = null;

const typewriterAppend = (
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  fullText: string,
) => {
  // Cancel any previous typewriter animation
  if (activeTypewriterTimer) {
    clearInterval(activeTypewriterTimer);
    activeTypewriterTimer = null;
  }

  // Short text doesn't need animation
  if (fullText.length <= 50) {
    setChatMessages((previous) => [
      ...previous,
      { type: 'assistant', content: fullText, timestamp: new Date() },
    ]);
    return;
  }

  // Start with empty streaming message
  setChatMessages((previous) => [
    ...previous,
    { type: 'assistant', content: '', timestamp: new Date(), isStreaming: true },
  ]);

  let offset = 0;
  activeTypewriterTimer = setInterval(() => {
    const end = Math.min(offset + TYPEWRITER_CHUNK_SIZE, fullText.length);
    const chunk = fullText.slice(offset, end);
    offset = end;

    appendStreamingChunk(setChatMessages, chunk, false);

    if (offset >= fullText.length) {
      if (activeTypewriterTimer) {
        clearInterval(activeTypewriterTimer);
        activeTypewriterTimer = null;
      }
      finalizeStreamingMessage(setChatMessages);
    }
  }, TYPEWRITER_INTERVAL_MS);
};

const finalizeStreamingMessage = (setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>) => {
  setChatMessages((previous) => {
    const updated = [...previous];
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (last && last.type === 'assistant' && last.isStreaming) {
      // Clone the message instead of mutating in place so React can reliably detect state updates.
      updated[lastIndex] = { ...last, isStreaming: false };
    }
    return updated;
  });
};

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

    switch (latestMessage.type) {
      case 'claude-phase': {
        const phaseTexts: Record<string, string> = {
          acknowledged: '正在准备',
          configuring: '正在加载配置',
          querying: '正在思考中',
        };
        const phaseText = phaseTexts[latestMessage.phase as string] || '处理中';
        setClaudeStatus({ text: phaseText, tokens: 0, can_interrupt: true });
        setIsLoading(true);
        setCanAbortSession(true);
        if (latestMessage.phase === 'acknowledged') {
          startFallbackTimer();
        }
        break;
      }

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

      case 'claude-response': {
        // Reset fallback timer on ANY claude-response, not just text delta
        // This prevents false timeouts during tool_use, subagent execution, etc.
        resetFallbackTimer();
        if (messageData && typeof messageData === 'object' && messageData.type) {
          // Handle thinking delta (streaming thinking content)
          if (messageData.type === 'content_block_delta' && messageData.delta?.type === 'thinking_delta') {
            const thinkingText = messageData.delta.thinking || '';
            if (thinkingText) {
              setChatMessages((previous) => {
                const updated = [...previous];
                const lastIndex = updated.length - 1;
                const last = updated[lastIndex];
                if (last && last.type === 'assistant' && last.isThinking && last.isStreaming) {
                  updated[lastIndex] = { ...last, content: (last.content || '') + thinkingText };
                } else {
                  updated.push({
                    type: 'assistant',
                    content: thinkingText,
                    timestamp: new Date(),
                    isThinking: true,
                    isStreaming: true,
                  });
                }
                return updated;
              });
            }
            return;
          }

          // Handle content_block_start for thinking blocks
          if (messageData.type === 'content_block_start' && messageData.content_block?.type === 'thinking') {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: '',
                timestamp: new Date(),
                isThinking: true,
                isStreaming: true,
              },
            ]);
            return;
          }

          if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
            const decodedText = decodeHtmlEntities(messageData.delta.text);
            const isFirstChunk = !streamBufferRef.current && !streamTimerRef.current;
            streamBufferRef.current += decodedText;
            resetFallbackTimer();
            if (isFirstChunk) {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              appendStreamingChunk(setChatMessages, chunk, false);
              setClaudeStatus(null);
            } else if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 100);
            }
            return;
          }

          if (messageData.type === 'content_block_stop') {
            // Finalize streaming thinking message if active
            setChatMessages((previous) => {
              const updated = [...previous];
              const lastIndex = updated.length - 1;
              const last = updated[lastIndex];
              if (last && last.type === 'assistant' && last.isThinking && last.isStreaming) {
                updated[lastIndex] = { ...last, isStreaming: false };
              }
              return updated;
            });

            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const chunk = streamBufferRef.current;
            streamBufferRef.current = '';
            appendStreamingChunk(setChatMessages, chunk, false);
            finalizeStreamingMessage(setChatMessages);
            return;
          }

          // Handle SDK result message — extract response text from result field
          if (messageData.type === 'result' && messageData.result) {
            const resultText = typeof messageData.result === 'string' ? messageData.result.trim() : '';
            if (resultText) {
              setClaudeStatus(null);
              // Use setChatMessages atomically to avoid duplicates
              setChatMessages((previous) => {
                // Check if this text is already displayed
                const alreadyShown = previous.some(
                  (m) => m.type === 'assistant' && !m.isToolUse && !m.isThinking && m.content === resultText
                );
                if (alreadyShown) return previous;

                // Check if the last assistant message has content (from streaming)
                const last = previous[previous.length - 1];
                if (last?.type === 'assistant' && !last.isToolUse && !last.isThinking && last.content?.trim()) {
                  return previous; // streaming already showed content
                }

                return [
                  ...previous,
                  { type: 'assistant' as const, content: resultText, timestamp: new Date() },
                ];
              });
            }
            return;
          }
        }

        if (
          structuredMessageData?.type === 'system' &&
          structuredMessageData.subtype === 'init' &&
          structuredMessageData.session_id &&
          currentSessionId &&
          structuredMessageData.session_id !== currentSessionId &&
          isSystemInitForView
        ) {
          setIsSystemSessionChange(true);
          onNavigateToSession?.(structuredMessageData.session_id);
          return;
        }

        if (
          structuredMessageData?.type === 'system' &&
          structuredMessageData.subtype === 'init' &&
          structuredMessageData.session_id &&
          !currentSessionId &&
          isSystemInitForView
        ) {
          setIsSystemSessionChange(true);
          onNavigateToSession?.(structuredMessageData.session_id);
          return;
        }

        if (
          structuredMessageData?.type === 'system' &&
          structuredMessageData.subtype === 'init' &&
          structuredMessageData.session_id &&
          currentSessionId &&
          structuredMessageData.session_id === currentSessionId &&
          isSystemInitForView
        ) {
          return;
        }

        if (structuredMessageData && Array.isArray(structuredMessageData.content)) {
          const parentToolUseId = rawStructuredData?.parentToolUseId;

          structuredMessageData.content.forEach((part: any) => {
            if (part.type === 'tool_use') {
              const toolInput = part.input ? JSON.stringify(part.input, null, 2) : '';

              // Check if this is a child tool from a subagent
              if (parentToolUseId) {
                setChatMessages((previous) =>
                  previous.map((message) => {
                    if (message.toolId === parentToolUseId && message.isSubagentContainer) {
                      const childTool = {
                        toolId: part.id,
                        toolName: part.name,
                        toolInput: part.input,
                        toolResult: null,
                        timestamp: new Date(),
                      };
                      const existingChildren = message.subagentState?.childTools || [];
                      return {
                        ...message,
                        subagentState: {
                          childTools: [...existingChildren, childTool],
                          currentToolIndex: existingChildren.length,
                          isComplete: false,
                        },
                      };
                    }
                    return message;
                  }),
                );
                return;
              }

              // Check if this is a Task tool (subagent container)
              const isSubagentContainer = part.name === 'Task';

              setChatMessages((previous) => [
                ...previous,
                {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(),
                  isToolUse: true,
                  toolName: part.name,
                  toolInput,
                  toolId: part.id,
                  toolResult: null,
                  isSubagentContainer,
                  subagentState: isSubagentContainer
                    ? { childTools: [], currentToolIndex: -1, isComplete: false }
                    : undefined,
                },
              ]);
              return;
            }

            if (part.type === 'thinking' && part.thinking?.trim()) {
              const thinkingContent = decodeHtmlEntities(part.thinking);
              setChatMessages((previous) => [
                ...previous,
                {
                  type: 'assistant',
                  content: thinkingContent,
                  timestamp: new Date(),
                  isThinking: true,
                },
              ]);
              return;
            }

            if (part.type === 'text' && part.text?.trim()) {
              let content = decodeHtmlEntities(part.text);
              content = formatUsageLimitText(content);
              setClaudeStatus(null);
              setChatMessages((previous) => [
                ...previous,
                { type: 'assistant', content, timestamp: new Date() },
              ]);
            }
          });
        } else if (structuredMessageData && typeof structuredMessageData.content === 'string' && structuredMessageData.content.trim()) {
          let content = decodeHtmlEntities(structuredMessageData.content);
          content = formatUsageLimitText(content);
          setClaudeStatus(null);
          setChatMessages((previous) => [
            ...previous,
            { type: 'assistant', content, timestamp: new Date() },
          ]);
        }

        if (structuredMessageData?.role === 'user' && Array.isArray(structuredMessageData.content)) {
          const parentToolUseId = rawStructuredData?.parentToolUseId;

          structuredMessageData.content.forEach((part: any) => {
            if (part.type !== 'tool_result') {
              return;
            }

            setChatMessages((previous) =>
              previous.map((message) => {
                // Handle child tool results (route to parent's subagentState)
                if (parentToolUseId && message.toolId === parentToolUseId && message.isSubagentContainer) {
                  return {
                    ...message,
                    subagentState: {
                      ...message.subagentState!,
                      childTools: message.subagentState!.childTools.map((child) => {
                        if (child.toolId === part.tool_use_id) {
                          return {
                            ...child,
                            toolResult: {
                              content: part.content,
                              isError: part.is_error,
                              timestamp: new Date(),
                            },
                          };
                        }
                        return child;
                      }),
                    },
                  };
                }

                // Handle normal tool results (including parent Task tool completion)
                if (message.isToolUse && message.toolId === part.tool_use_id) {
                  const result = {
                    ...message,
                    toolResult: {
                      content: part.content,
                      isError: part.is_error,
                      timestamp: new Date(),
                    },
                  };
                  // Mark subagent as complete when parent Task receives its result
                  if (message.isSubagentContainer && message.subagentState) {
                    result.subagentState = {
                      ...message.subagentState,
                      isComplete: true,
                    };
                  }
                  return result;
                }
                return message;
              }),
            );
          });
        }
        break;
      }

      case 'claude-output': {
        const cleaned = String(latestMessage.data || '');
        if (cleaned.trim()) {
          const isFirstChunk = !streamBufferRef.current && !streamTimerRef.current;
          streamBufferRef.current += streamBufferRef.current ? `\n${cleaned}` : cleaned;
          if (isFirstChunk) {
            const chunk = streamBufferRef.current;
            streamBufferRef.current = '';
            appendStreamingChunk(setChatMessages, chunk, true);
            setClaudeStatus(null);
          } else if (!streamTimerRef.current) {
            streamTimerRef.current = window.setTimeout(() => {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              streamTimerRef.current = null;
              appendStreamingChunk(setChatMessages, chunk, true);
            }, 100);
          }
        }
        break;
      }

      case 'claude-interactive-prompt':
        // Interactive prompts are parsed/rendered as text in the UI.
        // Normalize to string to keep ChatMessage.content shape consistent.
        {
          const interactiveContent =
            typeof latestMessage.data === 'string'
              ? latestMessage.data
              : JSON.stringify(latestMessage.data ?? '', null, 2);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: interactiveContent,
              timestamp: new Date(),
              isInteractivePrompt: true,
            },
          ]);
        }
        break;

      case 'claude-permission-request':
        if ((provider !== 'claude' && provider !== 'claude-cli') || !latestMessage.requestId) {
          break;
        }
        {
          const requestId = latestMessage.requestId;

          setPendingPermissionRequests((previous) => {
            if (previous.some((request) => request.requestId === requestId)) {
              return previous;
            }
            return [
              ...previous,
              {
                requestId,
                toolName: latestMessage.toolName || 'UnknownTool',
                input: latestMessage.input,
                context: latestMessage.context,
                sessionId: latestMessage.sessionId || null,
                receivedAt: new Date(),
              },
            ];
          });
        }

        setIsLoading(true);
        setCanAbortSession(true);
        setClaudeStatus({
          text: 'Waiting for permission',
          tokens: 0,
          can_interrupt: true,
        });
        break;

      case 'claude-permission-cancelled':
        if (!latestMessage.requestId) {
          break;
        }
        setPendingPermissionRequests((previous) =>
          previous.filter((request) => request.requestId !== latestMessage.requestId),
        );
        break;

      case 'claude-error':
        clearFallbackTimer();
        finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: `Error: ${latestMessage.error}`,
            timestamp: new Date(),
          },
        ]);
        break;

      case 'cursor-system':
        resetFallbackTimer();
        try {
          const cursorData = latestMessage.data;
          if (
            cursorData &&
            cursorData.type === 'system' &&
            cursorData.subtype === 'init' &&
            cursorData.session_id
          ) {
            if (!isSystemInitForView) {
              return;
            }

            if (currentSessionId && cursorData.session_id !== currentSessionId) {
              setIsSystemSessionChange(true);
              onNavigateToSession?.(cursorData.session_id);
              return;
            }

            if (!currentSessionId) {
              setIsSystemSessionChange(true);
              onNavigateToSession?.(cursorData.session_id);
              return;
            }
          }
        } catch (error) {
          console.warn('Error handling cursor-system message:', error);
        }
        break;

      case 'cursor-user':
        break;

      case 'cursor-tool-use':
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: `Using tool: ${latestMessage.tool} ${latestMessage.input ? `with ${latestMessage.input}` : ''
              }`,
            timestamp: new Date(),
            isToolUse: true,
            toolName: latestMessage.tool,
            toolInput: latestMessage.input,
          },
        ]);
        break;

      case 'cursor-error':
        finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: `Cursor error: ${latestMessage.error || 'Unknown error'}`,
            timestamp: new Date(),
          },
        ]);
        break;

      case 'cursor-result': {
        const cursorCompletedSessionId = latestMessage.sessionId || currentSessionId;
        const pendingCursorSessionId = sessionStorage.getItem('pendingSessionId');

        finalizeLifecycleForCurrentView(
          cursorCompletedSessionId,
          currentSessionId,
          selectedSession?.id,
          pendingCursorSessionId,
        );

        try {
          const resultData = latestMessage.data || {};
          const textResult = typeof resultData.result === 'string' ? resultData.result : '';

          if (streamTimerRef.current) {
            clearTimeout(streamTimerRef.current);
            streamTimerRef.current = null;
          }
          const pendingChunk = streamBufferRef.current;
          streamBufferRef.current = '';

          setChatMessages((previous) => {
            const updated = [...previous];
            const lastIndex = updated.length - 1;
            const last = updated[lastIndex];
            if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
              const finalContent =
                textResult && textResult.trim()
                  ? textResult
                  : `${last.content || ''}${pendingChunk || ''}`;
              // Clone the message instead of mutating in place so React can reliably detect state updates.
              updated[lastIndex] = { ...last, content: finalContent, isStreaming: false };
            } else if (textResult && textResult.trim()) {
              updated.push({
                type: resultData.is_error ? 'error' : 'assistant',
                content: textResult,
                timestamp: new Date(),
                isStreaming: false,
              });
            }
            return updated;
          });
        } catch (error) {
          console.warn('Error handling cursor-result message:', error);
        }

        if (cursorCompletedSessionId && !currentSessionId && cursorCompletedSessionId === pendingCursorSessionId) {
          setCurrentSessionId(cursorCompletedSessionId);
          sessionStorage.removeItem('pendingSessionId');
          if (window.refreshProjects) {
            setTimeout(() => window.refreshProjects?.(), 500);
          }
        }
        break;
      }

      case 'cursor-output':
        try {
          const raw = String(latestMessage.data ?? '');
          const cleaned = raw
            .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
            .trim();

          if (cleaned) {
            const isFirstChunk = !streamBufferRef.current && !streamTimerRef.current;
            streamBufferRef.current += streamBufferRef.current ? `\n${cleaned}` : cleaned;
            if (isFirstChunk) {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              appendStreamingChunk(setChatMessages, chunk, true);
              setClaudeStatus(null);
            } else if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, true);
              }, 100);
            }
          }
        } catch (error) {
          console.warn('Error handling cursor-output message:', error);
        }
        break;

      case 'claude-complete': {
        clearFallbackTimer();
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        const completedSessionId =
          latestMessage.sessionId || currentSessionId || pendingSessionId;

        finalizeLifecycleForCurrentView(
          completedSessionId,
          currentSessionId,
          selectedSession?.id,
          pendingSessionId,
        );

        if (latestMessage.exitCode !== 0 && latestMessage.exitCode !== undefined) {
          // Show a fallback error if no prior claude-cli-error was displayed
          setChatMessages((previous) => {
            const hasRecentError = previous.length > 0 && previous[previous.length - 1]?.type === 'error';
            if (hasRecentError) {
              return previous; // stderr error already shown
            }
            return [
              ...previous,
              {
                type: 'error' as const,
                content: `Claude CLI exited with code ${latestMessage.exitCode}`,
                timestamp: new Date(),
              },
            ];
          });
        }

        if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
          setCurrentSessionId(pendingSessionId);
          sessionStorage.removeItem('pendingSessionId');
          console.log('New session complete, ID set to:', pendingSessionId);
        }

        if (selectedProject && latestMessage.exitCode === 0) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        break;
      }

      case 'codex-response': {
        resetFallbackTimer();
        const codexData = latestMessage.data;
        if (!codexData) {
          break;
        }

        if (codexData.type === 'item') {
          switch (codexData.itemType) {
            case 'agent_message':
              if (codexData.message?.content?.trim()) {
                const content = decodeHtmlEntities(codexData.message.content);
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'assistant',
                    content,
                    timestamp: new Date(),
                  },
                ]);
              }
              break;

            case 'reasoning':
              if (codexData.message?.content?.trim()) {
                const content = decodeHtmlEntities(codexData.message.content);
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'assistant',
                    content,
                    timestamp: new Date(),
                    isThinking: true,
                  },
                ]);
              }
              break;

            case 'command_execution':
              if (codexData.command) {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    isToolUse: true,
                    toolName: 'Bash',
                    toolInput: codexData.command,
                    toolResult: codexData.output || null,
                    exitCode: codexData.exitCode,
                  },
                ]);
              }
              break;

            case 'file_change':
              if (codexData.changes?.length > 0) {
                const changesList = codexData.changes
                  .map((change: { kind: string; path: string }) => `${change.kind}: ${change.path}`)
                  .join('\n');
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    isToolUse: true,
                    toolName: 'FileChanges',
                    toolInput: changesList,
                    toolResult: {
                      content: `Status: ${codexData.status}`,
                      isError: false,
                    },
                  },
                ]);
              }
              break;

            case 'mcp_tool_call':
              setChatMessages((previous) => [
                ...previous,
                {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(),
                  isToolUse: true,
                  toolName: `${codexData.server}:${codexData.tool}`,
                  toolInput: JSON.stringify(codexData.arguments, null, 2),
                  toolResult: codexData.result
                    ? JSON.stringify(codexData.result, null, 2)
                    : codexData.error?.message || null,
                },
              ]);
              break;

            case 'error':
              if (codexData.message?.content) {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'error',
                    content: codexData.message.content,
                    timestamp: new Date(),
                  },
                ]);
              }
              break;

            default:
              console.log('[Codex] Unhandled item type:', codexData.itemType, codexData);
          }
        }

        if (codexData.type === 'turn_complete') {
          finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        }

        if (codexData.type === 'turn_failed') {
          finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'error',
              content: codexData.error?.message || 'Turn failed',
              timestamp: new Date(),
            },
          ]);
        }
        break;
      }

      case 'codex-complete': {
        const codexPendingSessionId = sessionStorage.getItem('pendingSessionId');
        const codexActualSessionId = latestMessage.actualSessionId || codexPendingSessionId;
        const codexCompletedSessionId =
          latestMessage.sessionId || currentSessionId || codexPendingSessionId;

        finalizeLifecycleForCurrentView(
          codexCompletedSessionId,
          codexActualSessionId,
          currentSessionId,
          selectedSession?.id,
          codexPendingSessionId,
        );

        if (codexPendingSessionId && !currentSessionId) {
          setCurrentSessionId(codexActualSessionId);
          setIsSystemSessionChange(true);
          if (codexActualSessionId) {
            onNavigateToSession?.(codexActualSessionId);
          }
          sessionStorage.removeItem('pendingSessionId');
        }

        if (selectedProject) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        break;
      }

      case 'codex-error':
        finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: latestMessage.error || 'An error occurred with Codex',
            timestamp: new Date(),
          },
        ]);
        break;

      case 'gemini-response': {
        resetFallbackTimer();
        const geminiData = latestMessage.data;

        if (geminiData && geminiData.type === 'message' && typeof geminiData.content === 'string') {
          const content = decodeHtmlEntities(geminiData.content);

          if (content) {
            streamBufferRef.current += streamBufferRef.current ? `\n${content}` : content;
          }

          if (!geminiData.isPartial) {
            // Immediate flush and finalization for the last chunk
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const chunk = streamBufferRef.current;
            streamBufferRef.current = '';

            if (chunk) {
              appendStreamingChunk(setChatMessages, chunk, true);
            }
            finalizeStreamingMessage(setChatMessages);
          } else if (streamBufferRef.current) {
            const isFirstChunk = !streamTimerRef.current && streamBufferRef.current === content;
            if (isFirstChunk) {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              appendStreamingChunk(setChatMessages, chunk, true);
              setClaudeStatus(null);
            } else if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;

                if (chunk) {
                  appendStreamingChunk(setChatMessages, chunk, true);
                }
              }, 100);
            }
          }
        }
        break;
      }

      case 'gemini-error':
        finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: latestMessage.error || 'An error occurred with Gemini',
            timestamp: new Date(),
          },
        ]);
        break;

      case 'claude-cli-error':
        // Display the error but do NOT finalize lifecycle here.
        // Stderr may arrive before the process closes; the 'claude-complete' event
        // is the authoritative signal that the CLI process has exited.
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: latestMessage.error || 'An error occurred with Claude CLI',
            timestamp: new Date(),
          },
        ]);
        break;

      case 'gemini-tool-use':
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: '',
            timestamp: new Date(),
            isToolUse: true,
            toolName: latestMessage.toolName,
            toolInput: latestMessage.parameters ? JSON.stringify(latestMessage.parameters, null, 2) : '',
            toolId: latestMessage.toolId,
            toolResult: null,
          }
        ]);
        break;

      case 'gemini-tool-result':
        setChatMessages((previous) =>
          previous.map((message) => {
            if (message.isToolUse && message.toolId === latestMessage.toolId) {
              return {
                ...message,
                toolResult: {
                  content: latestMessage.output || `Status: ${latestMessage.status}`,
                  isError: latestMessage.status === 'error',
                  timestamp: new Date(),
                },
              };
            }
            return message;
          }),
        );
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

      case 'session-timeout': {
        clearFallbackTimer();
        // Flush any pending stream content
        if (streamBufferRef.current) {
          const chunk = streamBufferRef.current;
          streamBufferRef.current = '';
          if (streamTimerRef.current) {
            clearTimeout(streamTimerRef.current);
            streamTimerRef.current = null;
          }
          appendStreamingChunk(setChatMessages, chunk, false);
        }

        const timeoutMessages: Record<string, string> = {
          firstResponse: '会话首响应超时（60秒无输出）',
          activity: '会话活动超时（120秒无新输出）',
          toolExecution: '工具执行超时（10分钟）',
          global: '会话全局超时（30分钟）',
        };

        setChatMessages(prev => [...prev, {
          type: 'error',
          content: timeoutMessages[latestMessage.timeoutType as string] || `会话超时 (${latestMessage.timeoutType})`,
          timestamp: new Date(),
          isTimeout: true,
          timeoutType: latestMessage.timeoutType,
        }]);
        setIsLoading(false);
        setCanAbortSession(false);
        break;
      }

      case 'session-error': {
        clearFallbackTimer();
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: latestMessage.error || '会话异常',
          timestamp: new Date(),
        }]);
        setIsLoading(false);
        setCanAbortSession(false);
        break;
      }

      case 'quota-exceeded': {
        clearFallbackTimer();
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: latestMessage.reason || '服务器繁忙，请稍后重试',
          timestamp: new Date(),
        }]);
        setIsLoading(false);
        break;
      }

      case 'session-completed': {
        clearFallbackTimer();
        setIsLoading(false);
        setCanAbortSession(false);
        break;
      }

      case 'resume-response': {
        if (latestMessage.snapshot?.currentContent) {
          // Replace current streaming message with snapshot content
          setChatMessages(prev => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].type === 'assistant' && updated[i].isStreaming) {
                const isStillStreaming = latestMessage.currentState === 'streaming' || latestMessage.currentState === 'tool_executing';
                updated[i] = { ...updated[i], content: latestMessage.snapshot.currentContent, isStreaming: isStillStreaming };
                break;
              }
            }
            return updated;
          });
        }

        if (
          latestMessage.currentState === 'completed' ||
          latestMessage.currentState === 'timeout' ||
          latestMessage.currentState === 'error' ||
          latestMessage.currentState === 'aborted'
        ) {
          clearFallbackTimer();
          setIsLoading(false);
          setCanAbortSession(false);
        }
        break;
      }

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
