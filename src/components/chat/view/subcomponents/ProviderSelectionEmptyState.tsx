import React, { useState } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { CLAUDE_MODELS, CURSOR_MODELS, CODEX_MODELS, GEMINI_MODELS, CLAUDE_CLI_MODELS } from '../../../../../shared/modelConstants';
import type { ProjectSession, SessionProvider } from '../../../../types/app';
import { NextTaskBanner } from '../../../task-master';
import { authenticatedFetch } from '../../../../utils/api';

interface ProviderSelectionEmptyStateProps {
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  setProvider: (next: SessionProvider) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  cursorModel: string;
  setCursorModel: (model: string) => void;
  codexModel: string;
  setCodexModel: (model: string) => void;
  geminiModel: string;
  setGeminiModel: (model: string) => void;
  claudeCliModel: string;
  setClaudeCliModel: (model: string) => void;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  selectedProjectPath?: string;
}

type ProviderDef = {
  id: SessionProvider;
  name: string;
  infoKey: string;
  accent: string;
  ring: string;
  check: string;
};

const PROVIDERS: ProviderDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    infoKey: 'providerSelection.providerInfo.anthropic',
    accent: 'border-primary',
    ring: 'ring-primary/15',
    check: 'bg-primary text-primary-foreground',
  },
  {
    id: 'claude-cli',
    name: 'Claude CLI',
    infoKey: 'providerSelection.providerInfo.claudeCli',
    accent: 'border-amber-500 dark:border-amber-400',
    ring: 'ring-amber-500/15',
    check: 'bg-amber-500 text-white',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    infoKey: 'providerSelection.providerInfo.cursorEditor',
    accent: 'border-violet-500 dark:border-violet-400',
    ring: 'ring-violet-500/15',
    check: 'bg-violet-500 text-white',
  },
  {
    id: 'codex',
    name: 'Codex',
    infoKey: 'providerSelection.providerInfo.openai',
    accent: 'border-emerald-600 dark:border-emerald-400',
    ring: 'ring-emerald-600/15',
    check: 'bg-emerald-600 dark:bg-emerald-500 text-white',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    infoKey: 'providerSelection.providerInfo.google',
    accent: 'border-blue-500 dark:border-blue-400',
    ring: 'ring-blue-500/15',
    check: 'bg-blue-500 text-white',
  },
];

function getModelConfig(p: SessionProvider) {
  if (p === 'claude') return CLAUDE_MODELS;
  if (p === 'claude-cli') return CLAUDE_CLI_MODELS;
  if (p === 'codex') return CODEX_MODELS;
  if (p === 'gemini') return GEMINI_MODELS;
  return CURSOR_MODELS;
}

function getModelValue(p: SessionProvider, c: string, cu: string, co: string, g: string, cc: string) {
  if (p === 'claude') return c;
  if (p === 'claude-cli') return cc;
  if (p === 'codex') return co;
  if (p === 'gemini') return g;
  return cu;
}

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  claudeModel,
  setClaudeModel,
  cursorModel,
  setCursorModel,
  codexModel,
  setCodexModel,
  geminiModel,
  setGeminiModel,
  claudeCliModel,
  setClaudeCliModel,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
  selectedProjectPath,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation('chat');
  const nextTaskPrompt = t('tasks.nextTaskPrompt', { defaultValue: 'Start the next task' });

  const [contextTestState, setContextTestState] = useState<'idle' | 'loading' | 'success' | 'failure'>('idle');
  const [contextTestResult, setContextTestResult] = useState<any>(null);

  const selectProvider = (next: SessionProvider) => {
    setProvider(next);
    localStorage.setItem('selected-provider', next);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleModelChange = (value: string) => {
    if (provider === 'claude') { setClaudeModel(value); localStorage.setItem('claude-model', value); }
    else if (provider === 'claude-cli') { setClaudeCliModel(value); localStorage.setItem('claude-cli-model', value); }
    else if (provider === 'codex') { setCodexModel(value); localStorage.setItem('codex-model', value); }
    else if (provider === 'gemini') { setGeminiModel(value); localStorage.setItem('gemini-model', value); }
    else { setCursorModel(value); localStorage.setItem('cursor-model', value); }
  };

  const handleTestContext = async () => {
    setContextTestState('loading');
    setContextTestResult(null);
    try {
      const response = await authenticatedFetch('/api/claude-cli/test-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: selectedProjectPath || '',
          model: claudeCliModel,
        }),
      });
      const result = await response.json();
      setContextTestResult(result);
      setContextTestState(result.success && result.contextMaintained ? 'success' : 'failure');
    } catch (error) {
      setContextTestResult({ error: (error as Error).message });
      setContextTestState('failure');
    }
  };

  const modelConfig = getModelConfig(provider);
  const currentModel = getModelValue(provider, claudeModel, cursorModel, codexModel, geminiModel, claudeCliModel);

  /* ── New session — provider picker ── */
  if (!selectedSession && !currentSessionId) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-lg">
          {/* Heading */}
          <div className="mb-8 text-center">
            <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {t('providerSelection.title')}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t('providerSelection.description')}
            </p>
          </div>

          {/* Provider cards */}
          <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-2.5">
            {PROVIDERS.map((p) => {
              const active = provider === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => selectProvider(p.id)}
                  className={`
                    relative flex flex-col items-center gap-2.5 rounded-xl border-[1.5px] px-2
                    pb-4 pt-5 transition-all duration-150
                    active:scale-[0.97]
                    ${active
                      ? `${p.accent} ${p.ring} bg-card shadow-sm ring-2`
                      : 'border-border bg-card/60 hover:border-border/80 hover:bg-card'
                    }
                  `}
                >
                  <SessionProviderLogo
                    provider={p.id}
                    className={`h-9 w-9 transition-transform duration-150 ${active ? 'scale-110' : ''}`}
                  />
                  <div className="text-center">
                    <p className="text-[13px] font-semibold leading-none text-foreground">{p.name}</p>
                    <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{t(p.infoKey)}</p>
                  </div>
                  {/* Check badge */}
                  {active && (
                    <div className={`absolute -right-1 -top-1 h-[18px] w-[18px] rounded-full ${p.check} flex items-center justify-center shadow-sm`}>
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Model picker — appears after provider is chosen */}
          <div className={`transition-all duration-200 ${provider ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'}`}>
            <div className="mb-5 flex items-center justify-center gap-2">
              <span className="text-sm text-muted-foreground">{t('providerSelection.selectModel')}</span>
              <div className="relative">
                <select
                  value={currentModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  tabIndex={-1}
                  className="cursor-pointer appearance-none rounded-lg border border-border/60 bg-muted/50 py-1.5 pl-3 pr-7 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {modelConfig.OPTIONS.map(({ value, label }: { value: string; label: string }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              </div>

              {/* Context test button for Claude CLI */}
              {provider === 'claude-cli' && (
                <button
                  onClick={handleTestContext}
                  disabled={contextTestState === 'loading'}
                  className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {contextTestState === 'loading' ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    'Test Context'
                  )}
                </button>
              )}
            </div>

            {/* Context test result */}
            {provider === 'claude-cli' && contextTestState !== 'idle' && contextTestState !== 'loading' && (
              <div className={`mb-3 rounded-lg px-3 py-2 text-center text-xs ${
                contextTestState === 'success'
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400'
              }`}>
                {contextTestState === 'success' ? (
                  <span>Context maintained successfully</span>
                ) : (
                  <span>Context lost{contextTestResult?.error ? `: ${contextTestResult.error}` : ''}</span>
                )}
              </div>
            )}

            <p className="text-center text-sm text-muted-foreground/70">
              {
                {
                  claude: t('providerSelection.readyPrompt.claude', { model: claudeModel }),
                  'claude-cli': t('providerSelection.readyPrompt.claudeCli', { defaultValue: `Claude CLI ready with ${claudeCliModel}`, model: claudeCliModel }),
                  cursor: t('providerSelection.readyPrompt.cursor', { model: cursorModel }),
                  codex: t('providerSelection.readyPrompt.codex', { model: codexModel }),
                  gemini: t('providerSelection.readyPrompt.gemini', { model: geminiModel }),
                }[provider]
              }
            </p>
          </div>

          {/* Task banner */}
          {provider && tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner onStartTask={() => setInput(nextTaskPrompt)} onShowAllTasks={onShowAllTasks} />
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Existing session — continue prompt ── */
  if (selectedSession) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md px-6 text-center">
          <p className="mb-1.5 text-lg font-semibold text-foreground">{t('session.continue.title')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('session.continue.description')}</p>

          {tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner onStartTask={() => setInput(nextTaskPrompt)} onShowAllTasks={onShowAllTasks} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
