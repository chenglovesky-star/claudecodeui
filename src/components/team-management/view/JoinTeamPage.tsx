import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { api } from '../../../utils/api';

export default function JoinTeamPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [teamName, setTeamName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!inviteCode) {
      setStatus('error');
      setErrorMessage('邀请码无效');
      return;
    }

    const joinTeam = async () => {
      try {
        const res = await api.team.join(inviteCode);
        const payload = await res.json();

        if (res.ok) {
          const team = payload?.data?.team || payload?.team;
          setTeamName(team?.name || '');
          setStatus('success');
          // Redirect to home after 2 seconds
          setTimeout(() => navigate('/'), 2000);
        } else {
          const error = payload?.error;
          setErrorMessage(typeof error === 'object' ? error.message : error || '加入团队失败');
          setStatus('error');
        }
      } catch {
        setErrorMessage('网络错误，请稍后重试');
        setStatus('error');
      }
    };

    joinTeam();
  }, [inviteCode, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border bg-background p-8 text-center shadow-lg">
        {status === 'loading' && (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-blue-500" />
            <h2 className="mt-4 text-lg font-semibold">正在加入团队...</h2>
            <p className="mt-2 text-sm text-muted-foreground">请稍候</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="mx-auto h-10 w-10 text-green-500" />
            <h2 className="mt-4 text-lg font-semibold">加入成功！</h2>
            <div className="mt-2 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>{teamName}</span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">正在跳转...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="mx-auto h-10 w-10 text-red-500" />
            <h2 className="mt-4 text-lg font-semibold">加入失败</h2>
            <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
            <button
              onClick={() => navigate('/')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              返回首页
            </button>
          </>
        )}
      </div>
    </div>
  );
}
