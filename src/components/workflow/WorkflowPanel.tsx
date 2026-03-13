import { useState, useEffect, useCallback } from 'react';
import { useTeam } from '../../contexts/TeamContext';
import { api } from '../../utils/api';
import WorkflowSelector from './WorkflowSelector';
import WorkflowChat from './WorkflowChat';
import DocumentList from './DocumentList';
import DocumentPreview from './DocumentPreview';

type WorkflowInstance = {
  id: number;
  team_id: number;
  user_id: number;
  workflow_type: string;
  status: string;
  context_json: string;
  current_step: string | null;
  total_steps: number;
  username: string;
  nickname: string | null;
  created_at: string;
  updated_at: string;
};

type WorkflowStep = {
  id: string;
  label: string;
};

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

export type { WorkflowInstance, WorkflowStep, Document };

type View = 'selector' | 'chat' | 'documents' | 'doc-preview';

export default function WorkflowPanel() {
  const { currentTeam } = useTeam();
  const [view, setView] = useState<View>('selector');
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowInstance | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [previewDocId, setPreviewDocId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const teamId = currentTeam?.id;

  const checkActiveWorkflow = useCallback(async () => {
    if (!teamId) return;
    try {
      const res = await api.team.getActiveWorkflow(teamId);
      if (res.ok) {
        const data = await res.json();
        if (data.data?.workflow) {
          setActiveWorkflow(data.data.workflow);
          // Load steps
          const detailRes = await api.team.getWorkflow(teamId, data.data.workflow.id);
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            setSteps(detailData.data?.steps || []);
          }
          setView('chat');
        }
      }
    } catch (e) {
      console.error('Failed to check active workflow:', e);
    }
  }, [teamId]);

  useEffect(() => {
    setLoading(true);
    checkActiveWorkflow().finally(() => setLoading(false));
  }, [checkActiveWorkflow]);

  const handleStartWorkflow = async (type: string) => {
    if (!teamId) return;
    try {
      const res = await api.team.startWorkflow(teamId, type);
      if (res.ok) {
        const data = await res.json();
        setActiveWorkflow(data.data?.workflow || null);
        setSteps(data.data?.steps || []);
        setView('chat');
      } else {
        const err = await res.json();
        if (err.error?.code === 'ACTIVE_EXISTS') {
          setActiveWorkflow(err.error.activeWorkflow);
          setView('chat');
        }
      }
    } catch (e) {
      console.error('Failed to start workflow:', e);
    }
  };

  const handleWorkflowComplete = () => {
    setActiveWorkflow(null);
    setSteps([]);
    setView('documents');
  };

  const handleCancel = async () => {
    if (!teamId || !activeWorkflow) return;
    try {
      const res = await api.team.cancelWorkflow(teamId, activeWorkflow.id);
      if (res.ok) {
        setActiveWorkflow(null);
        setSteps([]);
        setView('selector');
      }
    } catch (e) {
      console.error('Failed to cancel:', e);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Navigation */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <button
          onClick={() => setView('selector')}
          className={`rounded-md px-3 py-1 text-xs ${view === 'selector' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
        >
          新建工作流
        </button>
        {activeWorkflow && (
          <button
            onClick={() => setView('chat')}
            className={`rounded-md px-3 py-1 text-xs ${view === 'chat' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
          >
            当前工作流
          </button>
        )}
        <button
          onClick={() => setView('documents')}
          className={`rounded-md px-3 py-1 text-xs ${view === 'documents' || view === 'doc-preview' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
        >
          文档库
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {view === 'selector' && (
          <WorkflowSelector onStart={handleStartWorkflow} />
        )}
        {view === 'chat' && activeWorkflow && teamId && (
          <WorkflowChat
            teamId={teamId}
            workflow={activeWorkflow}
            steps={steps}
            onComplete={handleWorkflowComplete}
            onCancel={handleCancel}
          />
        )}
        {view === 'documents' && teamId && (
          <DocumentList
            teamId={teamId}
            onPreview={(docId) => { setPreviewDocId(docId); setView('doc-preview'); }}
          />
        )}
        {view === 'doc-preview' && teamId && previewDocId && (
          <DocumentPreview
            teamId={teamId}
            workflowId={previewDocId}
            onBack={() => setView('documents')}
          />
        )}
      </div>
    </div>
  );
}
