// js/host/hostui.js
// Bootstraps the host panel: generates a room code, renders a QR code
// workers can scan, wires transport -> dispatcher -> canvas together,
// and reflects live telemetry (active workers, completion %, an
// illustrative TFLOPS estimate) in the DOM.
//
// Called by js/main.js once the person picks "Host" - no longer its own
// DOMContentLoaded listener, since host.html and worker.html were merged
// into one index.html with a role picker.

function initHostUI() {
  function randomRoomCode(len = 5) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  const roomCode = randomRoomCode();

  const els = {
    roomCode: document.getElementById('room-code'),
    qr: document.getElementById('qr-code'),
    status: document.getElementById('status'),
    statWorkers: document.getElementById('stat-workers'),
    statProgress: document.getElementById('stat-progress'),
    progressBar: document.getElementById('progress-bar'),
    statTflops: document.getElementById('stat-tflops'),
    piEstimate: document.getElementById('pi-estimate'),
    piRow: document.getElementById('pi-row'),
    canvas: document.getElementById('render-canvas'),
    btnMandelbrot: document.getElementById('btn-mandelbrot'),
    btnMonteCarlo: document.getElementById('btn-montecarlo'),
    connMode: document.getElementById('conn-mode'),
    pluginSelect: document.getElementById('plugin-select'),
    pluginDesc: document.getElementById('plugin-desc'),
    splitterParams: document.getElementById('splitter-params'),
    fnSource: document.getElementById('fn-source'),
    btnRunCustom: document.getElementById('btn-run-custom'),
    customError: document.getElementById('custom-error'),
    resultsCount: document.getElementById('results-count'),
    btnDownloadResults: document.getElementById('btn-download-results')
  };

  let lastResults = [];

  els.roomCode.textContent = roomCode;

  // The browser has no API to ask the OS for its own LAN IP (the old
  // WebRTC ICE-candidate trick for this was closed off years ago -
  // modern browsers mask it behind a random mDNS .local name). So if
  // this page was opened as localhost/127.0.0.1, we can't auto-fix the
  // join link - the host has to type their LAN IP once. Anyone who
  // opened the host page via a real IP, a tunnel, or a Vercel deploy
  // never sees this prompt at all.
  let qrCode = null;
  let origin = location.origin;

  function buildJoinUrl(customOrigin) {
    return `${customOrigin || origin}${location.pathname}?room=${roomCode}`;
  }

  function renderJoinTarget() {
    const joinUrl = buildJoinUrl();

    if (window.QRCode) {
      els.qr.innerHTML = '';
      // eslint-disable-next-line no-new
      qrCode = new QRCode(els.qr, { text: joinUrl, width: 152, height: 152, colorDark: '#0b0d16', colorLight: '#f4f2ec' });
    } else {
      els.qr.textContent = joinUrl;
    }

    const linkEl = document.getElementById('join-link');
    if (linkEl) {
      linkEl.textContent = joinUrl;
      linkEl.href = joinUrl;
    }
  }

  const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const ipFixPanel = document.getElementById('ip-fix-panel');

  if (isLocalhost && ipFixPanel) {
    document.getElementById('localhost-shown').textContent = location.hostname;
    ipFixPanel.style.display = 'block';

    document.getElementById('ip-fix-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const ip = document.getElementById('ip-fix-input').value.trim();
      if (!ip) return;
      origin = `${location.protocol}//${ip}:${location.port}`;
      ipFixPanel.style.display = 'none';
      renderJoinTarget();
    });
  }

  renderJoinTarget();

  const painter = new TCCanvasPainter(els.canvas);
  painter.clear();

  const transport = new TCTransport();

  const heartbeat = new TCHeartbeat(transport, {
    onPeerTimeout: (peerId) => {
      dispatcher.removeWorker(peerId);
      setStatus(`Lost worker ${shortId(peerId)} (heartbeat timeout)`);
    }
  });

  let lastTickAt = Date.now();
  let lastCompleted = 0;

  const dispatcher = new TCDispatcher(transport, {
    canvasPainter: painter,
    onTelemetry: (t) => {
      els.statWorkers.textContent = t.activeWorkers;
      const pct = t.total ? Math.round((t.completed / t.total) * 100) : 0;
      els.statProgress.textContent = `${t.completed} / ${t.total}`;
      els.progressBar.style.width = `${pct}%`;

      const now = Date.now();
      const dt = (now - lastTickAt) / 1000;
      if (dt > 0.5) {
        const chunksPerSec = (t.completed - lastCompleted) / dt;
        const flopsPerChunk = t.job === 'frame2d3d'
          ? TC_CONFIG.TILE_SIZE * TC_CONFIG.TILE_SIZE * TC_CONFIG.MAX_ITER * 6
          : TC_CONFIG.MONTE_CARLO_CHUNK_SAMPLES * 4;
        const tflops = (chunksPerSec * flopsPerChunk) / 1e12;
        els.statTflops.textContent = tflops > 0 ? tflops.toFixed(3) : '0.000';
        lastTickAt = now;
        lastCompleted = t.completed;
      }

      if (t.resultType === 'accumulate' && 'insideCount' in dispatcher.accumulated) {
        els.piRow.classList.remove('hidden');
      }
    },
    onJobDone: (job) => setStatus(`Job "${job || 'custom'}" complete.`),
    onMonteCarloUpdate: ({ piEstimate }) => {
      els.piEstimate.textContent = piEstimate.toFixed(6);
    },
    onResultsUpdate: (results) => {
      if (els.resultsCount) els.resultsCount.textContent = results.length;
      if (els.btnDownloadResults) els.btnDownloadResults.classList.remove('hidden');
      lastResults = results;
    }
  });

  function setStatus(text) { els.status.textContent = text; }
  function shortId(id) { return id.slice(-4); }

  transport.init({
    role: 'host',
    roomCode,
    onReady: () => setStatus('Room open. Waiting for workers to join...'),
    onPeerJoin: (peerId) => {
      dispatcher.addWorker(peerId);
      heartbeat.trackPeer(peerId);
      setStatus(`Worker ${shortId(peerId)} joined the cluster.`);
    },
    onPeerLeave: (peerId) => {
      dispatcher.removeWorker(peerId);
      heartbeat.forgetPeer(peerId);
      setStatus(`Worker ${shortId(peerId)} left. Re-queued its chunk.`);
    },
    onMessage: (peerId, message) => {
      heartbeat.markAlive(peerId);
      switch (message.type) {
        case TC_MSG.TASK_REQUEST:
          dispatcher.handleTaskRequest(peerId);
          break;
        case TC_MSG.TASK_RESULT:
          dispatcher.handleTaskResult(peerId, message.payload);
          break;
        case TC_MSG.HEARTBEAT_PONG:
          break;
        default:
          break;
      }
    },
    onModeChange: (mode) => {
      els.connMode.textContent = mode === 'local' ? 'Local (same-machine fallback)' : 'WebRTC (peer-to-peer)';
      els.connMode.classList.toggle('mode-local', mode === 'local');
    }
  });

  els.connMode.textContent = 'WebRTC (peer-to-peer)';
  heartbeat.startHost();

  els.btnMandelbrot.addEventListener('click', () => {
    setStatus('Rendering Mandelbrot set across the cluster...');
    els.piRow.classList.add('hidden');
    dispatcher.startMandelbrotJob();
  });

  els.btnMonteCarlo.addEventListener('click', () => {
    setStatus('Running Monte Carlo pi estimation across the cluster...');
    els.piEstimate.textContent = '—';
    dispatcher.startMonteCarloJob();
  });

  // --- Custom job builder: pick a Big-5 template, supply splitter params
  // as JSON and a per-task function as JS source, and startJob() runs it
  // across the cluster exactly like the two built-in demos above. ---
  const PLUGIN_EXAMPLES = {
    frame2d3d: {
      params: { width: 800, height: 600, tileSize: 40 },
      fn:
`// task = { x, y, width, height, canvasWidth, canvasHeight }
// return { pixels, width, height } - flat RGBA array, length width*height*4
const pixels = new Array(task.width * task.height * 4);
for (let py = 0; py < task.height; py++) {
  for (let px = 0; px < task.width; px++) {
    const idx = (py * task.width + px) * 4;
    pixels[idx] = (task.x + px) % 256;
    pixels[idx + 1] = (task.y + py) % 256;
    pixels[idx + 2] = 120;
    pixels[idx + 3] = 255;
  }
}
return { pixels, width: task.width, height: task.height };`
    },
    dataStream: {
      params: { totalItems: 1000000, chunkSize: 10000 },
      fn:
`// task = { rangeStart, rangeEnd }
// return anything JSON-able - collected into a results list on the host
let count = 0;
for (let i = task.rangeStart; i < task.rangeEnd; i++) {
  if (i % 7 === 0) count++;
}
return { rangeStart: task.rangeStart, rangeEnd: task.rangeEnd, count };`
    },
    paramGrid: {
      params: { dimensions: [{ name: 'lr', values: [0.001, 0.01, 0.1] }, { name: 'depth', values: [3, 5, 7] }], chunkSize: 10 },
      fn:
`// task = { combos: [{ lr, depth }, ...] }
// return anything JSON-able per chunk
return task.combos.map((c) => ({ ...c, score: Math.random() }));`
    },
    rangeKey: {
      params: { start: 0, end: 1000000, step: 10000 },
      fn:
`// task = { rangeStart, rangeEnd }
let hits = 0;
for (let k = task.rangeStart; k < task.rangeEnd; k++) {
  if (k % 97 === 0) hits++;
}
return { rangeStart: task.rangeStart, rangeEnd: task.rangeEnd, hits };`
    },
    miniBatch: {
      params: { datasetSize: 5000000, batchSize: 50000 },
      fn:
`// task = { batchStart, batchEnd }
// return numeric fields to have them SUMMED across every batch
let correct = 0;
const total = task.batchEnd - task.batchStart;
for (let i = task.batchStart; i < task.batchEnd; i++) {
  if (Math.random() > 0.5) correct++;
}
return { correct, total };`
    }
  };

  function populatePluginSelect() {
    if (!els.pluginSelect) return;
    els.pluginSelect.innerHTML = '';
    for (const [id, plugin] of Object.entries(TC_PLUGINS)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = plugin.name;
      els.pluginSelect.appendChild(opt);
    }
    applyExample(els.pluginSelect.value);
  }

  function applyExample(pluginId) {
    const plugin = TC_PLUGINS[pluginId];
    const example = PLUGIN_EXAMPLES[pluginId];
    if (els.pluginDesc) els.pluginDesc.textContent = plugin ? plugin.description : '';
    if (example) {
      els.splitterParams.value = JSON.stringify(example.params, null, 2);
      els.fnSource.value = example.fn;
    }
  }

  if (els.pluginSelect) {
    populatePluginSelect();
    els.pluginSelect.addEventListener('change', () => applyExample(els.pluginSelect.value));
  }

  if (els.btnRunCustom) {
    els.btnRunCustom.addEventListener('click', () => {
      if (els.customError) els.customError.textContent = '';
      let splitterParams;
      try {
        splitterParams = JSON.parse(els.splitterParams.value);
      } catch (err) {
        if (els.customError) els.customError.textContent = `Splitter params aren't valid JSON: ${err.message}`;
        return;
      }

      const pluginId = els.pluginSelect.value;
      const fnSource = els.fnSource.value;

      if (els.resultsCount) els.resultsCount.textContent = '0';
      if (els.btnDownloadResults) els.btnDownloadResults.classList.add('hidden');
      els.piRow.classList.add('hidden');

      setStatus(`Running "${TC_PLUGINS[pluginId].name}" job across the cluster...`);
      dispatcher.startJob({ pluginId, splitterParams, fnSource });
    });
  }

  if (els.btnDownloadResults) {
    els.btnDownloadResults.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(lastResults, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tabcluster-results.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}

if (typeof window !== 'undefined') window.initHostUI = initHostUI;
