// js/network/p2pmesh.js
// Real cross-device transport using PeerJS (WebRTC data channels under the
// hood). Exposes the exact same interface as local-bus.js so transport.js
// can swap between them without any other file caring which is active.
//
// Requires PeerJS loaded globally BEFORE this module runs, e.g. in
// host.html and worker.html:
//   <script src="https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js"></script>

import { isValidMessage } from '../shared/protocol.js';

export class P2PMeshTransport {
  constructor(peerId, role, { roomId } = {}) {
    this.peerId = peerId;
    this.role = role;
    this.roomId = roomId; // the host's peer ID — how a worker finds the host
    this.connections = new Map(); // peerId -> PeerJS DataConnection
    this.messageHandlers = [];

    // PeerJS Cloud (the free public broker at peerjs.com) only helps two
    // peers FIND each other and set up the handshake. Once connected, data
    // flows directly device-to-device — the broker isn't in the data path.
    this.peer = new Peer(peerId);

    this.peer.on('open', () => {
      if (this.role === 'host') {
        this.peer.on('connection', (conn) => this._registerConnection(conn));
      } else {
        const conn = this.peer.connect(this.roomId);
        this._registerConnection(conn);
      }
    });

    this.peer.on('error', (err) => {
      console.error('[TabCluster] PeerJS error:', err);
    });
  }

  _registerConnection(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
    });

    conn.on('data', (data) => {
      if (!isValidMessage(data.message)) {
        console.warn('[TabCluster] Dropped malformed message:', data);
        return;
      }
      this.messageHandlers.forEach((handler) => handler(data.from, data.message));
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
    });
  }

  send(toPeerId, message) {
    const conn = this.connections.get(toPeerId);
    if (!conn) {
      console.warn(`[TabCluster] No connection to ${toPeerId}`);
      return;
    }
    conn.send({ from: this.peerId, message });
  }

  broadcast(message) {
    for (const conn of this.connections.values()) {
      conn.send({ from: this.peerId, message });
    }
  }

  onMessage(handler) {
    this.messageHandlers.push(handler);
  }

  listPeers() {
    return [...this.connections.keys()].map((id) => ({ id }));
  }

  close() {
    this.connections.forEach((conn) => conn.close());
    this.peer.destroy();
  }
}