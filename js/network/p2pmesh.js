// js/network/p2pmesh.js
// Real device-to-device transport built on PeerJS (WebRTC DataChannels).
// PeerJS's cloud server is only used for the initial handshake (signaling);
// once a DataConnection reports 'open', bytes flow directly between the
// two browsers with zero backend involvement.
//
// Host: opens a Peer whose id IS the room code, so workers can dial it
// directly. Worker: opens an anonymous Peer, then calls peer.connect()
// on the room's id.

class TCP2PMesh {
  constructor() {
    this.peer = null;
    this.role = null;
    this.selfId = null;
    this.connections = new Map(); // peerId -> DataConnection
    this.onMessage = null;
    this.onPeerJoin = null;
    this.onPeerLeave = null;
  }

  init({ role, roomCode, onReady, onPeerJoin, onPeerLeave, onMessage, onError }) {
    this.role = role;
    this.onPeerJoin = onPeerJoin;
    this.onPeerLeave = onPeerLeave;
    this.onMessage = onMessage;

    const peerId = role === 'host' ? (TC_CONFIG.ROOM_PREFIX + roomCode) : undefined;
    this.peer = new Peer(peerId, TC_CONFIG.PEER_OPTIONS);

    this.peer.on('open', (id) => {
      this.selfId = id;
      if (role === 'worker' && roomCode) {
        this._connectToHost(TC_CONFIG.ROOM_PREFIX + roomCode);
      }
      if (onReady) onReady(id);
    });

    this.peer.on('connection', (conn) => this._wire(conn));
    this.peer.on('error', (err) => { if (onError) onError(err); });

    return this.peer;
  }

  _connectToHost(hostId) {
    const conn = this.peer.connect(hostId, { reliable: true });
    this._wire(conn);
  }

  _wire(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      if (this.onPeerJoin) this.onPeerJoin(conn.peer);
    });
    conn.on('data', (data) => {
      if (this.onMessage) this.onMessage(conn.peer, data);
    });
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      if (this.onPeerLeave) this.onPeerLeave(conn.peer);
    });
    conn.on('error', () => {
      this.connections.delete(conn.peer);
      if (this.onPeerLeave) this.onPeerLeave(conn.peer);
    });
  }

  send(peerId, message) {
    const conn = this.connections.get(peerId);
    if (conn && conn.open) conn.send(message);
  }

  sendToHost(message) {
    // A worker holds exactly one connection: the host.
    for (const conn of this.connections.values()) {
      if (conn.open) conn.send(message);
    }
  }

  broadcast(message) {
    for (const conn of this.connections.values()) {
      if (conn.open) conn.send(message);
    }
  }

  destroy() {
    if (this.peer) this.peer.destroy();
  }

  getMode() { return 'webrtc'; }
}

if (typeof window !== 'undefined') window.TCP2PMesh = TCP2PMesh;