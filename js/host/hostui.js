// js/host/hostui.js
// Bootstraps the host page: generates a room code, renders a QR code
// workers can scan, wires transport -> dispatcher -> canvas together,
// and reflects live telemetry (active workers, completion %, an
// illustrative TFLOPS estimate) in the DOM.

(function () {
  function randomRoomCode(len = 5) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  document.addEventListener('DOMContentLoaded', () => {
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
      connMode: document.getElementById('conn-mode')
    };

    els.roomCode.textContent = roomCode;

    const joinUrl = `${location.origin}${location.pathname.replace('host.html', 'worker.html')}?room=${roomCode}`;
    if (window.QRCode) {
      // eslint-disable-next-line no-new
      new QRCode(els.qr, { text: joinUrl, width: 152, height: 152, colorDark: '#0b0d16', colorLight: '#f4f2ec' });
    } else {
      els.qr.textContent = joinUrl;
    }

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
          const flopsPerChunk = t.job === TC_JOB.MANDELBROT
            ? TC_CONFIG.TILE_SIZE * TC_CONFIG.TILE_SIZE * TC_CONFIG.MAX_ITER * 6
            : TC_CONFIG.MONTE_CARLO_CHUNK_SAMPLES * 4;
          const tflops = (chunksPerSec * flopsPerChunk) / 1e12;
          els.statTflops.textContent = tflops > 0 ? tflops.toFixed(3) : '0.000';
          lastTickAt = now;
          lastCompleted = t.completed;
        }

        if (t.job === TC_JOB.MONTE_CARLO) {
          els.piRow.classList.remove('hidden');
        }
      },
      onJobDone: (job) => setStatus(`${job === TC_JOB.MANDELBROT ? 'Mandelbrot' : 'Monte Carlo'} job complete.`),
      onMonteCarloUpdate: ({ piEstimate }) => {
        els.piEstimate.textContent = piEstimate.toFixed(6);
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
  });
})();