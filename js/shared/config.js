// js/shared/config.js
// Central knobs. Change here, not scattered across files.

// 'local' -> BroadcastChannel bus, same-machine only (Phase 1, and your
//            live fallback if venue Wi-Fi blocks WebRTC in Phase 5)
// 'p2p'   -> real WebRTC via PeerJS, cross-device (Phase 2 onward)
export const TRANSPORT_MODE = 'local';

export const HEARTBEAT_INTERVAL_MS = 3000;
export const HEARTBEAT_TIMEOUT_MS = 8000;

// Reads ?room=xyz from the URL (worker joining), or generates a fresh
// code if this tab has none (host creating a room).
export function resolveRoomId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('room') || crypto.randomUUID().slice(0, 6);
}