import { decodeHtmlEntities } from '../../utils/chatFormatting';
import { appendStreamingChunk, finalizeStreamingMessage } from './streamUtils';
import type { HandlerContext, LatestChatMessage } from './types';

export function handleGeminiResponse(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.resetFallbackTimer();
  const geminiData = latestMessage.data;

  if (geminiData && geminiData.type === 'message' && typeof geminiData.content === 'string') {
    const content = decodeHtmlEntities(geminiData.content);

    if (content) {
      ctx.streamBufferRef.current += ctx.streamBufferRef.current ? `\n${content}` : content;
    }

    if (!geminiData.isPartial) {
      // Immediate flush and finalization for the last chunk
      if (ctx.streamTimerRef.current) {
        clearTimeout(ctx.streamTimerRef.current);
        ctx.streamTimerRef.current = null;
      }
      const chunk = ctx.streamBufferRef.current;
      ctx.streamBufferRef.current = '';

      if (chunk) {
        appendStreamingChunk(ctx.setChatMessages, chunk, true);
      }
      finalizeStreamingMessage(ctx.setChatMessages);
    } else if (ctx.streamBufferRef.current) {
      const isFirstChunk = !ctx.streamTimerRef.current && ctx.streamBufferRef.current === content;
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

          if (chunk) {
            appendStreamingChunk(ctx.setChatMessages, chunk, true);
          }
        }, 100);
      }
    }
  }
}

export function handleGeminiError(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.finalizeLifecycleForCurrentView(latestMessage.sessionId, ctx.currentSessionId, ctx.selectedSession?.id);
  ctx.setChatMessages((previous) => [
    ...previous,
    {
      type: 'error',
      content: latestMessage.error || 'An error occurred with Gemini',
      timestamp: new Date(),
    },
  ]);
}

export function handleGeminiToolUse(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.setChatMessages((previous) => [
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
}

export function handleGeminiToolResult(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.setChatMessages((previous) =>
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
}
