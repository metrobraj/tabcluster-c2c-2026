// js/main.js
// Single entry point for the merged index.html. Decides which panel to
// show: a room code in the URL (from a scanned QR / shared join link)
// skips straight to the worker join flow; otherwise the person picks
// Host or Join from the landing panel.

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const roomFromUrl = params.get('room');

  const landing = document.getElementById('landing-panel');
  const hostPanel = document.getElementById('host-panel');
  const workerPanel = document.getElementById('worker-panel');

  function showHost() {
    landing.classList.add('hidden');
    hostPanel.classList.remove('hidden');
    initHostUI();
  }

  function showWorker(prefillRoom) {
    landing.classList.add('hidden');
    workerPanel.classList.remove('hidden');
    initWorkerUI(prefillRoom);
  }

  if (roomFromUrl) {
    showWorker(roomFromUrl);
    return;
  }

  document.getElementById('btn-host').addEventListener('click', showHost);
  document.getElementById('btn-join').addEventListener('click', () => showWorker(null));
});
