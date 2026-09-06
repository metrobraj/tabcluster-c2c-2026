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

// // 1. Listen for TASK_OFFER messages from the Host
// transport.onMessage((fromPeerId, message) => {
//   if (message.type === MESSAGE_TYPES.TASK_OFFER) {
//     console.log('[Worker] Received task:', message.chunk.id);
//     if (statusEl) statusEl.textContent = `Working on ${message.chunk.id}...`;
//     mathWorker.postMessage({ ...message.chunk, hostPeerId: fromPeerId });
//   }
// });



// Helper function to update the status on screen
function setStatus(text) {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

// 2. Initialize your secondary background thread
const mathWorker = new Worker('js/worker/math-worker.js');

// 3. Listen for incoming tasks (from Member 1's bus)
window.addEventListener('message', (event) => {
  if (event.data?.type === MESSAGE_TYPES.TASK_OFFER) {
    setStatus('Computing chunk...');
    const chunk = event.data.payload;
    mathWorker.postMessage(chunk);
  }
});

// 4. Listen for completed results from math-worker.js
mathWorker.onmessage = (event) => {
  const binaryArray = event.data;
  setStatus('Idle (Ready for tasks)');

  // Send back to the network / bus
  window.parent.postMessage({
    type: MESSAGE_TYPES.TASK_COMPLETE,
    payload: binaryArray
  }, '*');
};

// 5. Standalone self-test to verify the loop immediately
 console.log('[WorkerMain] Triggering standalone test chunk...');
setStatus('Computing test chunk...');

mathWorker.postMessage({
  startX: 0,
  startY: 0,
  width: 100,
  height: 100,
  maxIter: 100
});
