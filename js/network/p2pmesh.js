export class P2PMesh {
  constructor(isHost = false, roomId = null) {
    this.isHost = isHost;
    this.roomId = roomId || 'tc-' + Math.random().toString(36).substring(2, 8);
    this.peer = null;
    this.connections = new Map();
    this.onMessageCallback = null;
    this.onPeerChangeCallback = null;
  }

  init(onReady) {
    this.peer = new Peer(this.isHost ? this.roomId : undefined, {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  });

    this.peer.on('open', (id) => {
      if (!this.isHost) this.roomId = id;
      onReady(this.roomId);
    });

    if (this.isHost) {
      this.peer.on('connection', (conn) => this._setupConnection(conn));
    }
  }

  connectToHost(hostRoomId, onConnected) {
    const conn = this.peer.connect(hostRoomId);
    this._setupConnection(conn, onConnected);
  }

  _setupConnection(conn, onConnected = null) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      if (this.onPeerChangeCallback) this.onPeerChangeCallback(this.connections.size);
      if (onConnected) onConnected();
    });

    conn.on('data', (data) => {
      if (this.onMessageCallback) this.onMessageCallback(conn.peer, data);
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      if (this.onPeerChangeCallback) this.onPeerChangeCallback(this.connections.size);
    });

    conn.on('error', (err) => {
      console.error('[P2PMesh] Connection error:', err);
      this.connections.delete(conn.peer);
      if (this.onPeerChangeCallback) this.onPeerChangeCallback(this.connections.size);
    });
  }

  send(peerId, message) {
    const conn = this.connections.get(peerId);
    if (conn && conn.open) conn.send(message);
  }

  onMessage(cb) { this.onMessageCallback = cb; }
  onPeerChange(cb) { this.onPeerChangeCallback = cb; }
}