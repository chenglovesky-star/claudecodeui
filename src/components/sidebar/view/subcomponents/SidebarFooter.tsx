import { Settings, LogOut } from 'lucide-react';
import type { TFunction } from 'i18next';

type SidebarFooterProps = {
  onShowSettings: () => void;
  onLogout: () => void;
  t: TFunction;
};

export default function SidebarFooter({
  onShowSettings,
  onLogout,
  t,
}: SidebarFooterProps) {
  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Settings */}
      <div className="nav-divider" />

      {/* Desktop settings */}
      <div className="hidden px-2 py-1.5 md:block">
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={onShowSettings}
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="text-sm">{t('actions.settings')}</span>
        </button>
      </div>

      {/* Desktop logout */}
      <div className="hidden px-2 pb-1.5 md:block">
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-red-50/80 hover:text-red-600 dark:hover:bg-red-900/15 dark:hover:text-red-400"
          onClick={onLogout}
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="text-sm">{t('actions.logout')}</span>
        </button>
      </div>

      {/* Mobile settings */}
      <div className="px-3 pt-2 md:hidden">
        <button
          className="flex h-12 w-full items-center gap-3.5 rounded-xl bg-muted/40 px-4 transition-all hover:bg-muted/60 active:scale-[0.98]"
          onClick={onShowSettings}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-background/80">
            <Settings className="w-4.5 h-4.5 text-muted-foreground" />
          </div>
          <span className="text-base font-medium text-foreground">{t('actions.settings')}</span>
        </button>
      </div>

      {/* Mobile logout */}
      <div className="px-3 pb-20 pt-2 md:hidden">
        <button
          className="flex h-12 w-full items-center gap-3.5 rounded-xl bg-muted/40 px-4 transition-all hover:bg-red-50/60 active:scale-[0.98] dark:hover:bg-red-900/15"
          onClick={onLogout}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-background/80">
            <LogOut className="w-4.5 h-4.5 text-muted-foreground" />
          </div>
          <span className="text-base font-medium text-foreground">{t('actions.logout')}</span>
        </button>
      </div>
    </div>
  );
}
