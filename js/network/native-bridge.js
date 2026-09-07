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
  }

  init({ relayUrl, role, roomCode, onReady, onPeerJoin, onPeerLeave, onMessage, onError }) {
    this.role = role;
    this.roomCode = roomCode;
    this.onPeerJoin = onPeerJoin;
    this.onPeerLeave = onPeerLeave;
    this.onMessage = onMessage;

    this.ws = new WebSocket(relayUrl);

    this.ws.onopen = () => {
      this._raw({ kind: 'join', role, room: roomCode });
    };

    this.ws.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      this._handle(data, onReady);
    };

    this.ws.onerror = (err) => { if (onError) onError(err); };
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  send(peerId, message) { this._raw({ kind: 'msg', to: peerId, message }); }
  sendToHost(message) { this._raw({ kind: 'msg', to: 'host', message }); }
  broadcast(message) { this._raw({ kind: 'msg', to: 'broadcast', message }); }
  destroy() { if (this.ws) this.ws.close(); }
  getMode() { return 'native'; }
}

if (typeof window !== 'undefined') window.TCNativeBridge = TCNativeBridge;
