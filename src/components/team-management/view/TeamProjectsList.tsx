import { useState, useEffect } from 'react';
import { FolderGit2, Plus, Trash2, GitBranch, ExternalLink } from 'lucide-react';
import { useTeam, useTeamPermission } from '../../../contexts/TeamContext';
import { api } from '../../../utils/api';
import ProjectDetailView from './ProjectDetailView';

type TeamProject = {
  id: number;
  team_id: number;
  project_path: string;
  name: string;
  description: string;
  default_branch: string;
  remote_url: string;
  added_by: number;
  added_at: string;
};

export default function TeamProjectsList() {
  const { currentTeam } = useTeam();
  const { canManageTeam } = useTeamPermission();
  const [projects, setProjects] = useState<TeamProject[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({ name: '', projectPath: '', description: '' });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedProject, setSelectedProject] = useState<TeamProject | null>(null);

  useEffect(() => {
    if (currentTeam) loadProjects();
  }, [currentTeam]);

  const loadProjects = async () => {
    if (!currentTeam) return;
    try {
      const res = await api.team.getProjects(currentTeam.id);
      if (res.ok) {
        const payload = await res.json();
        setProjects(payload?.data?.projects ?? payload ?? []);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  };

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 4000);
  };

  const handleCreate = async () => {
    if (!currentTeam || !formData.name.trim() || !formData.projectPath.trim()) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await api.team.createProject(currentTeam.id, {
        name: formData.name.trim(),
        projectPath: formData.projectPath.trim(),
        description: formData.description.trim(),
      });
      const payload = await res.json();
      if (!res.ok) {
        const msg = payload?.error?.message || '创建失败';
        showError(typeof msg === 'string' ? msg : '创建失败');
      } else {
        setFormData({ name: '', projectPath: '', description: '' });
        setIsCreating(false);
        await loadProjects();
      }
    } catch {
      showError('网络错误');
    }
    setIsSubmitting(false);
  };

  const handleRemove = async (projectPath: string) => {
    if (!currentTeam) return;
    if (!window.confirm('确定要移除此项目吗？此操作不可撤销。')) return;
    try {
      await api.team.removeProject(currentTeam.id, projectPath);
      await loadProjects();
    } catch (error) {
      console.error('Failed to remove project:', error);
    }
  };

  if (!currentTeam) return null;

  // Project detail drill-down
  if (selectedProject) {
    return (
      <ProjectDetailView
        projectId={selectedProject.id}
        projectName={selectedProject.name || selectedProject.project_path}
        onBack={() => setSelectedProject(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Error toast */}
      {errorMessage && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errorMessage}
        </div>
      )}

      {/* Create button / form */}
      {!isCreating ? (
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          关联项目
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border p-3">
          <input
            type="text"
            placeholder="项目名称"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            className="w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            type="text"
            placeholder="Git 仓库本地路径，如 /home/user/project"
            value={formData.projectPath}
            onChange={(e) => setFormData(prev => ({ ...prev, projectPath: e.target.value }))}
            className="w-full rounded border bg-background px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            type="text"
            placeholder="描述（可选）"
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            className="w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setIsCreating(false); setErrorMessage(null); }}
              className="rounded-md px-3 py-1 text-sm hover:bg-accent"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={isSubmitting || !formData.name.trim() || !formData.projectPath.trim()}
              className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? '验证中...' : '创建'}
            </button>
          </div>
        </div>
      )}

      {/* Project list */}
      {projects.length === 0 && !isCreating ? (
        <p className="text-sm text-muted-foreground">暂无关联项目</p>
      ) : (
        <div className="space-y-2">
          {projects.map((project) => (
            <div
              key={project.id}
              className="cursor-pointer rounded-lg border p-2.5 hover:border-primary/50 transition-colors"
              onClick={() => setSelectedProject(project)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderGit2 className="h-4 w-4 flex-shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{project.name || project.project_path}</div>
                    <code className="block truncate text-[11px] text-muted-foreground">{project.project_path}</code>
                  </div>
                </div>
                {canManageTeam && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemove(project.project_path); }}
                    className="flex-shrink-0 rounded p-1 hover:bg-destructive/10 hover:text-destructive"
                    title="移除项目"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              {project.description && (
                <p className="mt-1 truncate text-xs text-muted-foreground pl-6">{project.description}</p>
              )}
              <div className="mt-1.5 flex items-center gap-3 pl-6 text-[11px] text-muted-foreground">
                {project.default_branch && (
                  <span className="flex items-center gap-0.5">
                    <GitBranch className="h-3 w-3" />
                    {project.default_branch}
                  </span>
                )}
                {project.remote_url && (
                  <span className="flex items-center gap-0.5 truncate">
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{project.remote_url}</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
