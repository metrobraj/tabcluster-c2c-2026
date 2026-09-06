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
    // If we are host, our actual peer ID MUST be the roomId so workers can connect to us
    this.peerId = role === 'host' ? roomId : peerId;
    this.role = role;
    this.roomId = roomId; 
    this.connections = new Map(); 
    this.messageHandlers = [];

    // Initialize PeerJS with the correct ID
    this.peer = new Peer(this.peerId);

    this.peer.on('open', (id) => {
      console.log(`[P2P] PeerJS ready as ${this.role} with ID: ${id}`);
      if (this.role === 'worker') {
        console.log(`[P2P] Connecting worker to host room: ${this.roomId}`);
        const conn = this.peer.connect(this.roomId);
        this._registerConnection(conn);
      }
    });

    if (this.role === 'host') {
      this.peer.on('connection', (conn) => {
        console.log(`[P2P] Incoming connection from worker: ${conn.peer}`);
        this._registerConnection(conn);
      });
    }

    this.peer.on('error', (err) => {
      console.error('[TabCluster] PeerJS error:', err);
    });
  }

  _registerConnection(conn) {
    conn.on('open', () => {
      console.log(`[P2P] Connection opened with ${conn.peer}`);
      this.connections.set(conn.peer, conn);
      
      // Notify handlers immediately so dispatcher fires work right away
      this.messageHandlers.forEach((handler) => 
        handler(conn.peer, { type: 'PEER_CONNECTED', peerId: conn.peer })
      );
    });

    conn.on('data', (data) => {
      if (!isValidMessage(data.message)) {
        console.warn('[TabCluster] Dropped malformed message:', data);
        return;
      }
      this.messageHandlers.forEach((handler) => handler(data.from, data.message));
    });

    conn.on('close', () => {
      console.log(`[P2P] Connection closed with ${conn.peer}`);
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