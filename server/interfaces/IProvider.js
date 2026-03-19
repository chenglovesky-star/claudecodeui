// server/interfaces/IProvider.js
// Provider 适配器接口定义 (P2: 依赖倒置)

/**
 * @typedef {Object} IProvider
 * @property {(config: object) => void} start
 * @property {() => void} abort
 * @property {(callback: (data: object) => void) => void} onOutput
 * @property {(callback: (result: object) => void) => void} onComplete
 * @property {(callback: (error: Error) => void) => void} onError
 * @property {() => void} dispose
 */

export default {};
