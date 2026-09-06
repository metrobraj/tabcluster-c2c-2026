// js/worker/workermain.js
// Runs on the worker's tab main thread. Joins the host's room over the
// transport, then continuously pulls tasks: request work -> hand it to
// the background Web Worker -> ship the result back -> request more.
//
// Called by js/main.js once the person picks "Join" or arrives via a
// ?room= link - no longer its own DOMContentLoaded listener, since
// host.html and worker.html were merged into one index.html.

function initWorkerUI(prefilledRoom) {
  const els = {
    form: document.getElementById('join-form'),
    roomInput: document.getElementById('room-input'),
    status: document.getElementById('status-worker'),
    completedCount: document.getElementById('completed-count'),
    connMode: document.getElementById('conn-mode-worker'),
    joinPanel: document.getElementById('join-panel'),
    workPanel: document.getElementById('work-panel'),
    threadCount: document.getElementById('thread-count')
  };

  if (els.threadCount) {
    els.threadCount.textContent = navigator.hardwareConcurrency || '—';
  }

  if (prefilledRoom) els.roomInput.value = prefilledRoom;

  let transport, heartbeat, mathWorker;
  let completed = 0;

  function setStatus(text) { els.status.textContent = text; }

  function startMathWorker() {
    mathWorker = new Worker('js/worker/math-worker.js');
    mathWorker.onmessage = (e) => {
      if (e.data.kind === 'init-error') {
        setStatus(`Worker function failed to compile: ${e.data.error}`);
        return;
      }
      transport.sendToHost(tcMakeMessage(TC_MSG.TASK_RESULT, e.data));
      completed++;
      els.completedCount.textContent = completed;
      transport.sendToHost(tcMakeMessage(TC_MSG.TASK_REQUEST));
    };
  }

  function joinRoom(roomCode) {
    els.joinPanel.classList.add('hidden');
    els.workPanel.classList.remove('hidden');
    setStatus('Connecting to host...');

    transport = new TCTransport();
    heartbeat = new TCHeartbeat(transport);

    transport.init({
      role: 'worker',
      roomCode,
      onReady: () => setStatus('Connected. Looking for the host...'),
      onPeerJoin: () => {
        setStatus('Joined the cluster. Waiting for tasks...');
        transport.sendToHost(tcMakeMessage(TC_MSG.TASK_REQUEST));
      },
      onPeerLeave: () => setStatus('Host disconnected.'),
      onMessage: (peerId, message) => {
        heartbeat.markAlive(peerId);
        switch (message.type) {
          case TC_MSG.JOB_INIT:
            mathWorker.postMessage({ kind: 'init', fnSource: message.payload.fnSource });
            break;
          case TC_MSG.TASK_ASSIGN:
            setStatus('Computing a chunk...');
            mathWorker.postMessage({ kind: 'task', task: message.payload });
            break;
          case TC_MSG.NO_WORK:
            setStatus('No work queued right now - idle.');
            setTimeout(() => transport.sendToHost(tcMakeMessage(TC_MSG.TASK_REQUEST)), 1500);
            break;
          case TC_MSG.HEARTBEAT_PING:
            transport.sendToHost(tcMakeMessage(TC_MSG.HEARTBEAT_PONG));
            break;
          default:
            break;
        }
      },
      onModeChange: (mode) => {
        els.connMode.textContent = mode === 'local' ? 'Local (same-machine fallback)' : 'WebRTC (peer-to-peer)';
      }
    });

    els.connMode.textContent = 'WebRTC (peer-to-peer)';
    heartbeat.startWorker();
    startMathWorker();
  }

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = els.roomInput.value.trim().toUpperCase();
    if (code) joinRoom(code);
  });

  if (prefilledRoom) joinRoom(prefilledRoom.toUpperCase());
}

if (typeof window !== 'undefined') window.initWorkerUI = initWorkerUI;
