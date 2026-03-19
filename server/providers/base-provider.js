// server/providers/base-provider.js
// IProvider 基类 — 所有 Provider 适配器的公共逻辑 (P2)
import { EventEmitter } from 'events';

export class BaseProvider extends EventEmitter {
  constructor(providerType) {
    super();
    this.providerType = providerType;
    this.isRunning = false;
    this.sessionId = null;
  }

  // IProvider 接口 — 子类必须实现
  start(config) { throw new Error(`${this.providerType}: start() not implemented`); }
  abort() { throw new Error(`${this.providerType}: abort() not implemented`); }

  dispose() {
    this.removeAllListeners();
    this.isRunning = false;
    this.sessionId = null;
  }

  // 便捷方法：emit 标准事件
  emitOutput(data) { this.emit('output', data); }
  emitComplete(result) { this.emit('complete', result); this.isRunning = false; }
  emitError(error) { this.emit('error', error); this.isRunning = false; }
}
