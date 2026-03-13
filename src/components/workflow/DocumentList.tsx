import { useState, useEffect } from 'react';
import { FileText, BookOpen, Layers, GitBranch } from 'lucide-react';
import { api } from '../../utils/api';

type Document = {
  workflowId: number;
  type: string;
  typeLabel: string;
  creator: { username: string; nickname: string | null; avatarUrl: string | null };
  createdAt: string;
  updatedAt: string;
  preview: string;
  hasContent: boolean;
};

const TYPE_ICONS: Record<string, typeof FileText> = {
  product_brief: FileText,
  prd: BookOpen,
  architecture: Layers,
  epic_breakdown: GitBranch,
};

const TYPE_COLORS: Record<string, string> = {
  product_brief: 'text-blue-500',
  prd: 'text-green-500',
  architecture: 'text-purple-500',
  epic_breakdown: 'text-orange-500',
};

type DocumentListProps = {
  teamId: number;
  onPreview: (workflowId: number) => void;
};

export default function DocumentList({ teamId, onPreview }: DocumentListProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.team.getDocuments(teamId);
        if (res.ok) {
          const data = await res.json();
          setDocuments(data.data?.documents || []);
        }
      } catch (e) {
        console.error('Failed to load documents:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [teamId]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中...</div>;
  }

  if (documents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">暂无文档</p>
          <p className="mt-1 text-xs text-muted-foreground">完成工作流后，文档将自动保存到此处</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h3 className="mb-4 text-sm font-semibold">团队文档</h3>
      <div className="grid grid-cols-2 gap-3">
        {documents.map(doc => {
          const Icon = TYPE_ICONS[doc.type] || FileText;
          const color = TYPE_COLORS[doc.type] || 'text-gray-500';
          return (
            <button
              key={doc.workflowId}
              onClick={() => onPreview(doc.workflowId)}
              className="flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all hover:border-primary/50 hover:shadow-sm"
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-5 w-5 ${color}`} />
                <span className="text-sm font-medium">{doc.typeLabel}</span>
              </div>
              {doc.preview && (
                <p className="line-clamp-2 text-xs text-muted-foreground">{doc.preview}</p>
              )}
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{doc.creator.nickname || doc.creator.username}</span>
                <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
