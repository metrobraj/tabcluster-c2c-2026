// js/network/heartbeat.js
// Periodically broadcasts a HEARTBEAT and flags any peer that's gone quiet.
// Works with whichever transport is active (local-bus or p2pmesh) — it only
// relies on the shared interface (broadcast + onMessage), never on which
// one is running underneath.

import { heartbeat, MESSAGE_TYPES } from '../shared/protocol.js';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from '../shared/config.js';

export function startHeartbeat(transport, onPeerTimeout) {
  const lastSeen = new Map();

  transport.onMessage((fromPeerId, message) => {
    if (message.type === MESSAGE_TYPES.HEARTBEAT) {
      lastSeen.set(fromPeerId, Date.now());
    }
  });

  const sendInterval = setInterval(() => {
    transport.broadcast(heartbeat(transport.peerId));
  }, HEARTBEAT_INTERVAL_MS);

  const checkInterval = setInterval(() => {
    const now = Date.now();
    for (const [peerId, seenAt] of lastSeen.entries()) {
      if (now - seenAt > HEARTBEAT_TIMEOUT_MS) {
        lastSeen.delete(peerId);
        onPeerTimeout(peerId);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Call this on cleanup (e.g. tab close) to stop both timers.
  return () => {
    clearInterval(sendInterval);
    clearInterval(checkInterval);
  };
}