import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, GitBranch, GitPullRequest, RefreshCw,
  FolderOpen, Folder, FileText, FileCode, History,
  ChevronRight, ChevronDown
} from 'lucide-react';
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

type FileNode = {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
};

type Commit = {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  email: string;
  date: string;
};

type TabKey = 'branches' | 'prs' | 'files' | 'commits';

type ProjectDetailViewProps = {
  projectId: number;
  projectName: string;
  onBack: () => void;
};

// File icon based on extension
function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const codeExts = ['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'scss', 'html', 'vue', 'svelte'];
  if (codeExts.includes(ext)) {
    return <FileCode className="h-3 w-3 flex-shrink-0 text-blue-500" />;
  }
  return <FileText className="h-3 w-3 flex-shrink-0 text-muted-foreground" />;
}

// Recursive file tree node
function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-accent/50"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {expanded ? <ChevronDown className="h-3 w-3 flex-shrink-0" /> : <ChevronRight className="h-3 w-3 flex-shrink-0" />}
          {expanded ? <FolderOpen className="h-3 w-3 flex-shrink-0 text-yellow-600" /> : <Folder className="h-3 w-3 flex-shrink-0 text-yellow-600" />}
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {expanded && node.children?.map((child) => (
          <TreeNode key={child.path} node={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-accent/50"
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      title={node.path}
    >
      <FileIcon name={node.name} />
      <span className="truncate">{node.name}</span>
    </div>
  );
}

// Relative time helper
function relativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return '';
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

export default function ProjectDetailView({ projectId, projectName, onBack }: ProjectDetailViewProps) {
  const { currentTeam } = useTeam();
  const [activeTab, setActiveTab] = useState<TabKey>('branches');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [pullRequests, setPullRequests] = useState<PR[]>([]);
  const [prError, setPrError] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [fileRef, setFileRef] = useState('');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [commitTotal, setCommitTotal] = useState(0);
  const [commitOffset, setCommitOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const loadData = useCallback(async () => {
    if (!currentTeam) return;
    setIsLoading(true);
    try {
      const [branchRes, prRes, filesRes, commitsRes] = await Promise.all([
        api.team.getProjectBranches(currentTeam.id, projectId),
        api.team.getProjectPRs(currentTeam.id, projectId),
        api.team.getProjectFiles(currentTeam.id, projectId),
        api.team.getProjectCommits(currentTeam.id, projectId, 20, 0),
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

      if (filesRes.ok) {
        const payload = await filesRes.json();
        const data = payload?.data || payload;
        setFileTree(data.tree || []);
        setFileRef(data.ref || '');
      }

      if (commitsRes.ok) {
        const payload = await commitsRes.json();
        const data = payload?.data || payload;
        setCommits(data.commits || []);
        setCommitTotal(data.total || 0);
        setCommitOffset(20);
      }
    } catch (error) {
      console.error('Failed to load project data:', error);
    }
    setIsLoading(false);
  }, [currentTeam, projectId]);

  const loadMoreCommits = async () => {
    if (!currentTeam || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await api.team.getProjectCommits(currentTeam.id, projectId, 20, commitOffset);
      if (res.ok) {
        const payload = await res.json();
        const data = payload?.data || payload;
        setCommits(prev => [...prev, ...(data.commits || [])]);
        setCommitOffset(prev => prev + 20);
      }
    } catch (error) {
      console.error('Failed to load more commits:', error);
    }
    setIsLoadingMore(false);
  };

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

  const tabs: { key: TabKey; label: string; icon: typeof GitBranch }[] = [
    { key: 'branches', label: '分支', icon: GitBranch },
    { key: 'prs', label: 'Pull Requests', icon: GitPullRequest },
    { key: 'files', label: '文件', icon: FolderOpen },
    { key: 'commits', label: '变更记录', icon: History },
  ];

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
      <div className="flex border-b overflow-x-auto">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs whitespace-nowrap transition-colors ${
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
      ) : activeTab === 'prs' ? (
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
      ) : activeTab === 'files' ? (
        <div>
          {fileRef && (
            <div className="mb-2 flex items-center gap-1 text-[10px] text-muted-foreground">
              <GitBranch className="h-3 w-3" />
              <span>{fileRef}</span>
            </div>
          )}
          {fileTree.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无文件</p>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              {fileTree.map((node) => (
                <TreeNode key={node.path} node={node} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          {commits.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无提交记录</p>
          ) : (
            <>
              {commits.map((commit) => (
                <div key={commit.hash} className="rounded-md px-2 py-1.5 hover:bg-accent/50">
                  <div className="flex items-start gap-2">
                    <code className="flex-shrink-0 rounded bg-accent px-1 py-0.5 text-[10px] text-muted-foreground">
                      {commit.shortHash}
                    </code>
                    <span className="text-xs leading-snug line-clamp-2">{commit.message}</span>
                  </div>
                  <div className="mt-0.5 pl-[52px] text-[10px] text-muted-foreground">
                    {commit.author}{commit.date ? ` · ${relativeTime(commit.date)}` : ''}
                  </div>
                </div>
              ))}
              {commits.length < commitTotal && (
                <button
                  onClick={loadMoreCommits}
                  disabled={isLoadingMore}
                  className="w-full rounded-md py-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                >
                  {isLoadingMore ? '加载中...' : '加载更多'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
