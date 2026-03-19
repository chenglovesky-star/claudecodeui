import { decodeHtmlEntities } from '../../utils/chatFormatting';
import { safeLocalStorage } from '../../utils/chatStorage';
import type { HandlerContext, LatestChatMessage } from './types';

export function handleCodexResponse(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.resetFallbackTimer();
  const codexData = latestMessage.data;
  if (!codexData) {
    return;
  }

  if (codexData.type === 'item') {
    switch (codexData.itemType) {
      case 'agent_message':
        if (codexData.message?.content?.trim()) {
          const content = decodeHtmlEntities(codexData.message.content);
          ctx.setChatMessages((previous) => [
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
          ctx.setChatMessages((previous) => [
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
          ctx.setChatMessages((previous) => [
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
          ctx.setChatMessages((previous) => [
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
        ctx.setChatMessages((previous) => [
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
          ctx.setChatMessages((previous) => [
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
    ctx.finalizeLifecycleForCurrentView(latestMessage.sessionId, ctx.currentSessionId, ctx.selectedSession?.id);
  }

  if (codexData.type === 'turn_failed') {
    ctx.finalizeLifecycleForCurrentView(latestMessage.sessionId, ctx.currentSessionId, ctx.selectedSession?.id);
    ctx.setChatMessages((previous) => [
      ...previous,
      {
        type: 'error',
        content: codexData.error?.message || 'Turn failed',
        timestamp: new Date(),
      },
    ]);
  }
}

export function handleCodexComplete(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  const codexPendingSessionId = sessionStorage.getItem('pendingSessionId');
  const codexActualSessionId = latestMessage.actualSessionId || codexPendingSessionId;
  const codexCompletedSessionId =
    latestMessage.sessionId || ctx.currentSessionId || codexPendingSessionId;

  ctx.finalizeLifecycleForCurrentView(
    codexCompletedSessionId,
    codexActualSessionId,
    ctx.currentSessionId,
    ctx.selectedSession?.id,
    codexPendingSessionId,
  );

  if (codexPendingSessionId && !ctx.currentSessionId) {
    ctx.setCurrentSessionId(codexActualSessionId);
    ctx.setIsSystemSessionChange(true);
    if (codexActualSessionId) {
      ctx.onNavigateToSession?.(codexActualSessionId);
    }
    sessionStorage.removeItem('pendingSessionId');
  }

  if (ctx.selectedProject) {
    safeLocalStorage.removeItem(`chat_messages_${ctx.selectedProject.name}`);
  }
}

export function handleCodexError(ctx: HandlerContext, latestMessage: LatestChatMessage) {
  ctx.finalizeLifecycleForCurrentView(latestMessage.sessionId, ctx.currentSessionId, ctx.selectedSession?.id);
  ctx.setChatMessages((previous) => [
    ...previous,
    {
      type: 'error',
      content: latestMessage.error || 'An error occurred with Codex',
      timestamp: new Date(),
    },
  ]);
}
