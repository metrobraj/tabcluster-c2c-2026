// js/network/native-bridge.js
// Lets the host accept workers that AREN'T browser tabs - a Python
// process with real hardware access, in this case - by talking to them
// through relay-server/server.js instead of WebRTC (which native
// processes can't easily join without heavy extra dependencies). Same
// event shape as p2pmesh.js/local-bus.js, so it plugs into the same
// TCDispatcher/TCHeartbeat without either needing to change.

class TCNativeBridge {
  constructor() {
    this.ws = null;
    this.selfId = null;
    this.role = null;
    this.roomCode = null;
    this.peers = new Set();
    this.onMessage = null;
    this.onPeerJoin = null;
    this.onPeerLeave = null;
    this.onReady = null;
    this.onError = null;
    this.onClose = null;
    this.relayUrl = null;
    this._reconnectTimer = null;
    this._destroyed = false;
  }

  init({ relayUrl, role, roomCode, onReady, onPeerJoin, onPeerLeave, onMessage, onError, onClose }) {
    this.relayUrl = relayUrl;
    this.role = role;
    this.roomCode = roomCode;
    this.onReady = onReady;
    this.onPeerJoin = onPeerJoin;
    this.onPeerLeave = onPeerLeave;
    this.onMessage = onMessage;
    this.onError = onError;
    this.onClose = onClose;
    this._destroyed = false;

    this._connect();
  }

  _connect() {
    const ws = new WebSocket(this.relayUrl);
    this.ws = ws;

    ws.onopen = () => {
      // Ignore an old socket that finishes connecting after a reconnect.
      if (this.ws !== ws || this._destroyed) return;
      this._raw({ kind: 'join', role: this.role, room: this.roomCode });
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws || this._destroyed) return;
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      this._handle(data, this.onReady);
    };

    ws.onerror = (err) => { if (this.onError) this.onError(err); };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.selfId = null;
      this._removeAllPeers();
      if (this.onClose) this.onClose(event);
      if (!this._destroyed) this._scheduleReconnect();
    };
  }

  _removeAllPeers() {
    for (const peerId of this.peers) {
      if (this.onPeerLeave) this.onPeerLeave(peerId);
    }
    this.peers.clear();
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._destroyed) this._connect();
    }, 1000);
  }

  _handle(data, onReady) {
    switch (data.kind) {
      case 'joined':
        this.selfId = data.peerId;
        if (onReady) onReady(this.selfId);
        break;
      case 'peer-join':
        if (!this.peers.has(data.peerId)) {
          this.peers.add(data.peerId);
          if (this.onPeerJoin) this.onPeerJoin(data.peerId);
        }
        break;
      case 'peer-leave':
        if (this.peers.has(data.peerId)) {
          this.peers.delete(data.peerId);
          if (this.onPeerLeave) this.onPeerLeave(data.peerId);
        }
        break;
      case 'msg':
        if (this.onMessage) this.onMessage(data.from, data.message);
        break;
      default:
        break;
    }
  }

  _raw(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    console.warn('[native bridge] Cannot send: relay WebSocket is not open.');
    return false;
  }

  send(peerId, message) { this._raw({ kind: 'msg', to: peerId, message }); }
  sendToHost(message) { this._raw({ kind: 'msg', to: 'host', message }); }
  broadcast(message) { this._raw({ kind: 'msg', to: 'broadcast', message }); }
  destroy() {
    this._destroyed = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    if (this.ws) this.ws.close();
    this.ws = null;
    this.selfId = null;
    this._removeAllPeers();
  }
  getMode() { return 'native'; }
}

if (typeof window !== 'undefined') window.TCNativeBridge = TCNativeBridge;
