import { GRID_CONFIG } from '../shared/protocol.js';

export class TaskDispatcher {
  constructor(width = GRID_CONFIG.CANVAS_WIDTH, height = GRID_CONFIG.CANVAS_HEIGHT, tileSize = GRID_CONFIG.TILE_SIZE) {
    this.width = width;
    this.height = height;
    this.tileSize = tileSize;
    this.taskQueue = [];
    this.initGrid();
  }

  // Divide the canvas into discrete grid chunks
  initGrid() {
    let taskId = 0;
    for (let y = 0; y < this.height; y += this.tileSize) {
      for (let x = 0; x < this.width; x += this.tileSize) {
        this.taskQueue.push({
          taskId: taskId++,
          startX: x,
          startY: y,
          width: this.tileSize,
          height: this.tileSize,
          maxIter: GRID_CONFIG.MAX_ITERATIONS,
          status: 'pending' // 'pending' | 'assigned' | 'completed'
        });
      }
    }
    console.log(`[Dispatcher] Initialized ${this.taskQueue.length} tile tasks.`);
  }

  // Get the next pending task for a worker
  getNextTask() {
    const task = this.taskQueue.find(t => t.status === 'pending');
    if (task) {
      task.status = 'assigned';
      return task;
    }
    return null; // All tasks are either assigned or completed
  }

  // Mark a task as completed when binary data comes back
  markTaskComplete(taskId) {
    const task = this.taskQueue.find(t => t.taskId === taskId);
    if (task) {
      task.status = 'completed';
    }
  }

  // Check overall job progress percentage
  getProgress() {
    const completed = this.taskQueue.filter(t => t.status === 'completed').length;
    return (completed / this.taskQueue.length) * 100;
  }
}// Basically I implemented a host and worker id system, so this code checks for that.
// 
// js/host/dispatcher.js
// Owns the work queue for the host: generates the chunk grid (Step 1),
// hands chunks to workers (Step 2), and reacts to TASK_COMPLETE / worker
// timeouts (Steps 6-9 in flow.txt).
//
// Uses a dynamic queue, not a static split: whoever finishes first gets
// the next chunk immediately, so fast devices naturally do more work
// without any separate load-balancing logic needed.

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

    this.queue = [];           // chunks not yet offered to anyone
    this.inFlight = new Map(); // chunkId -> { chunk, workerId, offeredAt }
    this.completed = new Set();
    this.startTime = null;

    this.transport.onMessage((fromPeerId, message) => this._handleMessage(fromPeerId, message));

    // If a worker goes silent, whatever it was holding goes back in the queue.
    startHeartbeat(this.transport, (timedOutPeerId) => this._requeuePeer(timedOutPeerId));
  }

  // --- Step 1: build the grid ------------------------------------------
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

  // Random dispatch order so the canvas fills in scattered, not in a
  // boring top-left sweep — purely a demo-visual choice, no functional effect.
  _shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // --- Public entry point ------------------------------------------------
  start() {
    this.queue = this._generateChunks();
    this.startTime = performance.now();
    updateStats(this._currentStats());
  }

  // --- Step 2: offer work to a specific worker ----------------------------
  _dispatchNext(workerPeerId) {
    const chunk = this.queue.shift();
    if (!chunk) return; // nothing left — this worker goes idle

    this.inFlight.set(chunk.id, { chunk, workerId: workerPeerId, offeredAt: Date.now() });
    this.transport.send(workerPeerId, taskOffer(chunk));
  }

  // Call this whenever a new worker peer is detected (see note below on
  // how "worker joined" gets fired).
  onWorkerJoined(workerPeerId) {
    this._dispatchNext(workerPeerId);
  }

  // --- Steps 6-9: react to results -----------------------------------------
  _handleMessage(fromPeerId, message) {
    if (message.type === MESSAGE_TYPES.TASK_COMPLETE) {
      this._onTaskComplete(fromPeerId, message);
    }
    // TASK_ACCEPT is defined in protocol.js but intentionally unhandled here —
    // flow.txt goes straight from TASK_OFFER to TASK_COMPLETE with no accept
    // step. Confirm that's the intended design before this ships.
  }

  _onTaskComplete(workerPeerId, { chunkId, buffer, meta }) {
    const entry = this.inFlight.get(chunkId);
    if (!entry) return; // stale or duplicate message — ignore rather than crash

    this.inFlight.delete(chunkId);
    this.completed.add(chunkId);

    // Step 8: paint it.
    paintChunk(buffer, entry.chunk.startX, entry.chunk.startY);

    // Step 9: refresh the dashboard.
    updateStats(this._currentStats());

    // Immediately hand this worker its next chunk — this re-offer-on-complete
    // pattern IS the load balancing: fast workers naturally pull more chunks.
    this._dispatchNext(workerPeerId);
  }

  // --- Disconnect handling (heartbeat.js calls this) ------------------------
  _requeuePeer(workerPeerId) {
    for (const [chunkId, entry] of this.inFlight.entries()) {
      if (entry.workerId === workerPeerId) {
        this.inFlight.delete(chunkId);
        this.queue.unshift(entry.chunk); // front of queue — retry soon
      }
    }
  }

  _currentStats() {
    const total = this.queue.length + this.inFlight.size + this.completed.size;
    return {
      totalChunks: total,
      completed: this.completed.size,
      inFlight: this.inFlight.size,
      elapsedMs: performance.now() - this.startTime,
      connectedNodes: this.transport.listPeers().length,
    };
  }
}