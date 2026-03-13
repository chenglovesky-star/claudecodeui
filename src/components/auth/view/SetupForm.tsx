import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import AuthErrorAlert from './AuthErrorAlert';
import AuthInputField from './AuthInputField';
import AuthScreenLayout from './AuthScreenLayout';

type SetupFormProps = {
  onSwitchToLogin?: () => void;
};

type SetupFormState = {
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
};

const initialState: SetupFormState = {
  email: '',
  username: '',
  password: '',
  confirmPassword: '',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateSetupForm(formState: SetupFormState): string | null {
  if (!formState.email.trim() || !formState.password || !formState.confirmPassword) {
    return '请填写所有必填项。';
  }

  if (!EMAIL_REGEX.test(formState.email.trim())) {
    return '请输入有效的邮箱地址。';
  }

  if (formState.password.length < 6) {
    return '密码至少需要6个字符。';
  }

  if (formState.password !== formState.confirmPassword) {
    return '两次输入的密码不一致。';
  }

  return null;
}

export default function SetupForm({ onSwitchToLogin }: SetupFormProps) {
  const { register } = useAuth();

  const [formState, setFormState] = useState<SetupFormState>(initialState);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = useCallback((field: keyof SetupFormState, value: string) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      const validationError = validateSetupForm(formState);
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }

      setIsSubmitting(true);
      const result = await register(
        formState.email.trim(),
        formState.password,
        formState.username.trim() || undefined
      );
      if (!result.success) {
        setErrorMessage(result.error);
      }
      setIsSubmitting(false);
    },
    [formState, register],
  );

  return (
    <AuthScreenLayout
      title="欢迎使用 Claude Code 协作平台"
      description="创建您的账号以开始使用"
      footerText="注册后即可加入团队协作"
      logo={<img src="/logo.svg" alt="CloudCLI" className="h-16 w-16" />}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInputField
          id="email"
          label="邮箱"
          value={formState.email}
          onChange={(value) => updateField('email', value)}
          placeholder="请输入邮箱地址"
          isDisabled={isSubmitting}
          type="email"
        />

        <AuthInputField
          id="username"
          label="用户名（可选）"
          value={formState.username}
          onChange={(value) => updateField('username', value)}
          placeholder="留空则使用邮箱前缀"
          isDisabled={isSubmitting}
        />

        <AuthInputField
          id="password"
          label="密码"
          value={formState.password}
          onChange={(value) => updateField('password', value)}
          placeholder="请输入密码"
          isDisabled={isSubmitting}
          type="password"
        />

        <AuthInputField
          id="confirmPassword"
          label="确认密码"
          value={formState.confirmPassword}
          onChange={(value) => updateField('confirmPassword', value)}
          placeholder="再次输入密码"
          isDisabled={isSubmitting}
          type="password"
        />

        <AuthErrorAlert errorMessage={errorMessage} />

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-blue-700 disabled:bg-blue-400"
        >
          {isSubmitting ? '注册中...' : '创建账号'}
        </button>

        {onSwitchToLogin && (
          <p className="text-center text-sm text-muted-foreground">
            已有账号？{' '}
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="text-blue-600 hover:text-blue-700 hover:underline"
            >
              立即登录
            </button>
          </p>
        )}
      </form>
    </AuthScreenLayout>
  );
}
