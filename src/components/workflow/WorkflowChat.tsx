import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, X, ChevronRight } from 'lucide-react';
import { api } from '../../utils/api';
import type { WorkflowInstance, WorkflowStep } from './WorkflowPanel';

type Message = {
  id: number;
  workflow_id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  step_name: string | null;
  created_at: string;
};

const WORKFLOW_LABELS: Record<string, string> = {
  product_brief: '产品简报',
  prd: 'PRD',
  architecture: '技术架构',
  epic_breakdown: 'Epic 拆分',
};

type WorkflowChatProps = {
  teamId: number;
  workflow: WorkflowInstance;
  steps: WorkflowStep[];
  onComplete: () => void;
  onCancel: () => void;
};

export default function WorkflowChat({ teamId, workflow, steps, onComplete, onCancel }: WorkflowChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [currentStep, setCurrentStep] = useState(workflow.current_step);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const res = await api.team.getWorkflowMessages(teamId, workflow.id);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.data?.messages?.filter((m: Message) => m.step_name !== 'final_document') || []);
      }
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  }, [teamId, workflow.id]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (content: string, type?: string) => {
    if (!content.trim() || sending) return;
    setSending(true);
    try {
      const res = await api.team.sendWorkflowMessage(teamId, workflow.id, content, type);
      if (res.ok) {
        const data = await res.json();
        const newMessages: Message[] = [];
        if (data.data?.userMessage) newMessages.push(data.data.userMessage);
        if (data.data?.aiReply) newMessages.push(data.data.aiReply);
        setMessages(prev => [...prev, ...newMessages]);
        setInput('');

        // Check if workflow completed
        if (data.data?.aiReply?.step_name === 'completed') {
          onComplete();
        } else if (data.data?.aiReply?.step_name && data.data.aiReply.step_name !== currentStep) {
          setCurrentStep(data.data.aiReply.step_name);
        }
      }
    } catch (e) {
      console.error('Failed to send:', e);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const context = JSON.parse(workflow.context_json || '{}');
  const completedSteps = context.completedSteps || [];
  const isCompleted = workflow.status === 'completed';

  return (
    <div className="flex h-full flex-col">
      {/* Workflow header */}
      <div className="border-b px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{WORKFLOW_LABELS[workflow.workflow_type] || workflow.workflow_type}</span>
            {isCompleted && <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">已完成</span>}
          </div>
          {!isCompleted && (
            <button onClick={onCancel} className="rounded p-1 text-xs text-muted-foreground hover:bg-accent">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {/* Step progress */}
        <div className="mt-2 flex items-center gap-1 overflow-x-auto pb-1">
          {steps.map((step, i) => {
            const isDone = completedSteps.includes(step.id);
            const isCurrent = step.id === currentStep;
            return (
              <div key={step.id} className="flex shrink-0 items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                <span className={`rounded px-2 py-0.5 text-[10px] ${
                  isCurrent ? 'bg-primary font-medium text-primary-foreground' :
                  isDone ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto p-4">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : msg.role === 'system'
                ? 'bg-muted italic text-muted-foreground'
                : 'bg-accent'
            }`}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
              <div className={`mt-1 text-[10px] ${msg.role === 'user' ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                {new Date(msg.created_at).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      {!isCompleted && (
        <div className="border-t p-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => sendMessage('next', 'choice')}
              disabled={sending}
              className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              下一步 →
            </button>
            <div className="flex flex-1 items-center gap-2 rounded-lg border bg-background px-3 py-1.5">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入内容..."
                className="flex-1 resize-none bg-transparent text-sm outline-none"
                rows={1}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || sending}
                className="shrink-0 rounded p-1 text-primary hover:bg-accent disabled:opacity-30"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
