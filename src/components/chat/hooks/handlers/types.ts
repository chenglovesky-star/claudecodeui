import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage, PendingPermissionRequest } from '../../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';

export type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

export type LatestChatMessage = {
  type?: string;
  data?: any;
  sessionId?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  tool?: string;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  [key: string]: any;
};

export interface HandlerContext {
  provider: SessionProvider;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setIsSystemSessionChange: (isSystemSessionChange: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (sessionId: string) => void;
  // Lifecycle helpers passed from the main hook
  finalizeLifecycleForCurrentView: (...sessionIds: Array<string | null | undefined>) => void;
  clearFallbackTimer: () => void;
  startFallbackTimer: () => void;
  resetFallbackTimer: () => void;
  clearLoadingIndicators: () => void;
  isSystemInitForView: boolean | string | null;
}
