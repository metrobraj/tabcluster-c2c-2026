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
}