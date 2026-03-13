import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import AuthErrorAlert from './AuthErrorAlert';
import AuthInputField from './AuthInputField';
import AuthScreenLayout from './AuthScreenLayout';

type LoginFormProps = {
  onSwitchToRegister?: () => void;
};

type LoginFormState = {
  email: string;
  password: string;
};

const initialState: LoginFormState = {
  email: '',
  password: '',
};

export default function LoginForm({ onSwitchToRegister }: LoginFormProps) {
  const { t } = useTranslation('auth');
  const { login } = useAuth();

  const [formState, setFormState] = useState<LoginFormState>(initialState);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = useCallback((field: keyof LoginFormState, value: string) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      if (!formState.email.trim() || !formState.password) {
        setErrorMessage(t('login.errors.requiredFields', '请填写邮箱和密码'));
        return;
      }

      setIsSubmitting(true);
      const result = await login(formState.email.trim(), formState.password);
      if (!result.success) {
        setErrorMessage(result.error);
      }
      setIsSubmitting(false);
    },
    [formState.password, formState.email, login, t],
  );

  return (
    <AuthScreenLayout
      title={t('login.title')}
      description={t('login.description')}
      footerText={t('login.footer', '输入您的凭证以访问 Claude Code 协作平台')}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInputField
          id="email"
          label={t('login.email', '邮箱')}
          value={formState.email}
          onChange={(value) => updateField('email', value)}
          placeholder={t('login.placeholders.email', '请输入邮箱地址')}
          isDisabled={isSubmitting}
        />

        <AuthInputField
          id="password"
          label={t('login.password')}
          value={formState.password}
          onChange={(value) => updateField('password', value)}
          placeholder={t('login.placeholders.password')}
          isDisabled={isSubmitting}
          type="password"
        />

        <AuthErrorAlert errorMessage={errorMessage} />

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-blue-700 disabled:bg-blue-400"
        >
          {isSubmitting ? t('login.loading') : t('login.submit')}
        </button>

        {onSwitchToRegister && (
          <p className="text-center text-sm text-muted-foreground">
            {t('login.noAccount', '还没有账号？')}{' '}
            <button
              type="button"
              onClick={onSwitchToRegister}
              className="text-blue-600 hover:text-blue-700 hover:underline"
            >
              {t('login.registerLink', '立即注册')}
            </button>
          </p>
        )}
      </form>
    </AuthScreenLayout>
  );
}
