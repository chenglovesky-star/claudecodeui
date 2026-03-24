type ShellConnectionOverlayProps = {
  mode: 'loading' | 'connect' | 'connecting' | 'reconnecting' | 'error';
  description: string;
  loadingLabel: string;
  connectLabel: string;
  connectTitle: string;
  connectingLabel: string;
  onConnect: () => void;
  reconnectAttempt?: number;
  reconnectMaxAttempts?: number;
  reconnectCountdown?: number;
  connectionError?: string | null;
  onCancelReconnect?: () => void;
  onRetry?: () => void;
};

function StepDot({ status }: { status: 'done' | 'active' | 'pending' }) {
  if (status === 'done') return <span className="h-2 w-2 rounded-full bg-green-400" />;
  if (status === 'active') return <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />;
  return <span className="h-2 w-2 rounded-full bg-gray-600" />;
}

export default function ShellConnectionOverlay({
  mode,
  description,
  loadingLabel,
  connectLabel,
  connectTitle,
  connectingLabel,
  onConnect,
  reconnectAttempt = 0,
  reconnectMaxAttempts = 5,
  reconnectCountdown = 0,
  connectionError = null,
  onCancelReconnect,
  onRetry,
}: ShellConnectionOverlayProps) {
  if (mode === 'loading') {
    // 3-step progress: 初始化 → 连接中 → 就绪
    const steps = [
      { label: '初始化', status: 'done' as const },
      { label: '连接中', status: 'active' as const },
      { label: '就绪', status: 'pending' as const },
    ];

    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90">
        <div className="flex flex-col items-center space-y-4">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          <div className="text-sm text-white">{loadingLabel}</div>
          <div className="flex items-center space-x-3">
            {steps.map((step, i) => (
              <div key={step.label} className="flex items-center space-x-1.5">
                <StepDot status={step.status} />
                <span
                  className={`text-xs ${
                    step.status === 'active'
                      ? 'text-indigo-300'
                      : step.status === 'done'
                        ? 'text-green-400'
                        : 'text-gray-500'
                  }`}
                >
                  {step.label}
                </span>
                {i < steps.length - 1 && <span className="mx-1 text-gray-600">→</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'connect') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
        <div className="w-full max-w-sm text-center">
          <button
            onClick={onConnect}
            className="flex w-full items-center justify-center space-x-2 rounded-lg bg-green-600 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-green-700 sm:w-auto"
            title={connectTitle}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>{connectLabel}</span>
          </button>
          <p className="mt-3 px-2 text-sm text-gray-400">{description}</p>
        </div>
      </div>
    );
  }

  if (mode === 'connecting') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
        <div className="w-full max-w-sm text-center">
          <div className="flex items-center justify-center space-x-3 text-yellow-400">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
            <span className="text-base font-medium">{connectingLabel}</span>
          </div>
          <p className="mt-3 px-2 text-sm text-gray-400">{description}</p>
        </div>
      </div>
    );
  }

  if (mode === 'reconnecting') {
    return (
      <div role="status" className="absolute inset-0 z-20 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm">
        <div className="w-full max-w-sm text-center">
          <div className="flex items-center justify-center space-x-3 text-yellow-400">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
            <span className="text-base font-medium">
              正在重连... (第 {reconnectAttempt}/{reconnectMaxAttempts} 次，{reconnectCountdown} 秒后重试)
            </span>
          </div>
          {onCancelReconnect && (
            <button
              onClick={onCancelReconnect}
              className="mt-4 rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600"
            >
              取消重连
            </button>
          )}
        </div>
      </div>
    );
  }

  // mode === 'error'
  return (
    <div role="alert" className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center space-x-2 text-red-400">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-base font-medium">连接失败</span>
        </div>
        {connectionError && <p className="mt-2 px-2 text-sm text-red-300">{connectionError}</p>}
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-4 rounded-lg bg-green-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
          >
            重试
          </button>
        )}
      </div>
    </div>
  );
}
