// js/network/transport.js
// The single place that decides which transport is active. Flip
// TRANSPORT_MODE in shared/config.js to switch — host/worker code that
// calls createTransport() never needs to change either way.

import { TRANSPORT_MODE } from '../shared/config.js';
import { LocalBus } from './local-bus.js';
import { P2PMeshTransport } from './p2pmesh.js';

export function createTransport(peerId, role, options = {}) {
  if (TRANSPORT_MODE === 'local') {
    return new LocalBus(peerId, role, options);
  }
  return new P2PMeshTransport(peerId, role, options);
}