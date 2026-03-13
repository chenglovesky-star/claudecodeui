import { MessageSquare, Terminal, Folder, GitBranch, ClipboardCheck, LayoutDashboard, AlertTriangle, Workflow, type LucideIcon } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../../../../shared/view/ui';
import type { AppTab } from '../../../../types/app';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
};

type TabDefinition = {
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
};

const BASE_TABS: TabDefinition[] = [
  { id: 'chat', labelKey: 'tabs.chat', icon: MessageSquare },
  { id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { id: 'files', labelKey: 'tabs.files', icon: Folder },
  { id: 'git', labelKey: 'tabs.git', icon: GitBranch },
];

const TASKS_TAB: TabDefinition = {
  id: 'tasks',
  labelKey: 'tabs.tasks',
  icon: ClipboardCheck,
};

const KANBAN_TAB: TabDefinition = {
  id: 'kanban',
  labelKey: 'tabs.kanban',
  icon: LayoutDashboard,
};

const CONFLICTS_TAB: TabDefinition = {
  id: 'conflicts',
  labelKey: 'tabs.conflicts',
  icon: AlertTriangle,
};

const WORKFLOW_TAB: TabDefinition = {
  id: 'workflow',
  labelKey: 'tabs.workflow',
  icon: Workflow,
};

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();

  const tabs = [...BASE_TABS, ...(shouldShowTasksTab ? [TASKS_TAB] : []), KANBAN_TAB, CONFLICTS_TAB, WORKFLOW_TAB];

  return (
    <div className="inline-flex items-center gap-[2px] rounded-lg bg-muted/60 p-[3px]">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === activeTab;

        return (
          <Tooltip key={tab.id} content={t(tab.labelKey)} position="bottom">
            <button
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-1.5 rounded-md px-2.5 py-[5px] text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="hidden lg:inline">{t(tab.labelKey)}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
