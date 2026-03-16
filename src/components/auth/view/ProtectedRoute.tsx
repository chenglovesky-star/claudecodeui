import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { IS_PLATFORM } from '../../../constants/config';
import { useAuth } from '../context/AuthContext';
import Onboarding from '../../onboarding/view/Onboarding';
import AuthLoadingScreen from './AuthLoadingScreen';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';
import SetupForm from './SetupForm';

type ProtectedRouteProps = {
  children: ReactNode;
};

type AuthView = 'login' | 'register';

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, needsSetup, allowRegistration, hasCompletedOnboarding, refreshOnboardingStatus } = useAuth();
  const [authView, setAuthView] = useState<AuthView>('login');

  const switchToRegister = useCallback(() => setAuthView('register'), []);
  const switchToLogin = useCallback(() => setAuthView('login'), []);

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (IS_PLATFORM) {
    if (!hasCompletedOnboarding) {
      return <Onboarding onComplete={refreshOnboardingStatus} />;
    }

    return <>{children}</>;
  }

  if (needsSetup) {
    return <SetupForm />;
  }

  if (!user) {
    if (authView === 'register' && allowRegistration) {
      return <RegisterForm onSwitchToLogin={switchToLogin} />;
    }
    return <LoginForm onSwitchToRegister={allowRegistration ? switchToRegister : undefined} />;
  }

  if (!hasCompletedOnboarding) {
    return <Onboarding onComplete={refreshOnboardingStatus} />;
  }

  return <>{children}</>;
}
