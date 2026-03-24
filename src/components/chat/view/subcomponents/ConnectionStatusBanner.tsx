import { useState, useEffect } from 'react';
import { useWebSocket } from '../../../../contexts/WebSocketContext';
import type { ConnectionState } from '../../../../contexts/WebSocketContext';

export default function ConnectionStatusBanner() {
  const { connectionState, reconnect } = useWebSocket();
  const [showRecovered, setShowRecovered] = useState(false);
  const [prevState, setPrevState] = useState<ConnectionState>(connectionState);

  useEffect(() => {
    if (prevState !== 'connected' && connectionState === 'connected') {
      setShowRecovered(true);
      const timer = setTimeout(() => setShowRecovered(false), 3000);
      setPrevState(connectionState); // Must update prevState here too
      return () => clearTimeout(timer);
    }
    setPrevState(connectionState);
  }, [connectionState, prevState]);

  if (connectionState === 'connected' && !showRecovered) return null;

  if (showRecovered) {
    return (
      <div className="flex items-center justify-center gap-2 bg-green-50 px-4 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300 transition-opacity duration-300">
        <span>&#10003;</span>
        <span>连接已恢复</span>
      </div>
    );
  }

  const isFailed = connectionState === 'failed';

  return (
    <div className={`flex items-center justify-center gap-2 px-4 py-2 text-sm ${
      isFailed
        ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
        : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-300'
    }`}>
      <span className={isFailed ? '' : 'animate-pulse'}>
        {isFailed ? '!' : '...'}
      </span>
      <span>
        {isFailed
          ? '无法连接到服务器，请检查网络'
          : '连接已断开，正在重新连接...'}
      </span>
      <button
        type="button"
        onClick={() => reconnect?.()}
        className="ml-2 rounded border border-current px-2 py-0.5 text-xs hover:bg-white/50 dark:hover:bg-black/20"
      >
        手动重连
      </button>
      {isFailed && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded border border-current px-2 py-0.5 text-xs hover:bg-white/50 dark:hover:bg-black/20"
        >
          刷新页面
        </button>
      )}
    </div>
  );
}
