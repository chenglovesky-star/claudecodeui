import { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../utils/api';

type DocumentData = {
  workflowId: number;
  type: string;
  typeLabel: string;
  content: string;
  creator: { username: string; nickname: string | null; avatarUrl: string | null };
  createdAt: string;
};

type DocumentPreviewProps = {
  teamId: number;
  workflowId: number;
  onBack: () => void;
};

export default function DocumentPreview({ teamId, workflowId, onBack }: DocumentPreviewProps) {
  const [doc, setDoc] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.team.getDocumentContent(teamId, workflowId);
        if (res.ok) {
          const data = await res.json();
          setDoc(data.data?.document || null);
        }
      } catch (e) {
        console.error('Failed to load document:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [teamId, workflowId]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中...</div>;
  }

  if (!doc) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">文档未找到</div>;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <button onClick={onBack} className="rounded p-1 hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h3 className="text-sm font-semibold">{doc.typeLabel}</h3>
          <p className="text-[10px] text-muted-foreground">
            {doc.creator.nickname || doc.creator.username} · {new Date(doc.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="prose prose-sm max-w-none whitespace-pre-wrap dark:prose-invert">
          {doc.content || '暂无内容'}
        </div>
      </div>
    </div>
  );
}
