// js/worker/math-worker.js
self.onmessage = function(e) {
  const { taskId, startX, startY, width, height } = e.data;
  
  // Generate a fake 100x100 pixel buffer (RGBA color gradient)
  const buffer = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = (startX + i) % 255;     // Dynamic Red
    buffer[i + 1] = (startY + i) % 255; // Dynamic Green
    buffer[i + 2] = 200;               // Bright Blue
    buffer[i + 3] = 255;               // Full Visibility (Alpha)
  }

  // Pass the completed tile buffer back to worker-main.js
  self.postMessage({ taskId, buffer: buffer.buffer }, [buffer.buffer]);
};