import { Transport } from '../network/transport.js';
import { MSG_TYPES, createMessage } from '../shared/protocol.js';

const params = new URLSearchParams(window.location.search);
const targetRoom = params.get('room');
const statusEl = document.getElementById('status');

if (!targetRoom) {
  statusEl.textContent = 'Error: Missing ?room= parameter in URL';
} else {
  const transport = new Transport(false);
  const mathWorker = new Worker('./js/worker/math-worker.js');

  transport.init(() => {
    statusEl.textContent = `Connecting to Host Room: ${targetRoom}...`;
    transport.connectToHost(targetRoom, () => {
      statusEl.textContent = 'Connected & Active';
      transport.send(targetRoom, createMessage(MSG_TYPES.READY));
    });
  });

  transport.onMessage((hostId, data) => {
    if (data.type === MSG_TYPES.TASK_OFFER) {
      statusEl.textContent = `Computing task: ${data.task.id}`;
      mathWorker.postMessage(data.task);
    } else if (data.type === MSG_TYPES.NO_WORK) {
      statusEl.textContent = 'Idle (All tasks completed)';
    }
  });

  mathWorker.onmessage = function (e) {
    const result = e.data;
    transport.send(targetRoom, createMessage(MSG_TYPES.TASK_COMPLETE, {
      taskId: result.taskId,
      startX: result.startX,
      startY: result.startY,
      width: result.width,
      height: result.height,
      buffer: result.buffer
    }));
  };
}