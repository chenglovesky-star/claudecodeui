// server/config/constants.js
// 集中定义所有阈值常量，消除魔法数字 (P5)

// ========== 传输层 ==========
export const HEARTBEAT_INTERVAL_MS = 20000;        // 心跳间隔 20 秒
export const HEARTBEAT_PONG_TIMEOUT_MS = 8000;     // pong 超时 8 秒
export const HEARTBEAT_MAX_MISSED = 2;             // 连续 2 次未响应才断开
export const BACKPRESSURE_WARN_BYTES = 64 * 1024;  // 64KB 拥塞警告
export const BACKPRESSURE_BLOCK_BYTES = 256 * 1024; // 256KB 阻塞阈值
export const ZOMBIE_SCAN_INTERVAL_MS = 60000;      // 僵尸连接扫描间隔 60 秒

// ========== 客户端重连 ==========
export const RECONNECT_BASE_MS = 1000;             // 初始重连延迟
export const RECONNECT_MAX_MS = 30000;             // 最大重连延迟

// ========== 客户端消息队列 ==========
export const MESSAGE_QUEUE_MAX = 50;               // 消息队列上限

// ========== 会话层（Plan 2 使用）==========
export const SESSION_FIRST_RESPONSE_TIMEOUT_MS = 60000;   // 首响应超时 60 秒
export const SESSION_ACTIVITY_TIMEOUT_MS = 120000;        // 流式活动超时 120 秒
export const SESSION_TOOL_TIMEOUT_MS = 600000;            // 工具执行超时 10 分钟
export const SESSION_GLOBAL_TIMEOUT_MS = 1800000;         // 全局超时 30 分钟
export const SESSION_MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 单会话最大输出 10MB
export const PROCESS_SIGTERM_TIMEOUT_MS = 5000;           // SIGTERM 等待 5 秒
export const PROCESS_SIGKILL_TIMEOUT_MS = 2000;           // SIGKILL 等待 2 秒

// ========== 资源配额（Plan 2 使用）==========
export const QUOTA_MAX_SESSIONS_PER_USER = 3;      // 每用户并发会话上限
export const QUOTA_MAX_SESSIONS_GLOBAL = 30;        // 全局并发会话上限

// ========== 消息缓冲（Plan 2 使用）==========
export const BUFFER_CRITICAL_EVENTS_MAX = 500;      // 关键事件缓冲上限
export const BUFFER_SEQ_ID_START = 1;               // seqId 起始值

// ========== 前端防卡死（Plan 3 使用）==========
export const CLIENT_FALLBACK_TIMEOUT_MS = 90000;    // 前端兜底超时 90 秒
export const CLIENT_TOOL_FALLBACK_TIMEOUT_MS = 630000; // 工具执行兜底 10.5 分钟

// ========== Shell ==========
export const PTY_SESSION_TIMEOUT_MS = 1800000;      // PTY 会话超时 30 分钟
export const SHELL_URL_PARSE_BUFFER_LIMIT = 32768;  // URL 检测缓冲区限制
