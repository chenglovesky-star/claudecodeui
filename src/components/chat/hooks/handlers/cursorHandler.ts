import { appendStreamingChunk } from './streamUtils';
import type { HandlerContext, LatestChatMessage } from './types';

export function handleCursorSystem(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.resetFallbackTimer();
  try {
    const cursorData = latestMessage.data;
    if (
      cursorData &&
      cursorData.type === 'system' &&
      cursorData.subtype === 'init' &&
      cursorData.session_id
    ) {
      if (!ctx.isSystemInitForView) {
        return;
      }

      if (ctx.currentSessionId && cursorData.session_id !== ctx.currentSessionId) {
        ctx.setIsSystemSessionChange(true);
        ctx.onNavigateToSession?.(cursorData.session_id);
        return;
      }

      if (!ctx.currentSessionId) {
        ctx.setIsSystemSessionChange(true);
        ctx.onNavigateToSession?.(cursorData.session_id);
        return;
      }
    }
  } catch (error) {
    console.warn('Error handling cursor-system message:', error);
  }
}

// cursor-user: no-op
export function handleCursorUser(_ctx: HandlerContext, _latestMessage: LatestChatMessage) {
  // intentionally empty
}

export function handleCursorToolUse(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.setChatMessages((previous) => [
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
}

export function handleCursorError(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.finalizeLifecycleForCurrentView(latestMessage.sessionId, ctx.currentSessionId, ctx.selectedSession?.id);
  ctx.setChatMessages((previous) => [
    ...previous,
    {
      type: 'error',
      content: `Cursor error: ${latestMessage.error || 'Unknown error'}`,
      timestamp: new Date(),
    },
  ]);
}

export function handleCursorResult(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  const cursorCompletedSessionId = latestMessage.sessionId || ctx.currentSessionId;
  const pendingCursorSessionId = sessionStorage.getItem('pendingSessionId');

  ctx.finalizeLifecycleForCurrentView(
    cursorCompletedSessionId,
    ctx.currentSessionId,
    ctx.selectedSession?.id,
    pendingCursorSessionId,
  );

  try {
    const resultData = latestMessage.data || {};
    const textResult = typeof resultData.result === 'string' ? resultData.result : '';

    if (ctx.streamTimerRef.current) {
      clearTimeout(ctx.streamTimerRef.current);
      ctx.streamTimerRef.current = null;
    }
    const pendingChunk = ctx.streamBufferRef.current;
    ctx.streamBufferRef.current = '';

    ctx.setChatMessages((previous) => {
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

  if (cursorCompletedSessionId && !ctx.currentSessionId && cursorCompletedSessionId === pendingCursorSessionId) {
    ctx.setCurrentSessionId(cursorCompletedSessionId);
    sessionStorage.removeItem('pendingSessionId');
    if (window.refreshProjects) {
      setTimeout(() => window.refreshProjects?.(), 500);
    }
  }
}

export function handleCursorOutput(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  try {
    const raw = String(latestMessage.data ?? '');
    const cleaned = raw
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .trim();

    if (cleaned) {
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
  } catch (error) {
    console.warn('Error handling cursor-output message:', error);
  }
}
