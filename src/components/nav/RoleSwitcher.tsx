import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Shield, Code, Bug, Layers, Palette } from 'lucide-react';
import { useAuth } from '../auth/context/AuthContext';

const ROLE_CONFIG: Record<string, { label: string; icon: typeof Shield }> = {
  'pm': { label: '产品经理', icon: Shield },
  'developer': { label: '开发者', icon: Code },
  'qa': { label: '质量保证', icon: Bug },
  'architect': { label: '架构师', icon: Layers },
  'ux-designer': { label: 'UX 设计师', icon: Palette },
};

export default function RoleSwitcher() {
  const { user, setActiveRole } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const roles = user?.roles || [];
  const activeRole = user?.active_role || '';

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSwitch = useCallback(async (role: string) => {
    if (role === activeRole || isSwitching) return;
    setIsSwitching(true);
    try {
      await setActiveRole(role);
    } finally {
      setIsSwitching(false);
      setIsOpen(false);
    }
  }, [activeRole, isSwitching, setActiveRole]);

  // Don't render if no roles selected
  if (roles.length === 0) return null;

  const activeConfig = ROLE_CONFIG[activeRole] || ROLE_CONFIG[roles[0]];
  const ActiveIcon = activeConfig?.icon || Shield;
  const canSwitch = roles.length > 1;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => canSwitch && setIsOpen(!isOpen)}
        disabled={isSwitching}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors ${
          canSwitch
            ? 'cursor-pointer hover:bg-accent/60 text-muted-foreground hover:text-foreground'
            : 'cursor-default text-muted-foreground'
        } ${isSwitching ? 'opacity-50' : ''}`}
        title={activeConfig?.label || activeRole}
      >
        <ActiveIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{activeConfig?.label || activeRole}</span>
        {canSwitch && <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
      </button>

      {isOpen && canSwitch && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-popover p-1 shadow-lg">
          {roles.map((role) => {
            const config = ROLE_CONFIG[role];
            if (!config) return null;
            const Icon = config.icon;
            const isActive = role === activeRole;
            return (
              <button
                key={role}
                type="button"
                onClick={() => handleSwitch(role)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                    : 'text-foreground hover:bg-accent/60'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{config.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
