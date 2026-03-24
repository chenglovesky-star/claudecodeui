import { decodeHtmlEntities, formatUsageLimitText } from '../../utils/chatFormatting';
import { safeLocalStorage } from '../../utils/chatStorage';
import { getErrorMapping, getErrorDescription } from '../../utils/errorMessages';
import { appendStreamingChunk, finalizeStreamingMessage, resetInternalSuppression, activateInternalSuppression, shouldSuppressTextBlock, setCurrentBlockSuppressed } from './streamUtils';
import type { HandlerContext, LatestChatMessage } from './types';

export function handleClaudePhase(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  const phaseTexts: Record<string, string> = {
    acknowledged: '正在准备',
    configuring: '正在加载配置',
    querying: '正在思考中',
  };
  const phaseText = phaseTexts[latestMessage.phase as string] || '处理中';
  ctx.setClaudeStatus({ text: phaseText, tokens: 0, can_interrupt: true });
  ctx.setIsLoading(true);
  ctx.setCanAbortSession(true);
  if (ctx.setCurrentPhase) {
    ctx.setCurrentPhase(latestMessage.phase as string);
  }
  if (ctx.setPhaseMeta) {
    const { phase, type, ...meta } = latestMessage as any;
    ctx.setPhaseMeta(Object.keys(meta).length > 0 ? meta : undefined);
  }
  // Clear recovery status when transitioning away from L1 recovery phases
  const l1Phases = new Set(['auth-fallback', 'rate-limit-retry']);
  if (ctx.setRecoveryStatus && !l1Phases.has(latestMessage.phase as string)) {
    ctx.setRecoveryStatus(null);
  }
  if (latestMessage.phase === 'acknowledged') {
    resetInternalSuppression(); // New turn: reset suppression from previous skill calls
    ctx.startFallbackTimer();
  }
}

export function handleClaudeResponse(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  const messageData = latestMessage.data?.message || latestMessage.data;
  const structuredMessageData =
    messageData && typeof messageData === 'object' ? (messageData as Record<string, any>) : null;
  const rawStructuredData =
    latestMessage.data && typeof latestMessage.data === 'object'
      ? (latestMessage.data as Record<string, any>)
      : null;

  // Reset fallback timer on ANY claude-response, not just text delta
  // This prevents false timeouts during tool_use, subagent execution, etc.
  ctx.resetFallbackTimer();

  if (messageData && typeof messageData === 'object' && messageData.type) {
    // Handle thinking delta (streaming thinking content)
    if (messageData.type === 'content_block_delta' && messageData.delta?.type === 'thinking_delta') {
      const thinkingText = messageData.delta.thinking || '';
      if (thinkingText) {
        ctx.setChatMessages((previous) => {
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

    // Handle content_block_start for text blocks: check if this block should be suppressed
    if (messageData.type === 'content_block_start' && messageData.content_block?.type === 'text') {
      const suppress = shouldSuppressTextBlock();
      setCurrentBlockSuppressed(suppress);
      return;
    }

    // Handle content_block_start for thinking blocks
    if (messageData.type === 'content_block_start' && messageData.content_block?.type === 'thinking') {
      ctx.setChatMessages((previous) => [
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
      const isFirstChunk = !ctx.streamBufferRef.current && !ctx.streamTimerRef.current;
      ctx.streamBufferRef.current += decodedText;
      ctx.resetFallbackTimer();
      if (isFirstChunk) {
        const chunk = ctx.streamBufferRef.current;
        ctx.streamBufferRef.current = '';
        appendStreamingChunk(ctx.setChatMessages, chunk, false);
        ctx.setClaudeStatus(null);
      } else if (!ctx.streamTimerRef.current) {
        ctx.streamTimerRef.current = window.setTimeout(() => {
          const chunk = ctx.streamBufferRef.current;
          ctx.streamBufferRef.current = '';
          ctx.streamTimerRef.current = null;
          appendStreamingChunk(ctx.setChatMessages, chunk, false);
        }, 100);
      }
      return;
    }

    if (messageData.type === 'content_block_stop') {
      // Clear block-level suppression (the next block decides independently)
      setCurrentBlockSuppressed(false);
      // Finalize streaming thinking message if active
      ctx.setChatMessages((previous) => {
        const updated = [...previous];
        const lastIndex = updated.length - 1;
        const last = updated[lastIndex];
        if (last && last.type === 'assistant' && last.isThinking && last.isStreaming) {
          updated[lastIndex] = { ...last, isStreaming: false };
        }
        return updated;
      });

      if (ctx.streamTimerRef.current) {
        clearTimeout(ctx.streamTimerRef.current);
        ctx.streamTimerRef.current = null;
      }
      const chunk = ctx.streamBufferRef.current;
      ctx.streamBufferRef.current = '';
      appendStreamingChunk(ctx.setChatMessages, chunk, false);
      finalizeStreamingMessage(ctx.setChatMessages);
      return;
    }

    // Handle SDK result message — extract response text from result field
    if (messageData.type === 'result' && messageData.result) {
      const resultText = typeof messageData.result === 'string' ? messageData.result.trim() : '';
      if (resultText) {
        ctx.setClaudeStatus(null);
        // Use setChatMessages atomically to avoid duplicates
        ctx.setChatMessages((previous) => {
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
    ctx.currentSessionId &&
    structuredMessageData.session_id !== ctx.currentSessionId &&
    ctx.isSystemInitForView
  ) {
    ctx.setIsSystemSessionChange(true);
    ctx.onNavigateToSession?.(structuredMessageData.session_id);
    return;
  }

  if (
    structuredMessageData?.type === 'system' &&
    structuredMessageData.subtype === 'init' &&
    structuredMessageData.session_id &&
    !ctx.currentSessionId &&
    ctx.isSystemInitForView
  ) {
    ctx.setIsSystemSessionChange(true);
    ctx.onNavigateToSession?.(structuredMessageData.session_id);
    return;
  }

  if (
    structuredMessageData?.type === 'system' &&
    structuredMessageData.subtype === 'init' &&
    structuredMessageData.session_id &&
    ctx.currentSessionId &&
    structuredMessageData.session_id === ctx.currentSessionId &&
    ctx.isSystemInitForView
  ) {
    return;
  }

  if (structuredMessageData && Array.isArray(structuredMessageData.content)) {
    const parentToolUseId = rawStructuredData?.parentToolUseId;

    structuredMessageData.content.forEach((part: any) => {
      if (part.type === 'tool_use') {
        // Activate suppression: text following ANY tool_use is internal content
        activateInternalSuppression();
        const toolInput = part.input ? JSON.stringify(part.input, null, 2) : '';

        // Check if this is a child tool from a subagent
        if (parentToolUseId) {
          ctx.setChatMessages((previous) =>
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

        ctx.setChatMessages((previous) => [
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
        ctx.setChatMessages((previous) => [
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
        ctx.setClaudeStatus(null);
        ctx.setChatMessages((previous) => [
          ...previous,
          { type: 'assistant', content, timestamp: new Date() },
        ]);
      }
    });
  } else if (structuredMessageData && typeof structuredMessageData.content === 'string' && structuredMessageData.content.trim()) {
    let content = decodeHtmlEntities(structuredMessageData.content);
    content = formatUsageLimitText(content);
    ctx.setClaudeStatus(null);
    ctx.setChatMessages((previous) => [
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

      ctx.setChatMessages((previous) =>
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
}

export function handleClaudeOutput(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  const cleaned = String(latestMessage.data || '');
  if (cleaned.trim()) {
    const isFirstChunk = !ctx.streamBufferRef.current && !ctx.streamTimerRef.current;
    ctx.streamBufferRef.current += ctx.streamBufferRef.current ? `\n${cleaned}` : cleaned;
    if (isFirstChunk) {
      const chunk = ctx.streamBufferRef.current;
      ctx.streamBufferRef.current = '';
      appendStreamingChunk(ctx.setChatMessages, chunk, true);
      ctx.setClaudeStatus(null);
    } else if (!ctx.streamTimerRef.current) {
      ctx.streamTimerRef.current = window.setTimeout(() => {
        const chunk = ctx.streamBufferRef.current;
        ctx.streamBufferRef.current = '';
        ctx.streamTimerRef.current = null;
        appendStreamingChunk(ctx.setChatMessages, chunk, true);
      }, 100);
    }
  }
}

export function handleClaudeInteractivePrompt(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  const interactiveContent =
    typeof latestMessage.data === 'string'
      ? latestMessage.data
      : JSON.stringify(latestMessage.data ?? '', null, 2);
  ctx.setChatMessages((previous) => [
    ...previous,
    {
      type: 'assistant',
      content: interactiveContent,
      timestamp: new Date(),
      isInteractivePrompt: true,
    },
  ]);
}

export function handleClaudePermissionRequest(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  if ((ctx.provider !== 'claude' && ctx.provider !== 'claude-cli') || !latestMessage.requestId) {
    return;
  }

  const requestId = latestMessage.requestId;

  ctx.setPendingPermissionRequests((previous) => {
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

  ctx.setIsLoading(true);
  ctx.setCanAbortSession(true);
  ctx.setClaudeStatus({
    text: 'Waiting for permission',
    tokens: 0,
    can_interrupt: true,
  });
}

export function handleClaudePermissionCancelled(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  if (!latestMessage.requestId) {
    return;
  }
  ctx.setPendingPermissionRequests((previous) =>
    previous.filter((request) => request.requestId !== latestMessage.requestId),
  );
}

export function handleClaudeError(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  const errorCode: string = (latestMessage as any).errorCode || 'unknown';
  const meta: Record<string, unknown> = (latestMessage as any).meta || {};
  const mapping = getErrorMapping(errorCode);

  // Level 1: auto-recovery event — update recovery status, don't show error, don't stop loading
  if (mapping.level === 1) {
    if (ctx.setRecoveryStatus) {
      ctx.setRecoveryStatus({ code: errorCode, meta });
    }
    if (ctx.setCurrentPhase) {
      ctx.setCurrentPhase(errorCode);
    }
    return;
  }

  // Level 2 or 3: terminal error
  ctx.clearFallbackTimer();
  ctx.finalizeLifecycleForCurrentView(latestMessage.sessionId, ctx.currentSessionId, ctx.selectedSession?.id);

  // Clean up streaming state to prevent stale "thinking" indicators
  if (ctx.streamTimerRef.current) {
    clearTimeout(ctx.streamTimerRef.current);
    ctx.streamTimerRef.current = null;
  }
  ctx.streamBufferRef.current = '';

  // Finalize any in-progress streaming message and add error
  ctx.setChatMessages((previous) => {
    const updated = [...previous];
    for (let i = updated.length - 1; i >= 0; i--) {
      if (updated[i].isStreaming) {
        updated[i] = { ...updated[i], isStreaming: false };
      }
    }

    return [
      ...updated,
      {
        type: 'error' as const,
        content: getErrorDescription(mapping, meta),
        errorLevel: mapping.level as 2 | 3,
        errorCode,
        errorActions: mapping.actions,
        timestamp: new Date(),
      },
    ];
  });

  ctx.setIsLoading(false);
  ctx.setCanAbortSession(false);
  ctx.setClaudeStatus(null);
  if (ctx.setCurrentPhase) {
    ctx.setCurrentPhase(undefined);
  }
  if (ctx.setRecoveryStatus) {
    ctx.setRecoveryStatus(null);
  }
}

export function handleClaudeComplete(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.clearFallbackTimer();
  resetInternalSuppression(); // Reset skill content suppression for next turn
  if (ctx.setCurrentPhase) {
    ctx.setCurrentPhase(undefined);
  }
  if (ctx.setRecoveryStatus) {
    ctx.setRecoveryStatus(null);
  }
  const pendingSessionId = sessionStorage.getItem('pendingSessionId');
  const completedSessionId =
    latestMessage.sessionId || ctx.currentSessionId || pendingSessionId;

  ctx.finalizeLifecycleForCurrentView(
    completedSessionId,
    ctx.currentSessionId,
    ctx.selectedSession?.id,
    pendingSessionId,
  );

  if (latestMessage.exitCode !== 0 && latestMessage.exitCode !== undefined) {
    // Show a fallback error if no prior claude-cli-error was displayed
    ctx.setChatMessages((previous) => {
      const hasRecentError = previous.length > 0 && previous[previous.length - 1]?.type === 'error';
      if (hasRecentError) {
        return previous; // stderr error already shown
      }

      // Map exit codes to user-friendly messages
      const errorMessages: Record<number, string> = {
        1: '处理过程中出错，请重试',
        2: '命令参数错误',
        124: '请求超时，请尝试发送更简短的请求',
        137: '进程被终止（内存不足）',
        143: '会话被中断',
      };
      const friendlyMessage = errorMessages[latestMessage.exitCode!] || `处理出错 (${latestMessage.exitCode})`;

      return [
        ...previous,
        {
          type: 'error' as const,
          content: friendlyMessage,
          timestamp: new Date(),
        },
      ];
    });
  }

  if (pendingSessionId && !ctx.currentSessionId && latestMessage.exitCode === 0) {
    ctx.setCurrentSessionId(pendingSessionId);
    sessionStorage.removeItem('pendingSessionId');
    console.log('New session complete, ID set to:', pendingSessionId);
  }

  if (ctx.selectedProject && latestMessage.exitCode === 0) {
    safeLocalStorage.removeItem(`chat_messages_${ctx.selectedProject.name}`);
  }
}

export function handleClaudeCliError(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  // Display the error but do NOT finalize lifecycle here.
  // Stderr may arrive before the process closes; the 'claude-complete' event
  // is the authoritative signal that the CLI process has exited.
  ctx.setChatMessages((previous) => [
    ...previous,
    {
      type: 'error',
      content: latestMessage.error || 'An error occurred with Claude CLI',
      timestamp: new Date(),
    },
  ]);
}
