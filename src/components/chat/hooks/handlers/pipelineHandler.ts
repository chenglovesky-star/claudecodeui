import { appendStreamingChunk } from './streamUtils';
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

  const timeoutMessages: Record<string, string> = {
    firstResponse: '会话首响应超时（60秒无输出）',
    activity: '会话活动超时（120秒无新输出）',
    toolExecution: '工具执行超时（10分钟）',
    global: '会话全局超时（30分钟）',
  };

  ctx.setChatMessages(prev => [...prev, {
    type: 'error',
    content: timeoutMessages[latestMessage.timeoutType as string] || `会话超时 (${latestMessage.timeoutType})`,
    timestamp: new Date(),
    isTimeout: true,
    timeoutType: latestMessage.timeoutType,
  }]);
  ctx.setIsLoading(false);
  ctx.setCanAbortSession(false);
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
