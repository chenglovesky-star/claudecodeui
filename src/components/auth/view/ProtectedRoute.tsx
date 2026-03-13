import { useState } from 'react';
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
  const { user, isLoading, needsSetup, hasCompletedOnboarding, refreshOnboardingStatus } = useAuth();
  const [showRegister, setShowRegister] = useState(false);

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (IS_PLATFORM) {
    if (!hasCompletedOnboarding) {
      return <Onboarding onComplete={refreshOnboardingStatus} />;
    }

    return <>{children}</>;
  }

  // Show registration form if needsSetup (first user) or user explicitly chose to register
  if (needsSetup || (!user && showRegister)) {
    return <SetupForm onSwitchToLogin={() => setShowRegister(false)} />;
  }

  if (!user) {
    return <LoginForm onSwitchToRegister={() => setShowRegister(true)} />;
  }

  if (!hasCompletedOnboarding) {
    return <Onboarding onComplete={refreshOnboardingStatus} />;
  }

  return <>{children}</>;
}
