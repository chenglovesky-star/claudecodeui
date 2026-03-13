import type { TeamRole } from '../../contexts/TeamContext';

export type TeamFormData = {
  name: string;
  description: string;
};

export type InviteFormData = {
  expiresInHours: number | null;
  maxUses: number;
};

export const ROLE_LABELS: Record<TeamRole, string> = {
  pm: '产品经理',
  architect: '架构师',
  developer: '开发者',
  sm: 'Scrum Master',
  qa: '质量保证',
  ux: 'UX 设计师',
  analyst: '分析师',
};

export const ROLE_COLORS: Record<TeamRole, string> = {
  pm: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  architect: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  developer: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  sm: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  qa: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  ux: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  analyst: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
};
