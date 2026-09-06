// js/network/heartbeat.js
// Lightweight liveness check layered on top of any transport. The host
// pings every connected worker on an interval; a worker that goes
// HEARTBEAT_TIMEOUT_MS without a pong is treated as gone, so its
// in-flight chunk can be re-queued even if the transport itself never
// fires a disconnect event.

class TCHeartbeat {
  constructor(transport, { onPeerTimeout } = {}) {
    this.transport = transport;
    this.onPeerTimeout = onPeerTimeout;
    this.lastSeen = new Map(); // peerId -> timestamp
    this._interval = null;
  }

  trackPeer(peerId) { this.lastSeen.set(peerId, Date.now()); }
  forgetPeer(peerId) { this.lastSeen.delete(peerId); }
  markAlive(peerId) { if (this.lastSeen.has(peerId)) this.lastSeen.set(peerId, Date.now()); }

  startHost() {
    this._interval = setInterval(() => {
      const now = Date.now();
      for (const [peerId, seen] of this.lastSeen.entries()) {
        if (now - seen > TC_CONFIG.HEARTBEAT_TIMEOUT_MS) {
          this.lastSeen.delete(peerId);
          if (this.onPeerTimeout) this.onPeerTimeout(peerId);
          continue;
        }
        this.transport.send(peerId, tcMakeMessage(TC_MSG.HEARTBEAT_PING));
      }
    }, TC_CONFIG.HEARTBEAT_INTERVAL_MS);
  }

  // Worker side doesn't need to originate anything; it just replies to
  // pings as they arrive (see workermain.js). Kept for symmetry/future use.
  startWorker() {
    this._interval = setInterval(() => {}, TC_CONFIG.HEARTBEAT_INTERVAL_MS);
  }

  stop() { if (this._interval) clearInterval(this._interval); }
}

if (typeof window !== 'undefined') window.TCHeartbeat = TCHeartbeat;