// js/network/local-bus.js
// Local-only transport for Phase 1 (and your live fallback in Phase 5).
// Simulates "network" behavior using BroadcastChannel — same-machine only.
// Matches the same interface p2pmesh.js exposes (send, broadcast, onMessage,
// listPeers) so transport.js can swap between them with zero other changes.

import { isValidMessage } from '../shared/protocol.js';

const CHANNEL_NAME = 'tabcluster';

export class LocalBus {
  constructor(peerId, role) {
    this.peerId = peerId; // unique id for this tab
    this.role = role;     // 'host' or 'worker'
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.messageHandlers = [];
    this.peers = new Map(); // peerId -> { role, lastSeen }

    this.channel.onmessage = (event) => this._handleIncoming(event.data);
    this._announcePresence();
  }

  _announcePresence() {
    this.channel.postMessage({ type: '__PRESENCE__', peerId: this.peerId, role: this.role });
  }

  _handleIncoming(data) {
    if (data.type === '__PRESENCE__') {
      if (data.peerId !== this.peerId) {
        this.peers.set(data.peerId, { role: data.role, lastSeen: Date.now() });
      }
      return;
    }

    if (!isValidMessage(data.message)) {
      console.warn('[TabCluster] Dropped malformed message:', data);
      return;
    }

    if (data.to === this.peerId || data.to === '__ALL__') {
      this.messageHandlers.forEach((handler) => handler(data.from, data.message));
    }
  }

  send(toPeerId, message) {
    this.channel.postMessage({ from: this.peerId, to: toPeerId, message });
  }

  broadcast(message) {
    this.channel.postMessage({ from: this.peerId, to: '__ALL__', message });
  }

  onMessage(handler) {
    this.messageHandlers.push(handler);
  }

  listPeers() {
    return [...this.peers.entries()].map(([id, info]) => ({ id, ...info }));
  }

  close() {
    this.channel.close();
  }
}