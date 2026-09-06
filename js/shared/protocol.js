export const MESSAGE_TYPES = {
  TASK_OFFER: 'TASK_OFFER',
  TASK_COMPLETE: 'TASK_COMPLETE',
  TASK_ACCEPT: 'TASK_ACCEPT',
  HEARTBEAT: 'HEARTBEAT'
};


export const GRID_CONFIG = {
    CANVAS_WIDTH: 1000,
    CANVAS_HEIGHT: 1000,
    TILE_SIZE: 100,
    MAX_ITERATIONS: 1000
};



// Security check: Ensures incoming data is actually a valid TabCluster message
export function isValidMessage(message) {
  return message && typeof message === 'object' && Object.values(MESSAGE_TYPES).includes(message.type);
}

// Structures the math payload for the Web Worker
export function makeChunk({ id, startX, startY, width, height, maxIter }) {
  return { id, startX, startY, width, height, maxIter };
}

// Wraps the chunk into a network offer message
export function taskOffer(chunk) {
  return { type: MESSAGE_TYPES.TASK_OFFER, chunk };
}

// Wraps the peer ID into a heartbeat message to keep the connection alive
export function heartbeat(peerId) {
  return { type: MESSAGE_TYPES.HEARTBEAT, peerId, timestamp: Date.now() };
}