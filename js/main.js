// js/main.js
// Single entry point for the merged index.html. Decides which panel to
// show: a room code in the URL (from a scanned QR / shared join link)
// skips straight to the worker join flow; otherwise the person picks
// Host or Join from the landing panel.

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const roomFromUrl = params.get('room');
  const roleFromUrl = params.get('role');

  const landing = document.getElementById('landing-panel');
  const hostPanel = document.getElementById('host-panel');
  const workerPanel = document.getElementById('worker-panel');

  function showHost() {
    landing.classList.add('hidden');
    hostPanel.classList.remove('hidden');
    initHostUI();
    setActiveNav('host-cluster');
  }

  function showWorker(prefillRoom) {
    landing.classList.add('hidden');
    workerPanel.classList.remove('hidden');
    initWorkerUI(prefillRoom);
    setActiveNav('worker-node');
  }

  function setActiveNav(path) {
    document.querySelectorAll('.nav-link').forEach((a) => {
      const active = a.dataset.path === path;
      a.classList.toggle('bg-accent', active);
      a.classList.toggle('text-[#0A0D12]', active);
      a.classList.toggle('font-semibold', active);
      a.classList.toggle('text-secondary-text', !active);
    });
  }

  // Persistent nav: a full reload is deliberate here, not an oversight -
  // hostUI/workerUI wire up a live PeerJS peer and dispatcher on init, so
  // switching roles in-place without tearing all that down first would
  // leave a stale connection running behind the new panel. A reload to
  // the same query-param'd URL re-runs this same routing cleanly.
  document.querySelectorAll('.nav-link').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const path = a.dataset.path;
      if (path === 'landing') location.href = location.pathname;
      else if (path === 'host-cluster') location.href = `${location.pathname}?role=host`;
      else if (path === 'worker-node') location.href = `${location.pathname}?role=worker`;
    });
  });

  if (roomFromUrl) {
    showWorker(roomFromUrl);
    return;
  }
  if (roleFromUrl === 'host') { showHost(); return; }
  if (roleFromUrl === 'worker') { showWorker(null); return; }

  setActiveNav('landing');
  document.getElementById('btn-host').addEventListener('click', showHost);
  document.getElementById('btn-join').addEventListener('click', () => showWorker(null));
});