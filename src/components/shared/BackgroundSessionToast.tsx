import { useEffect, useState } from 'react';

type BackgroundSessionToastProps = {
  count: number;
  visible: boolean;
  onDismiss: () => void;
};

export default function BackgroundSessionToast({ count, visible, onDismiss }: BackgroundSessionToastProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible && count > 0) {
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
        onDismiss();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [visible, count, onDismiss]);

  if (!show) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="flex items-center gap-2 rounded-lg border border-blue-200/60 bg-blue-50/95 px-4 py-3 shadow-lg backdrop-blur-sm dark:border-blue-700/40 dark:bg-blue-900/90">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
        </span>
        <span className="text-sm text-blue-700 dark:text-blue-200">
          {count} 个任务正在后台运行，切回可查看结果
        </span>
      </div>
    </div>
  );
}
