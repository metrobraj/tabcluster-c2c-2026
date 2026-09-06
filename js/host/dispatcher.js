// js/host/dispatcher.js
// Pull-based task scheduler. Workers ask for work (TASK_REQUEST); the
// dispatcher hands out the next queued chunk and remembers who holds it.
// A chunk that isn't returned within TASK_TIMEOUT_MS, or whose owner
// disconnects, goes back on the front of the queue for the next free
// worker - this is the "detect peer-disconnects mid-task and re-queue"
// behavior from the project brief.

class TCDispatcher {
  constructor(transport, { canvasPainter, onTelemetry, onJobDone, onMonteCarloUpdate }) {
    this.transport = transport;
    this.canvasPainter = canvasPainter;
    this.onTelemetry = onTelemetry;
    this.onJobDone = onJobDone;
    this.onMonteCarloUpdate = onMonteCarloUpdate;

    this.queue = [];
    this.inFlight = new Map(); // taskId -> { peerId, task, timer }
    this.completed = 0;
    this.total = 0;
    this.currentJob = null; // TC_JOB.MANDELBROT | TC_JOB.MONTE_CARLO
    this.monteCarlo = { insideCount: 0, totalSamples: 0 };
    this.workers = new Set();
    this._taskCounter = 0;
  }

  addWorker(peerId) {
    this.workers.add(peerId);
    this._emitTelemetry();
    this._drainQueueToIdleWorkers();
  }

  removeWorker(peerId) {
    this.workers.delete(peerId);
    for (const [taskId, entry] of this.inFlight.entries()) {
      if (entry.peerId === peerId) {
        clearTimeout(entry.timer);
        this.queue.unshift(entry.task);
        this.inFlight.delete(taskId);
      }
    }
    this._emitTelemetry();
  }

  startMandelbrotJob() {
    this.currentJob = TC_JOB.MANDELBROT;
    this.completed = 0;
    this.queue = [];
    this.inFlight.clear();

    const { CANVAS_WIDTH, CANVAS_HEIGHT, TILE_SIZE, MAX_ITER, MANDELBROT_VIEWPORT } = TC_CONFIG;
    for (let y = 0; y < CANVAS_HEIGHT; y += TILE_SIZE) {
      for (let x = 0; x < CANVAS_WIDTH; x += TILE_SIZE) {
        const width = Math.min(TILE_SIZE, CANVAS_WIDTH - x);
        const height = Math.min(TILE_SIZE, CANVAS_HEIGHT - y);
        this.queue.push({
          id: `mb-${this._taskCounter++}`,
          jobType: TC_JOB.MANDELBROT,
          x, y, width, height,
          canvasWidth: CANVAS_WIDTH, canvasHeight: CANVAS_HEIGHT,
          maxIter: MAX_ITER, viewport: MANDELBROT_VIEWPORT
        });
      }
    }
    this.total = this.queue.length;
    if (this.canvasPainter) this.canvasPainter.clear();
    this._emitTelemetry();
    this._drainQueueToIdleWorkers();
  }

  startMonteCarloJob() {
    this.currentJob = TC_JOB.MONTE_CARLO;
    this.completed = 0;
    this.queue = [];
    this.inFlight.clear();
    this.monteCarlo = { insideCount: 0, totalSamples: 0 };

    const { MONTE_CARLO_TOTAL_SAMPLES, MONTE_CARLO_CHUNK_SAMPLES } = TC_CONFIG;
    let remaining = MONTE_CARLO_TOTAL_SAMPLES;
    while (remaining > 0) {
      const samples = Math.min(MONTE_CARLO_CHUNK_SAMPLES, remaining);
      this.queue.push({
        id: `mc-${this._taskCounter++}`,
        jobType: TC_JOB.MONTE_CARLO,
        samples,
        seed: Math.floor(Math.random() * 2 ** 31)
      });
      remaining -= samples;
    }
    this.total = this.queue.length;
    this._emitTelemetry();
    this._drainQueueToIdleWorkers();
  }

  // A worker is asking for work - either just joined, or just finished a chunk.
  handleTaskRequest(peerId) {
    const task = this.queue.shift();
    if (!task) {
      this.transport.send(peerId, tcMakeMessage(TC_MSG.NO_WORK));
      return;
    }
    const timer = setTimeout(() => this._handleTimeout(task.id), TC_CONFIG.TASK_TIMEOUT_MS);
    this.inFlight.set(task.id, { peerId, task, timer });
    this.transport.send(peerId, tcMakeMessage(TC_MSG.TASK_ASSIGN, task));
  }

  handleTaskResult(peerId, payload) {
    const entry = this.inFlight.get(payload.id);
    if (!entry || entry.peerId !== peerId) return; // stale/duplicate result, ignore
    clearTimeout(entry.timer);
    this.inFlight.delete(payload.id);
    this.completed++;

    if (payload.jobType === TC_JOB.MANDELBROT && this.canvasPainter) {
      this.canvasPainter.paintTile(entry.task, payload.pixels);
    } else if (payload.jobType === TC_JOB.MONTE_CARLO) {
      this.monteCarlo.insideCount += payload.insideCount;
      this.monteCarlo.totalSamples += payload.samples;
      if (this.onMonteCarloUpdate) {
        const piEstimate = 4 * this.monteCarlo.insideCount / this.monteCarlo.totalSamples;
        this.onMonteCarloUpdate({ piEstimate, ...this.monteCarlo });
      }
    }

    this._emitTelemetry();

    if (this.completed >= this.total) {
      if (this.onJobDone) this.onJobDone(this.currentJob);
      this.currentJob = null;
    } else {
      this.handleTaskRequest(peerId); // keep this worker busy immediately
    }
  }

  _handleTimeout(taskId) {
    const entry = this.inFlight.get(taskId);
    if (!entry) return;
    this.inFlight.delete(taskId);
    this.queue.unshift(entry.task);
    this._emitTelemetry();
    this._drainQueueToIdleWorkers();
  }

  _drainQueueToIdleWorkers() {
    const busy = new Set([...this.inFlight.values()].map((e) => e.peerId));
    for (const peerId of this.workers) {
      if (!busy.has(peerId) && this.queue.length > 0) {
        this.handleTaskRequest(peerId);
      }
    }
  }

  _emitTelemetry() {
    if (!this.onTelemetry) return;
    this.onTelemetry({
      activeWorkers: this.workers.size,
      queued: this.queue.length,
      inFlight: this.inFlight.size,
      completed: this.completed,
      total: this.total,
      job: this.currentJob
    });
  }
}

if (typeof window !== 'undefined') window.TCDispatcher = TCDispatcher;