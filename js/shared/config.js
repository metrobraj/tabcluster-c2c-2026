// js/shared/config.js
// Central configuration for tabCluster. Load this before every other script.

const TC_CONFIG = {
  ROOM_PREFIX: 'tabcluster-',
  PEER_OPTIONS: {
    debug: 1
  },

  // --- Canvas / Mandelbrot job ---
  CANVAS_WIDTH: 800,
  CANVAS_HEIGHT: 600,
  TILE_SIZE: 40,            // px per chunk, along both axes
  MAX_ITER: 500,
  MANDELBROT_VIEWPORT: { xMin: -2.2, xMax: 1.0, yMin: -1.2, yMax: 1.2 },

  // --- Monte Carlo job (pi estimation via unit-circle sampling) ---
  MONTE_CARLO_TOTAL_SAMPLES: 50_000_000,
  MONTE_CARLO_CHUNK_SAMPLES: 1_000_000,

  // --- Scheduling / fault tolerance ---
  TASK_TIMEOUT_MS: 10_000,
  HEARTBEAT_INTERVAL_MS: 3000,
  HEARTBEAT_TIMEOUT_MS: 9000,

  // --- Local fallback (single machine, cross-tab, no network) ---
  LOCAL_BUS_CHANNEL: 'tabcluster-local-bus',
  WEBRTC_FALLBACK_TIMEOUT_MS: 6000
};

if (typeof window !== 'undefined') window.TC_CONFIG = TC_CONFIG;