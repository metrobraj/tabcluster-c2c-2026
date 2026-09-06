import { LocalBus } from '../network/local-bus.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';

// Generate a random peer ID for this worker tab
const workerId = 'worker-' + Math.random().toString(36).substr(2, 5);
const bus = new LocalBus(workerId, 'worker');
const mathWorker = new Worker('js/worker/math-worker.js');

const statusEl = document.getElementById('status');
if (statusEl) statusEl.textContent = 'Connected & Listening';

// 1. Listen for TASK_OFFER messages from the Host
bus.onMessage((fromPeerId, message) => {
  if (message.type === MESSAGE_TYPES.TASK_OFFER) {
    console.log('[Worker] Received task:', message.chunk.id);
    mathWorker.postMessage({ ...message.chunk, hostPeerId: fromPeerId });
  }
});

// 2. Listen for finished calculation from math-worker.js and return it
mathWorker.onmessage = (e) => {
  const { id, buffer, hostPeerId } = e.data;
  console.log('[Worker] Finished task:', id);

  bus.send(hostPeerId, {
    type: MESSAGE_TYPES.TASK_COMPLETE,
    chunkId: id,
    buffer: buffer
  });
};