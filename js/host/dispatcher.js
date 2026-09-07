// js/host/dispatcher.js
// Pull-based task scheduler. Workers ask for work (TASK_REQUEST); the
// dispatcher hands out the next queued chunk and remembers who holds it.
// A chunk that isn't returned within TASK_TIMEOUT_MS, or whose owner
// disconnects, goes back on the front of the queue for the next free
// worker.
//
// startJob() is the generic entry point every job goes through: give it
// a plugin id (one of the Big 5 splitters in plugins.js), the splitter's
// params, and a per-task function as SOURCE TEXT, and it builds the
// queue and ships the function out to every worker via JOB_INIT before
// dispatching any tasks. startMandelbrotJob()/startMonteCarloJob() are
// now just two callers of startJob() with a built-in function source -
// proof the plugin system covers what used to be hardcoded here.

class TCDispatcher {
  constructor(transport, { canvasPainter, onTelemetry, onJobDone, onMonteCarloUpdate, onAccumulate, onResultsUpdate }) {
    this.transport = transport;
    this.canvasPainter = canvasPainter;
    this.onTelemetry = onTelemetry;
    this.onJobDone = onJobDone;
    this.onMonteCarloUpdate = onMonteCarloUpdate; // kept for the built-in pi demo UI
    this.onAccumulate = onAccumulate;
    this.onResultsUpdate = onResultsUpdate;

    this.queue = [];
    this.inFlight = new Map(); // taskId -> { peerId, task, timer }
    this.completed = 0;
    this.total = 0;
    this.currentJob = null;       // plugin id, e.g. 'frame2d3d'
    this.currentFnSource = null;  // the compiled-per-worker function's source text
    this.resultType = null;       // 'canvas-tile' | 'accumulate' | 'collect'
    this.accumulated = {};
    this.results = [];
    this.workers = new Set();
    this.nativeWorkers = new Set();
    this.nativeOnly = false;
    this.taskTimeoutMs = TC_CONFIG.TASK_TIMEOUT_MS;
    this._taskCounter = 0;
  }

  addWorker(peerId, { native = false } = {}) {
    this.workers.add(peerId);
    if (native) this.nativeWorkers.add(peerId);
    // A worker joining mid-job needs the function before it can be handed
    // any task - send it the same JOB_INIT the other workers already got.
    if (this.currentJob && this.currentFnSource) {
      this.transport.send(peerId, tcMakeMessage(TC_MSG.JOB_INIT, {
        pluginId: this.currentJob, fnSource: this.currentFnSource, pyFnSource: this.currentPyFnSource, resultType: this.resultType
      }));
    }
    this._emitTelemetry();
    this._drainQueueToIdleWorkers();
  }

  removeWorker(peerId) {
    this.workers.delete(peerId);
    this.nativeWorkers.delete(peerId);
    for (const [taskId, entry] of this.inFlight.entries()) {
      if (entry.peerId === peerId) {
        clearTimeout(entry.timer);
        this.queue.unshift(entry.task);
        this.inFlight.delete(taskId);
      }
    }
    this._emitTelemetry();
  }

  // Generic job entry point - every workload template goes through this.
  //   pluginId:       key into TC_PLUGINS (one of the Big 5 splitters)
  //   splitterParams: params object passed straight to that plugin's split()
  //   fnSource:       JS source text of `function(task) { ...; return result; }` (browser workers)
  //   pyFnSource:     Python source text defining `def run(task): ...` (native workers)
  //   resultType:     overrides the plugin's defaultResultType if given
  startJob({ pluginId, splitterParams, fnSource, pyFnSource, resultType, nativeOnly = false, taskTimeoutMs }) {
    const plugin = TC_PLUGINS[pluginId];
    if (!plugin) throw new Error(`Unknown plugin: ${pluginId}`);

    this.currentJob = pluginId;
    this.currentFnSource = fnSource;
    this.currentPyFnSource = pyFnSource || null;
    this.resultType = resultType || plugin.defaultResultType;
    this.nativeOnly = nativeOnly;
    this.taskTimeoutMs = taskTimeoutMs || TC_CONFIG.TASK_TIMEOUT_MS;
    this.completed = 0;
    this.accumulated = {};
    this.results = [];
    this.inFlight.clear();

    this.queue = plugin.split(splitterParams).map((t) => ({
      id: `${pluginId}-${this._taskCounter++}`,
      jobType: pluginId,
      ...t
    }));
    this.total = this.queue.length;

    if (this.resultType === 'canvas-tile' && this.canvasPainter) this.canvasPainter.clear();

    for (const peerId of this.workers) {
      this.transport.send(peerId, tcMakeMessage(TC_MSG.JOB_INIT, {
        pluginId, fnSource, pyFnSource, resultType: this.resultType
      }));
    }

    this._emitTelemetry();
    this._drainQueueToIdleWorkers();
  }

  // --- Built-in demo jobs: thin wrappers over startJob() ---
  startMandelbrotJob() {
    const { CANVAS_WIDTH, CANVAS_HEIGHT, TILE_SIZE, MAX_ITER, MANDELBROT_VIEWPORT } = TC_CONFIG;
    this.startJob({
      pluginId: 'frame2d3d',
      splitterParams: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, tileSize: TILE_SIZE },
      resultType: 'canvas-tile',
      fnSource: TC_BUILTIN_FNS.mandelbrot(MAX_ITER, MANDELBROT_VIEWPORT),
      pyFnSource: TC_BUILTIN_FNS.mandelbrotPy(MAX_ITER, MANDELBROT_VIEWPORT)
    });
  }

  startMonteCarloJob() {
    const { MONTE_CARLO_TOTAL_SAMPLES, MONTE_CARLO_CHUNK_SAMPLES } = TC_CONFIG;
    this.startJob({
      pluginId: 'miniBatch',
      splitterParams: { datasetSize: MONTE_CARLO_TOTAL_SAMPLES, batchSize: MONTE_CARLO_CHUNK_SAMPLES },
      resultType: 'accumulate',
      fnSource: TC_BUILTIN_FNS.monteCarlo(),
      pyFnSource: TC_BUILTIN_FNS.monteCarloPy()
    });
  }

  // A worker is asking for work - either just joined, or just finished a chunk.
  handleTaskRequest(peerId) {
    // The dispatcher eagerly assigns the next chunk after a result, while
    // workers also send TASK_REQUEST after reporting that result. WebSocket
    // delivery makes both messages legitimate, but a worker may only own one
    // chunk at a time. Without this guard, the second request consumes another
    // task and creates an ever-growing backlog of assignments for that worker.
    if ([...this.inFlight.values()].some((entry) => entry.peerId === peerId)) return;

    // Blender and other OS-only workloads must never be handed to a browser
    // tab. Browser workers remain connected, but are told there is no work.
    if (this.nativeOnly && !this.nativeWorkers.has(peerId)) {
      this.transport.send(peerId, tcMakeMessage(TC_MSG.NO_WORK));
      return;
    }

    const task = this.queue.shift();
    if (!task) {
      this.transport.send(peerId, tcMakeMessage(TC_MSG.NO_WORK));
      return;
    }
    const timer = setTimeout(() => this._handleTimeout(task.id), this.taskTimeoutMs);
    this.inFlight.set(task.id, { peerId, task, timer });
    this.transport.send(peerId, tcMakeMessage(TC_MSG.TASK_ASSIGN, task));
  }

  handleTaskResult(peerId, payload) {
    const entry = this.inFlight.get(payload.id);
    if (!entry || entry.peerId !== peerId) return; // stale/duplicate result, ignore
    clearTimeout(entry.timer);
    this.inFlight.delete(payload.id);
    this.completed++;

    if (payload.error) {
      console.error(`Task ${payload.id} failed in worker function:`, payload.error);
    } else {
      this._mergeResult(entry.task, payload.result);
    }

    this._emitTelemetry();

    if (this.completed >= this.total) {
      if (this.onJobDone) this.onJobDone(this.currentJob);
      this.currentJob = null;
    } else {
      this.handleTaskRequest(peerId); // keep this worker busy immediately
    }
  }

  // How a task's result gets folded into the job's overall output,
  // decided by this.resultType (set from the plugin or an override).
  _mergeResult(task, result) {
    if (this.resultType === 'canvas-tile' && this.canvasPainter && result && result.pixels) {
      const buf = Uint8ClampedArray.from(result.pixels);
      this.canvasPainter.paintTile(task, buf);
      return;
    }

    if (this.resultType === 'accumulate' && result && typeof result === 'object') {
      for (const [k, v] of Object.entries(result)) {
        if (typeof v === 'number') this.accumulated[k] = (this.accumulated[k] || 0) + v;
      }
      if (this.onAccumulate) this.onAccumulate(this.accumulated);
      // Preserve the pi-estimate callback the built-in Monte Carlo demo UI uses.
      if ('insideCount' in this.accumulated && 'samples' in this.accumulated && this.onMonteCarloUpdate) {
        const piEstimate = 4 * this.accumulated.insideCount / this.accumulated.samples;
        this.onMonteCarloUpdate({ piEstimate, ...this.accumulated });
      }
      return;
    }

    // 'collect' - keep every result (e.g. CSV rows, grid-search scores, key hits).
    this.results.push({ taskId: task.id, result });
    if (this.onResultsUpdate) this.onResultsUpdate(this.results);
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
    const eligibleWorkers = this.nativeOnly ? this.nativeWorkers : this.workers;
    for (const peerId of eligibleWorkers) {
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
      job: this.currentJob,
      resultType: this.resultType
    });
  }
}

if (typeof window !== 'undefined') window.TCDispatcher = TCDispatcher;
