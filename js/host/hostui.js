// js/host/hostui.js
// Bootstraps the host panel: generates a room code, renders a QR code
// workers can scan, wires transport -> dispatcher -> canvas together,
// and reflects live telemetry (active workers, completion %, an
// illustrative TFLOPS estimate) in the DOM.

function initHostUI() {
  // 1. GENERATE ROOM CODE FIRST AT SCOPE ROOT
  function randomRoomCode(len = 5) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  const roomCode = randomRoomCode();

  // 2. DEFINE UI ELEMENTS OBJECT
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
    btnDownloadResults: document.getElementById('btn-download-results'),
    pyFnSource: document.getElementById('py-fn-source'),
    relayUrl: document.getElementById('relay-url'),
    btnEnableNative: document.getElementById('btn-enable-native'),
    btnSpawnNative: document.getElementById('btn-spawn-native'),
    nativeStatus: document.getElementById('native-status')
  };

  let lastResults = [];

  if (els.roomCode) els.roomCode.textContent = roomCode;

  let qrCode = null;
  let origin = location.origin;

  function buildJoinUrl(customOrigin) {
    return `${customOrigin || origin}${location.pathname}?room=${roomCode}`;
  }

  function renderJoinTarget() {
    const joinUrl = buildJoinUrl();

    if (window.QRCode && els.qr) {
      els.qr.innerHTML = '';
      // eslint-disable-next-line no-new
      qrCode = new QRCode(els.qr, { text: joinUrl, width: 152, height: 152, colorDark: '#0b0d16', colorLight: '#f4f2ec' });
    } else if (els.qr) {
      els.qr.textContent = joinUrl;
    }

    const linkEl = document.getElementById('join-link');
    if (linkEl) {
      linkEl.textContent = joinUrl;
      linkEl.href = joinUrl;
    }

    updateCommandDisplay();
  }

  // 3. COMMAND DISPLAY UPDATER
  const cmdRelay = document.getElementById('cmd-relay-url');
  const cmdRoom = document.getElementById('cmd-room-code');

  function updateCommandDisplay() {
    const currentRelay = (els.relayUrl ? els.relayUrl.value.trim() : '') || `ws://${location.host}/ws`;
    if (cmdRelay) cmdRelay.textContent = currentRelay;
    if (cmdRoom) cmdRoom.textContent = roomCode;
  }

  if (els.relayUrl) {
    els.relayUrl.addEventListener('input', updateCommandDisplay);
  }

  // 4. IP DETECTION & LOCALHOST OVERRIDES
  const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const ipFixPanel = document.getElementById('ip-fix-panel');

  if (isLocalhost) {
    fetch('/api/ip')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.ip && data.ip !== '127.0.0.1') {
          origin = `${location.protocol}//${data.ip}:${location.port}`;
          if (ipFixPanel) ipFixPanel.style.display = 'none';
          renderJoinTarget();

          if (els.relayUrl && location.protocol !== 'file:') {
            const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            els.relayUrl.value = `${wsProtocol}//${data.ip}:${location.port}/ws`;
            updateCommandDisplay();
          }
        } else if (ipFixPanel) {
          document.getElementById('localhost-shown').textContent = location.hostname;
          ipFixPanel.style.display = 'block';
        }
      })
      .catch(() => {
        if (ipFixPanel) {
          document.getElementById('localhost-shown').textContent = location.hostname;
          ipFixPanel.style.display = 'block';
        }
      });

    if (ipFixPanel) {
      document.getElementById('ip-fix-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const ip = document.getElementById('ip-fix-input').value.trim();
        if (!ip) return;
        origin = `${location.protocol}//${ip}:${location.port}`;
        ipFixPanel.style.display = 'none';
        renderJoinTarget();
      });
    }
  }

  renderJoinTarget();

  // 5. DISPATCHER & CANVAS INITIALIZATION
  const painter = new TCCanvasPainter(els.canvas);
  painter.clear();

  const transport = new TCTransport();
  const multiTransport = new TCMultiTransport(transport);
  let nativeBridge = null;

  const heartbeat = new TCHeartbeat(multiTransport, {
    onPeerTimeout: (peerId) => {
      dispatcher.removeWorker(peerId);
      multiTransport.unregisterPeer(peerId);
      setStatus(`Lost worker ${shortId(peerId)} (heartbeat timeout)`);
    }
  });

  let lastTickAt = Date.now();
  let lastCompleted = 0;

  const dispatcher = new TCDispatcher(multiTransport, {
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

  function setStatus(text) { if (els.status) els.status.textContent = text; }
  function shortId(id) { return id.slice(-4); }

  function handleWorkerMessage(peerId, message) {
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
  }

  transport.init({
    role: 'host',
    roomCode,
    onReady: () => setStatus('Room open. Waiting for workers to join...'),
    onPeerJoin: (peerId) => {
      multiTransport.registerPeer(peerId, 'primary');
      dispatcher.addWorker(peerId);
      heartbeat.trackPeer(peerId);
      setStatus(`Worker ${shortId(peerId)} joined the cluster.`);
    },
    onPeerLeave: (peerId) => {
      dispatcher.removeWorker(peerId);
      heartbeat.forgetPeer(peerId);
      multiTransport.unregisterPeer(peerId);
      setStatus(`Worker ${shortId(peerId)} left. Re-queued its chunk.`);
    },
    onMessage: handleWorkerMessage,
    onModeChange: (mode) => {
      if (els.connMode) {
        els.connMode.textContent = mode === 'local' ? 'Local (same-machine fallback)' : 'WebRTC (peer-to-peer)';
        els.connMode.classList.toggle('mode-local', mode === 'local');
      }
    }
  });

  if (els.connMode) els.connMode.textContent = 'WebRTC (peer-to-peer)';
  heartbeat.startHost();

  if (els.btnMandelbrot) {
    els.btnMandelbrot.addEventListener('click', () => {
      setStatus('Rendering Mandelbrot set across the cluster...');
      els.piRow.classList.add('hidden');
      dispatcher.startMandelbrotJob();
    });
  }

  if (els.btnMonteCarlo) {
    els.btnMonteCarlo.addEventListener('click', () => {
      setStatus('Running Monte Carlo pi estimation across the cluster...');
      els.piEstimate.textContent = '—';
      dispatcher.startMonteCarloJob();
    });
  }

  // 6. NATIVE WORKER BRIDGE & AUTO-SPAWNING
  if (els.btnEnableNative) {
    if (els.relayUrl && location.protocol !== 'file:') {
      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      els.relayUrl.value = `${wsProtocol}//${location.host}/ws`;
      updateCommandDisplay();
    }

    els.btnEnableNative.addEventListener('click', () => {
      const relayUrl = (els.relayUrl.value || '').trim();
      if (!relayUrl) {
        els.nativeStatus.textContent = 'Enter a relay URL first (e.g. ws://192.168.1.42:8000/ws).';
        return;
      }
      nativeBridge = new TCNativeBridge();
      multiTransport.attachNative(nativeBridge);
      els.nativeStatus.textContent = 'Connecting to relay...';

      nativeBridge.init({
        relayUrl,
        role: 'host',
        roomCode,
        onReady: () => { els.nativeStatus.textContent = `Waiting for native workers to join room ${roomCode}...`; },
        onPeerJoin: (peerId) => {
          multiTransport.registerPeer(peerId, 'native');
          dispatcher.addWorker(peerId);
          heartbeat.trackPeer(peerId);
          els.nativeStatus.textContent = `Native worker ${shortId(peerId)} joined.`;
        },
        onPeerLeave: (peerId) => {
          dispatcher.removeWorker(peerId);
          heartbeat.forgetPeer(peerId);
          multiTransport.unregisterPeer(peerId);
          els.nativeStatus.textContent = `Native worker ${shortId(peerId)} left.`;
        },
        onMessage: handleWorkerMessage,
        onError: () => { els.nativeStatus.textContent = `Couldn't reach relay at ${relayUrl}. Is it running?`; },
        onClose: () => {
          els.nativeStatus.textContent = 'Native relay disconnected; reconnecting...';
        }
      });

      els.btnEnableNative.disabled = true;
      els.btnEnableNative.textContent = 'Native bridge enabled';
    });
  }

  const btnSpawn = els.btnSpawnNative || document.getElementById('btn-spawn-native');
  if (btnSpawn) {
    btnSpawn.addEventListener('click', async () => {
      const relayUrl = (els.relayUrl ? els.relayUrl.value : '').trim() || `ws://${location.host}/ws`;

      if (els.btnEnableNative && !els.btnEnableNative.disabled) {
        els.btnEnableNative.click();
      }

      if (els.nativeStatus) els.nativeStatus.textContent = 'Spawning local Python worker...';

      try {
        const resp = await fetch(`/api/spawn-worker?room=${roomCode}&relay=${encodeURIComponent(relayUrl)}`);
        if (resp.ok) {
          if (els.nativeStatus) els.nativeStatus.textContent = 'Native Python worker spawned in background!';
        } else {
          const errText = await resp.text();
          if (els.nativeStatus) els.nativeStatus.textContent = `Failed to spawn worker: ${errText}`;
        }
      } catch (err) {
        if (els.nativeStatus) els.nativeStatus.textContent = `Error spawning worker: ${err.message}`;
      }
    });
  }

  // 7. CUSTOM JOB BUILDER & PLUGINS
  const PLUGIN_EXAMPLES = {
    frame2d3d: {
      params: { width: 800, height: 600, tileSize: 40 },
      fn:
`const pixels = new Array(task.width * task.height * 4);
for (let py = 0; py < task.height; py++) {
  for (let px = 0; px < task.width; px++) {
    const idx = (py * task.width + px) * 4;
    pixels[idx] = (task.x + px) % 256;
    pixels[idx + 1] = (task.y + py) % 256;
    pixels[idx + 2] = 120;
    pixels[idx + 3] = 255;
  }
}
return { pixels, width: task.width, height: task.height };`,
      pyFn:
`def run(task):
    width, height = task['width'], task['height']
    pixels = []
    for py in range(height):
        for px in range(width):
            pixels += [(task['x'] + px) % 256, (task['y'] + py) % 256, 120, 255]
    return {'pixels': pixels, 'width': width, 'height': height}`
    },
    dataStream: {
      params: { totalItems: 1000000, chunkSize: 10000 },
      fn:
`let count = 0;
for (let i = task.rangeStart; i < task.rangeEnd; i++) {
  if (i % 7 === 0) count++;
}
return { rangeStart: task.rangeStart, rangeEnd: task.rangeEnd, count };`,
      pyFn:
`def run(task):
    count = sum(1 for i in range(task['rangeStart'], task['rangeEnd']) if i % 7 == 0)
    return {'rangeStart': task['rangeStart'], 'rangeEnd': task['rangeEnd'], 'count': count}`
    },
    paramGrid: {
      params: { dimensions: [{ name: 'lr', values: [0.001, 0.01, 0.1] }, { name: 'depth', values: [3, 5, 7] }], chunkSize: 10 },
      fn:
`return task.combos.map((c) => ({ ...c, score: Math.random() }));`,
      pyFn:
`import random

def run(task):
    return [{**c, 'score': random.random()} for c in task['combos']]`
    },
    rangeKey: {
      params: { start: 0, end: 1000000, step: 10000 },
      fn:
`let hits = 0;
for (let k = task.rangeStart; k < task.rangeEnd; k++) {
  if (k % 97 === 0) hits++;
}
return { rangeStart: task.rangeStart, rangeEnd: task.rangeEnd, hits };`,
      pyFn:
`def run(task):
    hits = sum(1 for k in range(task['rangeStart'], task['rangeEnd']) if k % 97 == 0)
    return {'rangeStart': task['rangeStart'], 'rangeEnd': task['rangeEnd'], 'hits': hits}`
    },
    miniBatch: {
      params: { datasetSize: 5000000, batchSize: 50000 },
      fn:
`let correct = 0;
const total = task.batchEnd - task.batchStart;
for (let i = task.batchStart; i < task.batchEnd; i++) {
  if (Math.random() > 0.5) correct++;
}
return { correct, total };`,
      pyFn:
`import random

def run(task):
    total = task['batchEnd'] - task['batchStart']
    correct = sum(1 for _ in range(total) if random.random() > 0.5)
    return {'correct': correct, 'total': total}`
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
      if (els.pyFnSource) els.pyFnSource.value = example.pyFn || '';
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
      const pyFnSource = els.pyFnSource ? els.pyFnSource.value.trim() || null : null;

      if (els.resultsCount) els.resultsCount.textContent = '0';
      if (els.btnDownloadResults) els.btnDownloadResults.classList.add('hidden');
      els.piRow.classList.add('hidden');

      setStatus(`Running "${TC_PLUGINS[pluginId].name}" job across the cluster...`);
      dispatcher.startJob({ pluginId, splitterParams, fnSource, pyFnSource });
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
