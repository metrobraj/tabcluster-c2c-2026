// js/host/hostui.js
import { Transport } from '../network/transport.js';
import { Dispatcher } from './dispatcher.js';
import { CanvasManager } from './canvas.js';
import { CONFIG } from '../shared/config.js';

const canvasMgr = new CanvasManager('renderCanvas');
const transport = new Transport(true);

// 1. Task Generator for Mandelbrot
export function getMandelbrotTasks() {
  const tasks = [];
  let id = 0;
  for (let y = 0; y < CONFIG.CANVAS_HEIGHT; y += CONFIG.TILE_SIZE) {
    for (let x = 0; x < CONFIG.CANVAS_WIDTH; x += CONFIG.TILE_SIZE) {
      tasks.push({
        type: 'MANDELBROT',
        id: `mb-${id++}`,
        startX: x,
        startY: y,
        width: CONFIG.TILE_SIZE,
        height: CONFIG.TILE_SIZE,
        maxIter: CONFIG.MAX_ITERATIONS
      });
    }
  }
  return tasks;
}

// 2. Task Generator for Monte Carlo
export function getMonteCarloTasks() {
  const tasks = [];
  for (let i = 0; i < 50; i++) {
    tasks.push({ 
      type: 'MONTE_CARLO', 
      id: `mc-${i}`, 
      samples: 1000000 
    });
  }
  return tasks;
}

// --- INITIALIZATION ---
// Pass getMandelbrotTasks() or getMonteCarloTasks() depending on which demo you want to run!
const currentTasks = getMandelbrotTasks(); 
const dispatcher = new Dispatcher(transport, currentTasks);

// Monte Carlo state accumulators
let mcTotalPoints = 0;
let mcTotalInside = 0;

transport.init((roomId) => {
  document.getElementById('roomIdDisplay').textContent = roomId;
});

transport.onPeerChange((count) => {
  document.getElementById('workerCount').textContent = count;
});

dispatcher.onStatsUpdate((stats) => {
  document.getElementById('statsDisplay').textContent = 
    `Remaining: ${stats.remaining} | In-Flight: ${stats.inFlight} | Completed: ${stats.completed}`;
});

// Handle incoming results from workers based on task type
dispatcher.onTaskComplete((data) => {
  if (data.type === 'MANDELBROT') {
    canvasMgr.drawTile(data.startX, data.startY, data.width, data.height, data.buffer);
  } else if (data.type === 'MONTE_CARLO') {
    mcTotalPoints += data.samples;
    mcTotalInside += data.insideCount;
    const piEstimate = (4 * mcTotalInside) / mcTotalPoints;
    console.log(`[Monte Carlo] Samples: ${mcTotalPoints.toLocaleString()} | Pi Estimate: ${piEstimate.toFixed(6)}`);
  }
});