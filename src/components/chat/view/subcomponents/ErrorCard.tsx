import React from 'react';

export interface ErrorAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant: 'primary' | 'secondary';
}

interface ErrorCardProps {
  level: 2 | 3;
  title: string;
  description: string;
  actions: ErrorAction[];
  timestamp: Date;
}

const RefreshIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const PlusIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const SettingsIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const PlayIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

export const ACTION_ICONS: Record<string, React.ReactNode> = {
  refresh: <RefreshIcon />,
  plus: <PlusIcon />,
  settings: <SettingsIcon />,
  play: <PlayIcon />,
};

export default function ErrorCard({ level, title, description, actions, timestamp }: ErrorCardProps) {
  const isL3 = level === 3;
  const bgClass = isL3
    ? 'bg-red-100 border-red-300 dark:bg-red-950/30 dark:border-red-800/60'
    : 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800/40';
  const iconBg = isL3 ? 'bg-red-700' : 'bg-red-600';

  const formattedTime = new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className={`rounded-lg border p-4 ${bgClass}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${iconBg} text-sm text-white`}>
          !
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-red-900 dark:text-red-100">{title}</h4>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{description}</p>

          {actions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {actions.map((action, index) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={action.onClick}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    index === 0
                      ? 'border-red-300/70 bg-white/80 text-red-700 hover:bg-red-50 dark:border-red-700/60 dark:bg-gray-900/40 dark:text-red-200 dark:hover:bg-gray-900/70'
                      : 'border-gray-300/70 bg-white/60 text-gray-600 hover:bg-gray-50 dark:border-gray-700/60 dark:bg-gray-900/30 dark:text-gray-300 dark:hover:bg-gray-900/50'
                  }`}
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 text-right text-[11px] text-red-400 dark:text-red-500">{formattedTime}</div>
    </div>
  );
}
