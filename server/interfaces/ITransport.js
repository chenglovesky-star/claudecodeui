// server/interfaces/ITransport.js
// 传输层接口定义 (P2: 依赖倒置)

/**
 * @typedef {'normal' | 'congested' | 'blocked'} BackpressureState
 *
 * @typedef {Object} SendResult
 * @property {boolean} success
 * @property {BackpressureState} backpressure
 *
 * @typedef {Object} ITransport
 * @property {(connectionId: string, message: object) => SendResult} send
 * @property {(connectionId: string, callback: (msg: object) => void) => void} onMessage
 * @property {(connectionId: string) => boolean} isAlive
 * @property {(connectionId: string) => BackpressureState} getBackpressureState
 */

export default {};
