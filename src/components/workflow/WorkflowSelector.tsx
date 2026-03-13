import { FileText, BookOpen, Layers, GitBranch } from 'lucide-react';

const WORKFLOW_TYPES = [
  {
    id: 'product_brief',
    title: '产品简报',
    description: 'AI 引导创建产品简报，明确项目目标、用户和核心功能',
    icon: FileText,
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
  },
  {
    id: 'prd',
    title: 'PRD 文档',
    description: '需求收集、用户故事、验收标准等完整产品需求文档',
    icon: BookOpen,
    color: 'text-green-500',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
  },
  {
    id: 'architecture',
    title: '技术架构',
    description: '技术选型、系统设计、数据模型和 API 设计',
    icon: Layers,
    color: 'text-purple-500',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
  },
  {
    id: 'epic_breakdown',
    title: 'Epic 拆分',
    description: '将需求拆分为 Epic 和 Story，确定优先级排序',
    icon: GitBranch,
    color: 'text-orange-500',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
  },
];

type WorkflowSelectorProps = {
  onStart: (type: string) => void;
};

export default function WorkflowSelector({ onStart }: WorkflowSelectorProps) {
  return (
    <div className="p-6">
      <h2 className="mb-2 text-lg font-semibold">选择工作流</h2>
      <p className="mb-6 text-sm text-muted-foreground">AI 将引导你逐步完成文档创建</p>

      <div className="grid grid-cols-2 gap-4">
        {WORKFLOW_TYPES.map(wf => {
          const Icon = wf.icon;
          return (
            <button
              key={wf.id}
              onClick={() => onStart(wf.id)}
              className={`flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-all hover:border-primary/50 hover:shadow-md ${wf.bgColor}`}
            >
              <Icon className={`h-8 w-8 ${wf.color}`} />
              <div>
                <h3 className="text-sm font-semibold">{wf.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{wf.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
