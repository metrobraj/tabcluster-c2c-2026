export const MSG_TYPES = {
  READY: 'READY',
  TASK_OFFER: 'TASK_OFFER',
  TASK_COMPLETE: 'TASK_COMPLETE',
  NO_WORK: 'NO_WORK',
  HEARTBEAT: 'HEARTBEAT'
};

export function createMessage(type, payload = {}) {
  return { type, ...payload, timestamp: Date.now() };
}