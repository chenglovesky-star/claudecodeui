// server/interfaces/ISession.js
// 会话层接口定义 (P2: 依赖倒置)

/**
 * @typedef {'idle'|'running'|'streaming'|'tool_executing'|'completed'|'timeout'|'error'|'aborted'} SessionState
 *
 * @typedef {Object} ResumeData
 * @property {Array} missedCriticalEvents
 * @property {object} [snapshot]
 * @property {SessionState} currentState
 * @property {number} lastSeqId
 *
 * @typedef {Object} ISession
 * @property {(userId: number, connectionId: string, config: object) => string} create
 * @property {(sessionId: string) => void} abort
 * @property {(sessionId: string) => SessionState} getState
 * @property {(sessionId: string, lastSeqId: number) => ResumeData} resume
 */

export default {};
