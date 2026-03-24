export interface ErrorMapping {
  level: 1 | 2 | 3;
  title: string;
  description: string | ((meta: Record<string, unknown>) => string);
  actions: Array<'retry' | 'newSession' | 'settings' | 'continue'>;
}

export type ErrorMap = Record<string, ErrorMapping>;

export const ERROR_MAP: ErrorMap = {
  'auth-fallback': {
    level: 1,
    title: '正在切换备用通道...',
    description: (meta) => `第 ${meta.attempt || 1}/${meta.maxAttempts || 3} 次尝试`,
    actions: [],
  },
  'rate-limit-retry': {
    level: 1,
    title: 'API 繁忙，自动重试中...',
    description: (meta) => `${meta.retryAfterSec || 5} 秒后重试`,
    actions: [],
  },
  'firstResponse': {
    level: 2,
    title: 'API 未响应',
    description: '60 秒内未收到任何输出，可能是网络不稳定或 API 服务暂时不可用。',
    actions: ['retry', 'newSession'],
  },
  'activity': {
    level: 2,
    title: '输出中断',
    description: '120 秒无新内容，API 连接可能已中断。',
    actions: ['retry'],
  },
  'clientFallback': {
    level: 2,
    title: 'API 响应超时',
    description: '90 秒未收到数据返回，可能是网络问题或 API 服务不可用。',
    actions: ['retry', 'newSession'],
  },
  'auth-failed': {
    level: 2,
    title: '认证失败',
    description: '所有 API Key 均无法使用，请检查 Key 配置。',
    actions: ['retry', 'settings'],
  },
  'rate-limit-mid': {
    level: 2,
    title: '生成被限速中断',
    description: '已输出的内容已保留，可尝试继续生成。',
    actions: ['continue', 'retry'],
  },
  'queue-timeout': {
    level: 2,
    title: '排队超时',
    description: '等待超过 120 秒，当前系统繁忙。',
    actions: ['retry'],
  },
  'tool-timeout': {
    level: 2,
    title: '工具执行超时',
    description: '操作超过 10 分钟未完成。',
    actions: ['retry'],
  },
  'sdk-crash': {
    level: 2,
    title: '服务异常',
    description: '后端服务进程异常退出，请重试。',
    actions: ['retry', 'newSession'],
  },
  'global-timeout': {
    level: 3,
    title: '会话已到期',
    description: '单次会话上限 30 分钟，请新建会话继续对话。',
    actions: ['newSession'],
  },
  'quota-exceeded': {
    level: 3,
    title: '并发上限',
    description: '已达最大同时会话数，请等待现有会话完成。',
    actions: [],
  },
  'queue-full': {
    level: 3,
    title: '系统繁忙',
    description: '排队已满，请稍后再试。',
    actions: [],
  },
  'unknown': {
    level: 2,
    title: '发生错误',
    description: '请重试或新建会话。',
    actions: ['retry', 'newSession'],
  },
};

export function getErrorMapping(errorCode: string | undefined): ErrorMapping {
  return ERROR_MAP[errorCode || 'unknown'] || ERROR_MAP['unknown'];
}

export function getErrorDescription(mapping: ErrorMapping, meta?: Record<string, unknown>): string {
  if (typeof mapping.description === 'function') {
    return mapping.description(meta || {});
  }
  return mapping.description;
}
