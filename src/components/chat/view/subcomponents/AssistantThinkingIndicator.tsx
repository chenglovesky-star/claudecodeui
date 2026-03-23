import { SessionProvider } from '../../../../types/app';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { useWebSocket } from '../../../../contexts/WebSocketContext';

type AssistantThinkingIndicatorProps = {
  selectedProvider: SessionProvider;
}

export default function AssistantThinkingIndicator({ selectedProvider }: AssistantThinkingIndicatorProps) {
  const { queueStatus } = useWebSocket();

  if (queueStatus && queueStatus.status === 'queued') {
    return (
      <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400 text-sm py-2 px-3">
        <span className="animate-pulse">⏳</span>
        <span>当前排队第 {queueStatus.position} 位，预计等待约 {queueStatus.estimatedWaitSec} 秒</span>
      </div>
    );
  }

  if (queueStatus && queueStatus.status === 'timeout') {
    return (
      <div className="text-red-500 text-sm py-2 px-3">
        {queueStatus.message || '排队超时，请稍后重试'}
      </div>
    );
  }

  if (queueStatus && queueStatus.status === 'rejected') {
    return (
      <div className="text-red-500 text-sm py-2 px-3">
        {queueStatus.message || '系统繁忙，请稍后重试'}
      </div>
    );
  }

  const providerName = selectedProvider === 'cursor' ? 'Cursor'
    : selectedProvider === 'codex' ? 'Codex'
    : selectedProvider === 'gemini' ? 'Gemini'
    : selectedProvider === 'claude-cli' ? 'Claude CLI'
    : 'Claude';

  return (
    <div className="chat-message assistant">
      <style>{`
        @keyframes thinking-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes thinking-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .thinking-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          animation: thinking-bounce 1.4s ease-in-out infinite;
        }
        .thinking-text {
          background: linear-gradient(90deg, currentColor 25%, rgba(128,128,128,0.4) 50%, currentColor 75%);
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: thinking-shimmer 2s ease-in-out infinite;
        }
      `}</style>
      <div className="w-full">
        <div className="mb-2 flex items-center space-x-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-transparent p-1 text-sm text-white">
            <SessionProviderLogo provider={selectedProvider} className="h-full w-full" />
          </div>
          <div className="text-sm font-medium text-gray-900 dark:text-white">
            {providerName}
          </div>
        </div>
        <div className="w-full pl-3 text-sm text-gray-500 dark:text-gray-400 sm:pl-0">
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1">
              <span className="thinking-dot" style={{ animationDelay: '0s' }} />
              <span className="thinking-dot" style={{ animationDelay: '0.2s' }} />
              <span className="thinking-dot" style={{ animationDelay: '0.4s' }} />
            </div>
            <span className="thinking-text">正在思考中</span>
          </div>
        </div>
      </div>
    </div>
  );
}
