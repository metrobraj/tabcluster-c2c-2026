// js/shared/config.js
// Central knobs. Change here, not scattered across files.

// 'local' -> BroadcastChannel bus, same-machine only (Phase 1, and your
//            live fallback if venue Wi-Fi blocks WebRTC in Phase 5)
// 'p2p'   -> real WebRTC via PeerJS, cross-device (Phase 2 onward)
export const TRANSPORT_MODE = 'p2p';

export const HEARTBEAT_INTERVAL_MS = 3000;
export const HEARTBEAT_TIMEOUT_MS = 8000;

// Reads ?room=xyz from the URL (worker joining), or generates a fresh
// code if this tab has none (host creating a room) — and writes that
// code back into the URL so reloading THIS tab reuses it instead of
// generating a new one and silently breaking any link already shared.
export function resolveRoomId() {
  const params = new URLSearchParams(window.location.search);
  let roomId = params.get('room');

  if (!roomId) {
    roomId = crypto.randomUUID().slice(0, 6);
    params.set('room', roomId);
    history.replaceState(null, '', `${location.pathname}?${params}`);
  }

  return roomId;
}