import type { ReactNode } from 'react';

export type AuthUser = {
  id?: number | string;
  username: string;
  email?: string;
  nickname?: string;
  avatar_url?: string;
  roles?: string[];
  active_role?: string;
  [key: string]: unknown;
};

export type AuthActionResult = { success: true } | { success: false; error: string };

export type AuthSessionPayload = {
  token?: string;
  user?: AuthUser;
  data?: {
    token?: string;
    user?: AuthUser;
  };
  error?: string | { code?: string; message?: string };
  message?: string;
};

export type AuthStatusPayload = {
  needsSetup?: boolean;
  allowRegistration?: boolean;
};

export type AuthUserPayload = {
  user?: AuthUser;
};

export type OnboardingStatusPayload = {
  hasCompletedOnboarding?: boolean;
};

export type ApiErrorPayload = {
  error?: string;
  message?: string;
};

export type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  needsSetup: boolean;
  allowRegistration: boolean;
  hasCompletedOnboarding: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<AuthActionResult>;
  register: (email: string, password: string, username?: string) => Promise<AuthActionResult>;
  logout: () => void;
  refreshOnboardingStatus: () => Promise<void>;
  updateProfile: (nickname: string) => Promise<AuthActionResult>;
  uploadAvatar: (formData: FormData) => Promise<AuthActionResult & { avatar_url?: string }>;
  updateRoles: (roles: string[]) => Promise<AuthActionResult>;
  setActiveRole: (role: string) => Promise<AuthActionResult>;
};

export type AuthProviderProps = {
  children: ReactNode;
};
