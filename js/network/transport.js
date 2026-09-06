// js/network/transport.js
// Unified transport facade used by everything above the network layer.
// Tries WebRTC (p2pmesh) first. If PeerJS can't reach its signaling
// server, or the room takes too long to open, this quietly swaps in the
// BroadcastChannel local bus instead - so a demo never just hangs on
// bad venue wifi. Callers never see the difference.

class TCTransport {
  constructor() {
    this.impl = null;
    this.mode = null;
  }

  init({ role, roomCode, onReady, onPeerJoin, onPeerLeave, onMessage, onModeChange }) {
    let settled = false;

    const fallbackTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn('[transport] WebRTC signaling unavailable, falling back to local bus');
      this._startLocalBus({ role, onReady, onPeerJoin, onPeerLeave, onMessage });
      if (onModeChange) onModeChange('local');
    }, TC_CONFIG.WEBRTC_FALLBACK_TIMEOUT_MS);

    const mesh = new TCP2PMesh();
    this.impl = mesh;
    this.mode = 'webrtc';

    mesh.init({
      role,
      roomCode,
      onReady: (id) => {
        if (settled) return;
        settled = true;
        clearTimeout(fallbackTimer);
        if (onReady) onReady(id);
      },
      onPeerJoin,
      onPeerLeave,
      onMessage,
      onError: (err) => {
        console.warn('[transport] PeerJS error', err);
        if (settled) return;
        settled = true;
        clearTimeout(fallbackTimer);
        this._startLocalBus({ role, onReady, onPeerJoin, onPeerLeave, onMessage });
        if (onModeChange) onModeChange('local');
      }
    });
  }

  _startLocalBus({ role, onReady, onPeerJoin, onPeerLeave, onMessage }) {
    const bus = new TCLocalBus();
    this.impl = bus;
    this.mode = 'local';
    bus.init({ role, onReady, onPeerJoin, onPeerLeave, onMessage });
  }

  send(peerId, message) { if (this.impl) this.impl.send(peerId, message); }
  sendToHost(message) { if (this.impl) this.impl.sendToHost(message); }
  broadcast(message) { if (this.impl) this.impl.broadcast(message); }
  destroy() { if (this.impl) this.impl.destroy(); }
  getMode() { return this.mode; }
}

if (typeof window !== 'undefined') window.TCTransport = TCTransport;