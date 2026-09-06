// js/worker/math-worker.js
self.onmessage = function(event) {
    console.log("[MathWorker] Task received:", event.data);
    // Receives the chunk coordinates
    const { startX, startY, width, height, maxIter } = event.data;
    
    // Creates the raw binary array output
    const pixelBuffer = new Uint8ClampedArray(width * height * 4);
    let offset = 0;

    // 5. Executes Mandelbrot math
    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            let x0 = ((startX + px) / width) * 3.5 - 2.5;
            let y0 = ((startY + py) / height) * 2.0 - 1.0;
            let x = 0, y = 0, iteration = 0;

            while (x * x + y * y <= 4 && iteration < maxIter) {
                let xTemp = x * x - y * y + x0;
                y = 2 * x * y + y0;
                x = xTemp;
                iteration++;
            }

            // Maps the iterations to a grayscale color
            const color = iteration === maxIter ? 0 : (iteration * 255) / maxIter;

            pixelBuffer[offset] = color;     // Red
            pixelBuffer[offset + 1] = color; // Green
            pixelBuffer[offset + 2] = color; // Blue
            pixelBuffer[offset + 3] = 255;   // Alpha (Opacity)

            offset += 4;
        }
    }

    console.log("[MathWorker] Math finished! Buffer length:", pixelBuffer.length);
    // 5. Outputs Uint8ClampedArray back to workermain.js
    self.postMessage(pixelBuffer);
};