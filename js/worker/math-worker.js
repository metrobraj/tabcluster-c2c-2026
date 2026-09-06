// js/worker/math-worker.js
// Runs inside a background Web Worker thread, off the main UI thread.
// Receives one task descriptor at a time from workermain.js, does the
// CPU-bound math, and posts the result back. Mandelbrot pixels are
// transferred as a raw ArrayBuffer (zero-copy) to avoid structured-clone
// overhead on large tiles.

self.onmessage = function (e) {
  const task = e.data;

  if (task.jobType === 'mandelbrot') {
    const pixels = computeMandelbrotTile(task);
    self.postMessage(
      { id: task.id, jobType: task.jobType, pixels: pixels.buffer },
      [pixels.buffer]
    );
  } else if (task.jobType === 'montecarlo') {
    const result = computeMonteCarloChunk(task);
    self.postMessage({ id: task.id, jobType: task.jobType, ...result });
  }
};

function computeMandelbrotTile(task) {
  const { x, y, width, height, canvasWidth, canvasHeight, maxIter, viewport } = task;
  const { xMin, xMax, yMin, yMax } = viewport;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let py = 0; py < height; py++) {
    const globalY = y + py;
    const cy = yMin + (globalY / canvasHeight) * (yMax - yMin);

    for (let px = 0; px < width; px++) {
      const globalX = x + px;
      const cx = xMin + (globalX / canvasWidth) * (xMax - xMin);

      let zx = 0, zy = 0, iter = 0;
      while (zx * zx + zy * zy <= 4 && iter < maxIter) {
        const nzx = zx * zx - zy * zy + cx;
        zy = 2 * zx * zy + cy;
        zx = nzx;
        iter++;
      }

      const idx = (py * width + px) * 4;
      if (iter === maxIter) {
        pixels[idx] = 6; pixels[idx + 1] = 6; pixels[idx + 2] = 14; pixels[idx + 3] = 255;
      } else {
        const t = iter / maxIter;
        pixels[idx] = Math.floor(9 * (1 - t) * t * t * t * 255);
        pixels[idx + 1] = Math.floor(15 * (1 - t) * (1 - t) * t * t * 255);
        pixels[idx + 2] = Math.floor(140 + 115 * t);
        pixels[idx + 3] = 255;
      }
    }
  }
  return pixels;
}

function computeMonteCarloChunk(task) {
  const { samples, seed } = task;
  let state = (seed >>> 0) || 1;

  // Mulberry32 PRNG - deterministic per (seed) so a chunk is reproducible.
  function rand() {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  let insideCount = 0;
  for (let i = 0; i < samples; i++) {
    const px = rand() * 2 - 1;
    const py = rand() * 2 - 1;
    if (px * px + py * py <= 1) insideCount++;
  }
  return { insideCount, samples };
}