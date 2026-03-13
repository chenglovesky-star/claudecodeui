import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { IS_PLATFORM } from '../../../constants/config';
import { api } from '../../../utils/api';
import { AUTH_ERROR_MESSAGES, AUTH_TOKEN_STORAGE_KEY } from '../constants';
import type {
  AuthContextValue,
  AuthProviderProps,
  AuthSessionPayload,
  AuthStatusPayload,
  AuthUser,
  AuthUserPayload,
  OnboardingStatusPayload,
} from '../types';
import { parseJsonSafely } from '../utils';

const AuthContext = createContext<AuthContextValue | null>(null);

const readStoredToken = (): string | null => localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

const persistToken = (token: string) => {
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
};

const clearStoredToken = () => {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setSession = useCallback((nextUser: AuthUser, nextToken: string) => {
    setUser(nextUser);
    setToken(nextToken);
    persistToken(nextToken);
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setToken(null);
    clearStoredToken();
  }, []);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const response = await api.user.onboardingStatus();
      if (!response.ok) {
        return;
      }

      const payload = await parseJsonSafely<OnboardingStatusPayload>(response);
      setHasCompletedOnboarding(Boolean(payload?.hasCompletedOnboarding));
    } catch (caughtError) {
      console.error('Error checking onboarding status:', caughtError);
      // Fail open to avoid blocking access on transient onboarding status errors.
      setHasCompletedOnboarding(true);
    }
  }, []);

  const refreshOnboardingStatus = useCallback(async () => {
    await checkOnboardingStatus();
  }, [checkOnboardingStatus]);

  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const statusResponse = await api.auth.status();
      const statusPayload = await parseJsonSafely<AuthStatusPayload>(statusResponse);

      setAllowRegistration(statusPayload?.allowRegistration !== false);

      if (statusPayload?.needsSetup) {
        setNeedsSetup(true);
        return;
      }

      setNeedsSetup(false);

      if (!token) {
        return;
      }

      const userResponse = await api.auth.user();
      if (!userResponse.ok) {
        clearSession();
        return;
      }

      const userPayload = await parseJsonSafely<AuthUserPayload>(userResponse);
      if (!userPayload?.user) {
        clearSession();
        return;
      }

      setUser(userPayload.user);
      await checkOnboardingStatus();
    } catch (caughtError) {
      console.error('[Auth] Auth status check failed:', caughtError);
      setError(AUTH_ERROR_MESSAGES.authStatusCheckFailed);
    } finally {
      setIsLoading(false);
    }
  }, [checkOnboardingStatus, clearSession, token]);

  useEffect(() => {
    if (IS_PLATFORM) {
      setUser({ username: 'platform-user' });
      setNeedsSetup(false);
      void checkOnboardingStatus().finally(() => {
        setIsLoading(false);
      });
      return;
    }

    void checkAuthStatus();
  }, [checkAuthStatus, checkOnboardingStatus]);

  const login = useCallback<AuthContextValue['login']>(
    async (email, password) => {
      try {
        setError(null);
        const response = await api.auth.login(email, password);
        const payload = await parseJsonSafely<AuthSessionPayload>(response);

        // Support both new { data: { user, token } } and legacy { user, token } formats
        const userData = payload?.data?.user || payload?.user;
        const tokenData = payload?.data?.token || payload?.token;

        if (!response.ok || !tokenData || !userData) {
          const rawError = payload?.error;
          const errorMsg = (typeof rawError === 'object' && rawError !== null && 'message' in rawError)
            ? (rawError as { message: string }).message
            : rawError;
          const message = typeof errorMsg === 'string' ? errorMsg : AUTH_ERROR_MESSAGES.loginFailed;
          setError(message);
          return { success: false, error: message };
        }

        setSession(userData, tokenData);
        setNeedsSetup(false);
        await checkOnboardingStatus();
        return { success: true };
      } catch (caughtError) {
        console.error('Login error:', caughtError);
        setError(AUTH_ERROR_MESSAGES.networkError);
        return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
      }
    },
    [checkOnboardingStatus, setSession],
  );

  const register = useCallback<AuthContextValue['register']>(
    async (email, password, username) => {
      try {
        setError(null);
        const response = await api.auth.register(email, password, username);
        const payload = await parseJsonSafely<AuthSessionPayload>(response);

        // Support both new { data: { user, token } } and legacy { user, token } formats
        const userData = payload?.data?.user || payload?.user;
        const tokenData = payload?.data?.token || payload?.token;

        if (!response.ok || !tokenData || !userData) {
          const rawError = payload?.error;
          const errorMsg = (typeof rawError === 'object' && rawError !== null && 'message' in rawError)
            ? (rawError as { message: string }).message
            : rawError;
          const message = typeof errorMsg === 'string' ? errorMsg : AUTH_ERROR_MESSAGES.registrationFailed;
          setError(message);
          return { success: false, error: message };
        }

        setSession(userData, tokenData);
        setNeedsSetup(false);
        await checkOnboardingStatus();
        return { success: true };
      } catch (caughtError) {
        console.error('Registration error:', caughtError);
        setError(AUTH_ERROR_MESSAGES.networkError);
        return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
      }
    },
    [checkOnboardingStatus, setSession],
  );

  const updateProfile = useCallback<AuthContextValue['updateProfile']>(
    async (nickname) => {
      try {
        const response = await api.user.updateProfile(nickname);
        const payload = await parseJsonSafely<{ data?: { user?: AuthUser }; error?: { message?: string } }>(response);

        if (!response.ok) {
          const message = payload?.error?.message || '更新个人资料失败';
          return { success: false, error: message };
        }

        const updatedUser = payload?.data?.user;
        if (updatedUser) {
          setUser(updatedUser);
        }
        return { success: true };
      } catch (caughtError) {
        console.error('Update profile error:', caughtError);
        return { success: false, error: '网络错误，请稍后重试' };
      }
    },
    [],
  );

  const uploadAvatar = useCallback<AuthContextValue['uploadAvatar']>(
    async (formData) => {
      try {
        const response = await api.user.uploadAvatar(formData);
        const payload = await parseJsonSafely<{ data?: { avatar_url?: string }; error?: { message?: string } }>(response);

        if (!response.ok) {
          const message = payload?.error?.message || '上传头像失败';
          return { success: false, error: message };
        }

        const avatarUrl = payload?.data?.avatar_url;
        if (avatarUrl) {
          setUser((prev) => prev ? { ...prev, avatar_url: avatarUrl } : prev);
        }
        return { success: true, avatar_url: avatarUrl };
      } catch (caughtError) {
        console.error('Upload avatar error:', caughtError);
        return { success: false, error: '网络错误，请稍后重试' };
      }
    },
    [],
  );

  const updateRoles = useCallback<AuthContextValue['updateRoles']>(
    async (roles) => {
      try {
        const response = await api.user.updateRoles(roles);
        const payload = await parseJsonSafely<{ data?: { user?: AuthUser }; error?: { message?: string } }>(response);

        if (!response.ok) {
          const message = payload?.error?.message || '更新角色失败';
          return { success: false, error: message };
        }

        const updatedUser = payload?.data?.user;
        if (updatedUser) {
          setUser(updatedUser);
        }
        return { success: true };
      } catch (caughtError) {
        console.error('Update roles error:', caughtError);
        return { success: false, error: '网络错误，请稍后重试' };
      }
    },
    [],
  );

  const setActiveRole = useCallback<AuthContextValue['setActiveRole']>(
    async (role) => {
      try {
        const response = await api.user.setActiveRole(role);
        const payload = await parseJsonSafely<{ data?: { user?: AuthUser }; error?: { message?: string } }>(response);

        if (!response.ok) {
          const message = payload?.error?.message || '切换角色失败';
          return { success: false, error: message };
        }

        const updatedUser = payload?.data?.user;
        if (updatedUser) {
          setUser(updatedUser);
        }
        return { success: true };
      } catch (caughtError) {
        console.error('Set active role error:', caughtError);
        return { success: false, error: '网络错误，请稍后重试' };
      }
    },
    [],
  );

  const logout = useCallback(() => {
    const tokenToInvalidate = token;
    clearSession();

    if (tokenToInvalidate) {
      void api.auth.logout().catch((caughtError: unknown) => {
        console.error('Logout endpoint error:', caughtError);
      });
    }
  }, [clearSession, token]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      needsSetup,
      allowRegistration,
      hasCompletedOnboarding,
      error,
      login,
      register,
      logout,
      refreshOnboardingStatus,
      updateProfile,
      uploadAvatar,
      updateRoles,
      setActiveRole,
    }),
    [
      allowRegistration,
      error,
      hasCompletedOnboarding,
      isLoading,
      login,
      logout,
      needsSetup,
      refreshOnboardingStatus,
      register,
      setActiveRole,
      token,
      updateProfile,
      updateRoles,
      uploadAvatar,
      user,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
