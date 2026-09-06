import { createTransport } from '../network/transport.js';
import { startHeartbeat } from '../network/heartbeat.js';
import { taskOffer, makeChunk, MESSAGE_TYPES } from '../shared/protocol.js';
import { resolveRoomId } from '../shared/config.js';
import { paintChunk } from './canvas.js';
import { updateStats } from './hostui.js';

const IMAGE_WIDTH = 1920;
const IMAGE_HEIGHT = 1080;
const TILE_SIZE = 120;
const MAX_ITER = 200;

export class Dispatcher {
  constructor() {
    this.peerId = crypto.randomUUID().slice(0, 8);
    this.transport = createTransport(this.peerId, 'host', { roomId: resolveRoomId() });

    this.queue = [];           // chunks not yet offered
    this.inFlight = new Map(); // chunkId -> { chunk, workerId, offeredAt }
    this.completed = new Set();
    this.startTime = null;

    this.transport.onMessage((fromPeerId, message) => this._handleMessage(fromPeerId, message));

    // Requeue chunks if worker dies/times out
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
    return this._shuffle(chunks);
  }

  _shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  start() {
    this.queue = this._generateChunks();
    this.startTime = performance.now();
    updateStats(this._currentStats());
  }

  _dispatchNext(workerPeerId) {
    const chunk = this.queue.shift();
    if (!chunk) return;

    this.inFlight.set(chunk.id, { chunk, workerId: workerPeerId, offeredAt: Date.now() });
    this.transport.send(workerPeerId, taskOffer(chunk));
  }

  onWorkerJoined(workerPeerId) {
    this._dispatchNext(workerPeerId);
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

    // Pass canvas coordinates along with width & height
    paintChunk(
      buffer, 
      entry.chunk.startX, 
      entry.chunk.startY, 
      entry.chunk.width, 
      entry.chunk.height
    );

    updateStats(this._currentStats());
    this._dispatchNext(workerPeerId);
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