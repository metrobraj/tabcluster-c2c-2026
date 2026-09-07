// js/network/multi-transport.js
// TCDispatcher only ever calls transport.send(peerId, msg) /
// transport.broadcast(msg) - it has no idea whether a peer is a browser
// tab (WebRTC/local-bus, via TCTransport) or a native process (via
// TCNativeBridge). This wraps both and routes each send() to whichever
// one actually owns that peerId, so the dispatcher, heartbeat, and
// plugin system all work completely unchanged with a mixed cluster.

class TCMultiTransport {
  constructor(primary) {
    this.primary = primary; // TCTransport instance (webrtc/local)
    this.native = null;     // TCNativeBridge instance, attached later if enabled
    this.peerOwner = new Map(); // peerId -> 'primary' | 'native'
  }

  attachNative(bridge) { this.native = bridge; }

  registerPeer(peerId, owner) { this.peerOwner.set(peerId, owner); }
  unregisterPeer(peerId) { this.peerOwner.delete(peerId); }

  send(peerId, message) {
    const owner = this.peerOwner.get(peerId);
    if (owner === 'native' && this.native) this.native.send(peerId, message);
    else this.primary.send(peerId, message);
  }

  sendToHost(message) { this.primary.sendToHost(message); }

  broadcast(message) {
    this.primary.broadcast(message);
    if (this.native) this.native.broadcast(message);
  }

  destroy() {
    this.primary.destroy();
    if (this.native) this.native.destroy();
  }

  getMode() { return this.native ? 'mixed (browser + native)' : this.primary.getMode(); }
}

if (typeof window !== 'undefined') window.TCMultiTransport = TCMultiTransport;
