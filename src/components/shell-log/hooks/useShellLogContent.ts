import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../utils/api';
import type { ShellLogSession } from '../../../types/app';

export function useShellLogContent(session: ShellLogSession | null, projectName: string | undefined) {
  const [content, setContent] = useState('');
  const [lineCount, setLineCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !projectName) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.shellSessionContent(projectName, session.id);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { content: string; lineCount: number };
      setContent(data.content);
      setLineCount(data.lineCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setIsLoading(false);
    }
  }, [session, projectName]);

  useEffect(() => {
    void load();
  }, [load]);

  return { content, lineCount, isLoading, error, reload: load };
}
