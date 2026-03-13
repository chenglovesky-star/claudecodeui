/**
 * EVENT BUS
 * =========
 * Singleton EventEmitter for internal service-to-service communication.
 * Used by ProcessRegistry, FileTrackingService, and WebSocket handlers.
 */

import { EventEmitter } from 'events';

let instance = null;

export default class EventBus extends EventEmitter {
    constructor() {
        if (instance) return instance;
        super();
        this.setMaxListeners(50);
        instance = this;
    }

    static getInstance() {
        if (!instance) {
            new EventBus();
        }
        return instance;
    }
}
