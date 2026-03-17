import { SessionProvider } from '../../../../types/app';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

type AssistantThinkingIndicatorProps = {
  selectedProvider: SessionProvider;
}

export default function AssistantThinkingIndicator({ selectedProvider }: AssistantThinkingIndicatorProps) {
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
