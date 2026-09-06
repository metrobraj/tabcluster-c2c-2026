// js/worker/math-worker.js
// Generic compute worker. Runs inside a background Web Worker thread, off
// the main UI thread. Instead of hardcoded job logic, it compiles a
// user-supplied function ONCE per job (sent via a 'init' message relayed
// by workermain.js from the host's JOB_INIT broadcast) and then just
// calls that function once per task. This is what lets tabCluster run
// arbitrary user-defined workloads - a custom fractal, a log parser, a
// hyperparameter eval, a hash-range search - instead of only the
// built-in Mandelbrot/Monte Carlo demos.
//
// Trust note: the function text comes from whoever is hosting the room,
// same as a BullMQ worker trusts the processor code its queue gives it.
// It runs inside this Worker thread's own sandbox (no DOM access, no
// access to the tab's other state), not the main thread.

let userFn = null;

self.onmessage = function (e) {
  const msg = e.data;

  if (msg.kind === 'init') {
    try {
      // eslint-disable-next-line no-new-func
      userFn = new Function('task', msg.fnSource);
    } catch (err) {
      self.postMessage({ kind: 'init-error', error: err.message });
    }
    return;
  }

  // Back-compat: a raw task object (no envelope) is also accepted.
  const task = msg.kind === 'task' ? msg.task : msg;

  if (!userFn) {
    self.postMessage({ id: task.id, jobType: task.jobType, error: 'Worker function not initialized yet - job_init has not arrived' });
    return;
  }

  try {
    const result = userFn(task);
    self.postMessage({ id: task.id, jobType: task.jobType, result });
  } catch (err) {
    self.postMessage({ id: task.id, jobType: task.jobType, error: err.message });
  }
};
