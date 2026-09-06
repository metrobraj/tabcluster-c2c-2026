// js/network/local-bus.js
// Zero-network fallback transport built on BroadcastChannel, so tabCluster
// can still run a demo across multiple tabs on ONE machine even when
// WebRTC/UDP is blocked (e.g. AP-isolated venue wifi) or there's no
// internet at all for the PeerJS signaling server.
//
// Same event shape as p2pmesh.js so transport.js can swap between them
// without the rest of the app knowing which one is active.

class TCLocalBus {
  constructor() {
    this.channel = null;
    this.selfId = null;
    this.role = null;
    this.peers = new Set();
    this.onMessage = null;
    this.onPeerJoin = null;
    this.onPeerLeave = null;
  }

  init({ role, onReady, onPeerJoin, onPeerLeave, onMessage }) {
    this.role = role;
    this.selfId = `${role}-${Math.random().toString(36).slice(2, 8)}`;
    this.onPeerJoin = onPeerJoin;
    this.onPeerLeave = onPeerLeave;
    this.onMessage = onMessage;

    this.channel = new BroadcastChannel(TC_CONFIG.LOCAL_BUS_CHANNEL);
    this.channel.onmessage = (ev) => this._handle(ev.data);

    // Announce ourselves so any tab already open learns about us, and
    // vice versa via the announce-ack reply below.
    this._raw({ kind: 'announce', from: this.selfId, role: this.role });

    if (onReady) onReady(this.selfId);
    return this.selfId;
  }

  _handle(data) {
    if (!data || data.from === this.selfId) return;

    if (data.kind === 'announce') {
      if (!this.peers.has(data.from)) {
        this.peers.add(data.from);
        if (this.onPeerJoin) this.onPeerJoin(data.from);
      }
      this._raw({ kind: 'announce-ack', from: this.selfId, to: data.from });
      return;
    }

    if (data.kind === 'announce-ack') {
      if (data.to === this.selfId && !this.peers.has(data.from)) {
        this.peers.add(data.from);
        if (this.onPeerJoin) this.onPeerJoin(data.from);
      }
      return;
    }

    if (data.kind === 'bye') {
      if (this.peers.has(data.from)) {
        this.peers.delete(data.from);
        if (this.onPeerLeave) this.onPeerLeave(data.from);
      }
      return;
    }

    if (data.kind === 'msg' && (data.to === this.selfId || data.to === 'broadcast')) {
      if (this.onMessage) this.onMessage(data.from, data.message);
    }
  }

  _raw(obj) {
    this.channel.postMessage(obj);
  }

  send(peerId, message) {
    this._raw({ kind: 'msg', from: this.selfId, to: peerId, message });
  }

  sendToHost(message) {
    // Exactly one host exists in local mode; broadcast and let it filter,
    // since a worker may not know the host's generated id up front.
    this._raw({ kind: 'msg', from: this.selfId, to: 'broadcast', message });
  }

  broadcast(message) {
    this._raw({ kind: 'msg', from: this.selfId, to: 'broadcast', message });
  }

  destroy() {
    if (this.channel) {
      this._raw({ kind: 'bye', from: this.selfId });
      this.channel.close();
    }
  }

  getMode() { return 'local'; }
}

if (typeof window !== 'undefined') window.TCLocalBus = TCLocalBus;