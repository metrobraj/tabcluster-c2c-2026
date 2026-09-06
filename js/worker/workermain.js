import { createTransport } from '../network/transport.js';
import { resolveRoomId } from '../shared/config.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';

// Generate a random peer ID for this worker tab
const workerId = 'worker-' + Math.random().toString(36).slice(2, 7);

// This MUST come from the URL (?room=<hostPeerId>) for P2P mode to work —
// it's how a worker knows which host to dial. Open worker.html as
// worker.html?room=<the code shown on host.html>, not bare.
const roomId = resolveRoomId();

const transport = createTransport(workerId, 'worker', { roomId });
const mathWorker = new Worker('js/worker/math-worker.js');

const statusEl = document.getElementById('status');
if (statusEl) statusEl.textContent = 'Connecting...';

// 1. Listen for TASK_OFFER messages from the Host
transport.onMessage((fromPeerId, message) => {
  if (message.type === MESSAGE_TYPES.TASK_OFFER) {
    console.log('[Worker] Received task:', message.chunk.id);
    if (statusEl) statusEl.textContent = `Working on ${message.chunk.id}...`;
    mathWorker.postMessage({ ...message.chunk, hostPeerId: fromPeerId });
  }
});

// 2. Listen for finished calculation from math-worker.js and return it
mathWorker.onmessage = (e) => {
  const { id, buffer, hostPeerId } = e.data;
  console.log('[Worker] Finished task:', id);
  if (statusEl) statusEl.textContent = 'Connected & idle';

  transport.send(hostPeerId, {
    type: MESSAGE_TYPES.TASK_COMPLETE,
    chunkId: id,
    buffer: buffer,
  });
};