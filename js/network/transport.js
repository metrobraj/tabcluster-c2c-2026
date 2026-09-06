import { P2PMesh } from './p2pmesh.js';
import { CONFIG } from '../shared/config.js';

export class Transport {
  constructor(isHost = false, roomId = null) {
    if (CONFIG.TRANSPORT_MODE === 'p2p') {
      this.engine = new P2PMesh(isHost, roomId);
    } else {
      throw new Error('Local BroadcastChannel mode deprecated for cross-device build');
    }
  }

  init(onReady) { this.engine.init(onReady); }
  connectToHost(roomId, onConnected) { this.engine.connectToHost(roomId, onConnected); }
  send(peerId, message) { this.engine.send(peerId, message); }
  onMessage(cb) { this.engine.onMessage(cb); }
  onPeerChange(cb) { this.engine.onPeerChange(cb); }
}