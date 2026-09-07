// js/shared/protocol.js
// Wire protocol shared by host and worker. Every message on the network
// is { type, payload, ts }.

const TC_MSG = {
  TASK_REQUEST: 'task_request',     // worker -> host: "give me work"
  TASK_ASSIGN: 'task_assign',       // host -> worker: here's a chunk
  TASK_RESULT: 'task_result',       // worker -> host: chunk is done
  NO_WORK: 'no_work',               // host -> worker: queue is empty right now
  HEARTBEAT_PING: 'heartbeat_ping', // host -> worker
  HEARTBEAT_PONG: 'heartbeat_pong', // worker -> host
  JOB_INIT: 'job_init'              // host -> worker: here's the function to run for this job
};

const TC_JOB = {
  MANDELBROT: 'mandelbrot',
  MONTE_CARLO: 'montecarlo'
};

function tcMakeMessage(type, payload) {
  return { type, payload: payload || {}, ts: Date.now() };
}

if (typeof window !== 'undefined') {
  window.TC_MSG = TC_MSG;
  window.TC_JOB = TC_JOB;
  window.tcMakeMessage = tcMakeMessage;
}