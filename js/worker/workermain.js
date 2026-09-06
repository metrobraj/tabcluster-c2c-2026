// js/worker/workermain.js
import { LocalBus } from '../network/local-bus.js';

const bus = new LocalBus('worker');
const mathWorker = new Worker('js/worker/math-worker.js');

// 1. Listen for tasks coming from the Host over BroadcastChannel
bus.onTaskReceived((task) => {
  console.log('[Worker] Received task:', task.taskId);
  // Pass task parameters into the Web Worker
  mathWorker.postMessage(task);
});

// 2. Listen for finished calculation from math-worker.js
mathWorker.onmessage = (e) => {
  const { taskId, buffer } = e.data;
  console.log('[Worker] Finished task:', taskId);
  // Send completed binary buffer back over BroadcastChannel to Host
  bus.sendTaskComplete(taskId, buffer);
};