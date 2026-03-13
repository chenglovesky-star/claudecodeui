import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, GitBranch, GitPullRequest, RefreshCw } from 'lucide-react';
import { useTeam } from '../../../contexts/TeamContext';
import { api } from '../../../utils/api';

type Branch = {
  name: string;
  shortHash: string;
  author: string;
  lastCommitDate: string;
  isCurrent: boolean;
  isRemote: boolean;
};

type PR = {
  number: number;
  title: string;
  state: string;
  author: string;
  createdAt: string;
};

type ProjectDetailViewProps = {
  projectId: number;
  projectName: string;
  onBack: () => void;
};

export default function ProjectDetailView({ projectId, projectName, onBack }: ProjectDetailViewProps) {
  const { currentTeam } = useTeam();
  const [activeTab, setActiveTab] = useState<'branches' | 'prs'>('branches');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [pullRequests, setPullRequests] = useState<PR[]>([]);
  const [prError, setPrError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!currentTeam) return;
    setIsLoading(true);
    try {
      const [branchRes, prRes] = await Promise.all([
        api.team.getProjectBranches(currentTeam.id, projectId),
        api.team.getProjectPRs(currentTeam.id, projectId),
      ]);

      if (branchRes.ok) {
        const payload = await branchRes.json();
        const data = payload?.data || payload;
        setBranches(data.branches || []);
        setCurrentBranch(data.currentBranch || '');
      }

      if (prRes.ok) {
        const payload = await prRes.json();
        const data = payload?.data || payload;
        setPullRequests(data.pullRequests || []);
        setPrError(data.error || null);
      }
    } catch (error) {
      console.error('Failed to load project data:', error);
    }
    setIsLoading(false);
  }, [currentTeam, projectId]);

  useEffect(() => {
    if (currentTeam) loadData();
  }, [currentTeam, projectId, loadData]);

  const stateLabel = (state: string) => {
    switch (state.toUpperCase()) {
      case 'OPEN': return { text: 'Open', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' };
      case 'MERGED': return { text: 'Merged', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' };
      case 'CLOSED': return { text: 'Closed', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' };
      default: return { text: state, cls: 'bg-gray-100 text-gray-700' };
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="rounded p-1 hover:bg-accent" title="返回">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h3 className="text-sm font-semibold truncate">{projectName}</h3>
        </div>
        <button
          onClick={loadData}
          disabled={isLoading}
          className="rounded p-1 hover:bg-accent"
          title="刷新"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        {([
          { key: 'branches' as const, label: '分支', icon: GitBranch },
          { key: 'prs' as const, label: 'Pull Requests', icon: GitPullRequest },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs transition-colors ${
              activeTab === key
                ? 'border-b-2 border-primary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-8 animate-pulse rounded bg-accent/50" />
          ))}
        </div>
      ) : activeTab === 'branches' ? (
        <div className="space-y-1">
          {branches.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无分支</p>
          ) : (
            branches.filter(b => !b.isRemote).map((branch) => (
              <div
                key={branch.name}
                className={`flex items-center justify-between rounded-md px-2 py-1.5 text-xs ${
                  branch.isCurrent ? 'bg-green-50 dark:bg-green-900/10' : 'hover:bg-accent/50'
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <GitBranch className={`h-3 w-3 flex-shrink-0 ${branch.isCurrent ? 'text-green-600' : 'text-muted-foreground'}`} />
                  <span className={`truncate ${branch.isCurrent ? 'font-medium text-green-700 dark:text-green-400' : ''}`}>
                    {branch.name}
                  </span>
                  {branch.isCurrent && (
                    <span className="rounded bg-green-100 px-1 py-0.5 text-[10px] text-green-700 dark:bg-green-900/30 dark:text-green-300">
                      当前
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-shrink-0">
                  <code>{branch.shortHash}</code>
                  <span>{branch.author}</span>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {prError && (
            <p className="text-xs text-muted-foreground">{prError}</p>
          )}
          {pullRequests.length === 0 && !prError ? (
            <p className="text-xs text-muted-foreground">暂无 Pull Requests</p>
          ) : (
            pullRequests.map((pr) => {
              const state = stateLabel(pr.state);
              return (
                <div key={pr.number} className="rounded-md border px-2.5 py-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs font-medium">#{pr.number}</span>{' '}
                      <span className="text-xs">{pr.title}</span>
                    </div>
                    <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${state.cls}`}>
                      {state.text}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {pr.author}{pr.createdAt ? ` · ${new Date(pr.createdAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
