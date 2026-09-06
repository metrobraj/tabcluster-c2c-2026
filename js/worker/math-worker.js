// worker/math-worker.js

self.onmessage = function (e) {
  const task = e.data;

  if (task.type === 'MANDELBROT') {
    const result = computeMandelbrot(task);
    // Transfer the ArrayBuffer back to the main thread (zero-copy transfer)
    self.postMessage(
      {
        type: 'MANDELBROT',
        taskId: task.id,
        startX: task.startX,
        startY: task.startY,
        width: task.width,
        height: task.height,
        buffer: result
      },
      [result]
    );
  } else if (task.type === 'MONTE_CARLO') {
    const insideCount = computeMonteCarlo(task.samples);
    self.postMessage({
      type: 'MONTE_CARLO',
      taskId: task.id,
      samples: task.samples,
      insideCount: insideCount
    });
  }
};

/**
 * Computes Mandelbrot fractal pixel buffer for a given tile.
 */
function computeMandelbrot(task) {
  const { startX, startY, width, height, maxIter } = task;
  const buffer = new Uint8ClampedArray(width * height * 4);

  let ptr = 0;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x0 = ((startX + px) / 1000) * 3.5 - 2.5;
      const y0 = ((startY + py) / 1000) * 2.0 - 1.0;
      let x = 0, y = 0, iter = 0;

      while (x * x + y * y <= 4 && iter < maxIter) {
        const xTemp = x * x - y * y + x0;
        y = 2 * x * y + y0;
        x = xTemp;
        iter++;
      }

      const color = iter === maxIter ? 0 : (iter / maxIter) * 255;
      buffer[ptr++] = color;         // Red
      buffer[ptr++] = color * 0.5;   // Green
      buffer[ptr++] = 255 - color;   // Blue
      buffer[ptr++] = 255;           // Alpha
    }
  }

  return buffer.buffer;
}

/**
 * Computes Monte Carlo random trials for Pi estimation.
 */
function computeMonteCarlo(samples) {
  let insideCount = 0;
  for (let i = 0; i < samples; i++) {
    const x = Math.random();
    const y = Math.random();
    if (x * x + y * y <= 1) {
      insideCount++;
    }
  }
  return insideCount;
}