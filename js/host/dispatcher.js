import { MSG_TYPES, createMessage } from '../shared/protocol.js';

export class Dispatcher {
  constructor(transport, tasks = []) {
    this.transport = transport;
    this.queue = [...tasks];
    this.inFlight = new Map(); // taskId -> { task, peerId }
    this.completed = new Set();
    this.onTaskCompleteCallback = null;
    this.onStatsUpdateCallback = null;

    this.transport.onMessage((peerId, message) => this._handleMessage(peerId, message));
    this.transport.onPeerChange((count) => this._handlePeerChange(count));
  }

  _handleMessage(peerId, message) {
    if (message.type === MSG_TYPES.READY || message.type === MSG_TYPES.TASK_COMPLETE) {
      if (message.type === MSG_TYPES.TASK_COMPLETE) {
        this.inFlight.delete(message.taskId);
        this.completed.add(message.taskId);
        if (this.onTaskCompleteCallback) this.onTaskCompleteCallback(message);
      }
      this._dispatchNext(peerId);
    }
  }

  _dispatchNext(peerId) {
    if (this.queue.length > 0) {
      const task = this.queue.shift();
      this.inFlight.set(task.id, { task, peerId });
      this.transport.send(peerId, createMessage(MSG_TYPES.TASK_OFFER, { task }));
    } else {
      this.transport.send(peerId, createMessage(MSG_TYPES.NO_WORK));
    }
    this._notifyStats();
  }

  _handlePeerChange() {
    this._notifyStats();
  }

  _notifyStats() {
    if (this.onStatsUpdateCallback) {
      this.onStatsUpdateCallback({
        remaining: this.queue.length,
        inFlight: this.inFlight.size,
        completed: this.completed.size
      });
    }
  }

  onTaskComplete(cb) { this.onTaskCompleteCallback = cb; }
  onStatsUpdate(cb) { this.onStatsUpdateCallback = cb; }
}