import { appendStreamingChunk } from './streamUtils';
import { getErrorMapping, getErrorDescription } from '../../utils/errorMessages';
import type { HandlerContext, LatestChatMessage } from './types';

export function handleSessionTimeout(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.clearFallbackTimer();
  // Flush any pending stream content
  if (ctx.streamBufferRef.current) {
    const chunk = ctx.streamBufferRef.current;
    ctx.streamBufferRef.current = '';
    if (ctx.streamTimerRef.current) {
      clearTimeout(ctx.streamTimerRef.current);
      ctx.streamTimerRef.current = null;
    }
    appendStreamingChunk(ctx.setChatMessages, chunk, false);
  }

  const errorCode = (latestMessage as any).errorCode || latestMessage.timeoutType as string || 'unknown';
  const meta = (latestMessage as any).meta || {};
  const mapping = getErrorMapping(errorCode);

  ctx.setChatMessages(prev => [...prev, {
    type: 'error',
    content: getErrorDescription(mapping, meta),
    errorLevel: mapping.level as 2 | 3,
    errorCode,
    errorActions: mapping.actions,
    timestamp: new Date(),
    isTimeout: true,
    timeoutType: latestMessage.timeoutType,
  }]);
  ctx.setIsLoading(false);
  ctx.setCanAbortSession(false);
  if (ctx.setCurrentPhase) ctx.setCurrentPhase(undefined);
  if (ctx.setRecoveryStatus) ctx.setRecoveryStatus(null);
}

export function handleSessionError(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.clearFallbackTimer();
  ctx.setChatMessages(prev => [...prev, {
    type: 'error',
    content: latestMessage.error || '会话异常',
    timestamp: new Date(),
  }]);
  ctx.setIsLoading(false);
  ctx.setCanAbortSession(false);
}

export function handleQuotaExceeded(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.clearFallbackTimer();
  ctx.setChatMessages(prev => [...prev, {
    type: 'error',
    content: latestMessage.reason || '服务器繁忙，请稍后重试',
    timestamp: new Date(),
  }]);
  ctx.setIsLoading(false);
}

export function handleSessionCompleted(ctx: HandlerContext, _latestMessage: LatestChatMessage) {
  ctx.clearFallbackTimer();
  ctx.setIsLoading(false);
  ctx.setCanAbortSession(false);
}

export function handleResumeResponse(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  if (latestMessage.snapshot?.currentContent) {
    // Replace current streaming message with snapshot content
    ctx.setChatMessages(prev => {
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
    ctx.clearFallbackTimer();
    ctx.setIsLoading(false);
    ctx.setCanAbortSession(false);
  }
}
