import { createTransport } from '../network/transport.js';
import { startHeartbeat } from '../network/heartbeat.js';
import { taskOffer, makeChunk, MESSAGE_TYPES } from '../shared/protocol.js';
import { resolveRoomId } from '../shared/config.js';
import { paintChunk } from './canvas.js';
import { updateStats } from './hostui.js';

const IMAGE_WIDTH = 1000;
const IMAGE_HEIGHT = 1000;
const TILE_SIZE = 100;
const MAX_ITER = 200;

export class Dispatcher {
  constructor() {
    this.peerId = crypto.randomUUID().slice(0, 8);
    this.transport = createTransport(this.peerId, 'host', { roomId: resolveRoomId() });

    this.queue = [];
    this.inFlight = new Map();
    this.completed = new Set();
    this.startTime = null;

    // Listen for messages via transport
    this.transport.onMessage((fromPeerId, message) => this._handleMessage(fromPeerId, message));

    // Handle worker disconnects
    startHeartbeat(this.transport, (timedOutPeerId) => this._requeuePeer(timedOutPeerId));
  }

  _generateChunks() {
    const chunks = [];
    let id = 0;
    for (let y = 0; y < IMAGE_HEIGHT; y += TILE_SIZE) {
      for (let x = 0; x < IMAGE_WIDTH; x += TILE_SIZE) {
        chunks.push(makeChunk({
          id: `chunk-${id++}`,
          startX: x,
          startY: y,
          width: Math.min(TILE_SIZE, IMAGE_WIDTH - x),
          height: Math.min(TILE_SIZE, IMAGE_HEIGHT - y),
          maxIter: MAX_ITER,
        }));
      }
    }
    return chunks;
  }

  start() {
    this.queue = this._generateChunks();
    this.startTime = performance.now();
    updateStats(this._currentStats());
    
    // Broadcast initial tasks to any listening workers
    this._dispatchAvailable();
  }

  _dispatchAvailable() {
    const peers = this.transport.listPeers();
    if (peers.length === 0 && this.queue.length > 0) {
      // If peers list hasn't updated yet, broadcast next chunk to '__ALL__'
      const chunk = this.queue.shift();
      if (chunk) {
        this.inFlight.set(chunk.id, { chunk, workerId: 'broadcast', offeredAt: Date.now() });
        this.transport.broadcast(taskOffer(chunk));
      }
      return;
    }

    // Hand work out to known peers
    for (const peer of peers) {
      if (this.queue.length === 0) break;
      const chunk = this.queue.shift();
      this.inFlight.set(chunk.id, { chunk, workerId: peer.id, offeredAt: Date.now() });
      this.transport.send(peer.id, taskOffer(chunk));
    }
  }

  _handleMessage(fromPeerId, message) {
    if (message.type === MESSAGE_TYPES.TASK_COMPLETE) {
      this._onTaskComplete(fromPeerId, message);
    }
  }

  _onTaskComplete(workerPeerId, { chunkId, buffer }) {
    const entry = this.inFlight.get(chunkId);
    if (!entry) return;

    this.inFlight.delete(chunkId);
    this.completed.add(chunkId);

    // Paint completed chunk
    paintChunk(
      buffer, 
      entry.chunk.startX, 
      entry.chunk.startY, 
      entry.chunk.width, 
      entry.chunk.height
    );

    updateStats(this._currentStats());

    // Dispatch next available chunk
    if (this.queue.length > 0) {
      const nextChunk = this.queue.shift();
      this.inFlight.set(nextChunk.id, { chunk: nextChunk, workerId: workerPeerId, offeredAt: Date.now() });
      this.transport.send(workerPeerId, taskOffer(nextChunk));
    }
  }

  _requeuePeer(workerPeerId) {
    for (const [chunkId, entry] of this.inFlight.entries()) {
      if (entry.workerId === workerPeerId) {
        this.inFlight.delete(chunkId);
        this.queue.unshift(entry.chunk);
      }
    }
  }

  _currentStats() {
    const total = this.queue.length + this.inFlight.size + this.completed.size;
    return {
      totalChunks: total,
      completed: this.completed.size,
      inFlight: this.inFlight.size,
      elapsedMs: performance.now() - (this.startTime || performance.now()),
      connectedNodes: this.transport.listPeers().length,
    };
  }
}