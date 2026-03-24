import { useCallback, useEffect, useRef } from 'react';

type PasteConfirmDialogProps = {
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function PasteConfirmDialog({ text, onConfirm, onCancel }: PasteConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const lineCount = text.split('\n').length;
  const sizeKB = (new TextEncoder().encode(text).length / 1024).toFixed(1);
  const preview = text.length > 200 ? text.slice(0, 200) + '...' : text;
  const isLarge = new TextEncoder().encode(text).length > 8 * 1024;

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [onConfirm, onCancel],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-gray-600 bg-gray-800 p-4 shadow-xl">
        <h3 className="mb-2 text-sm font-semibold text-gray-200">
          即将粘贴 {lineCount} 行内容
        </h3>
        {isLarge && (
          <p className="mb-2 text-xs text-yellow-400">
            ⚠ 内容较大 ({sizeKB} KB)，可能影响终端性能
          </p>
        )}
        <pre className="mb-3 max-h-32 overflow-auto rounded bg-gray-900 p-2 text-xs text-gray-400">
          {preview}
        </pre>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded bg-gray-700 px-4 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-600"
          >
            取消 (Esc)
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            确认粘贴 (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}
