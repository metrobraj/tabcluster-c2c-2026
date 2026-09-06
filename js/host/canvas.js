// js/host/canvas.js
// Paints Mandelbrot tiles onto the host canvas as raw pixel buffers come
// back from workers. Each tile is blitted directly with putImageData -
// no per-pixel JS drawing calls on the host side.
// js/host/canvas.js

class TCCanvasPainter {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.canvas.width = TC_CONFIG.CANVAS_WIDTH;
    this.canvas.height = TC_CONFIG.CANVAS_HEIGHT;
  }

  clear() {
    this.ctx.fillStyle = '#0b0d16';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  paintTile(tile, pixelBuffer) {
    const { x, y, width, height } = tile;
    const clamped = pixelBuffer instanceof Uint8ClampedArray
      ? pixelBuffer
      : new Uint8ClampedArray(pixelBuffer);
    const imageData = new ImageData(clamped, width, height);
    this.ctx.putImageData(imageData, x, y);
  }

  /**
   * Renders real-time Monte Carlo Pi convergence graph onto the main canvas.
   * @param {Array<{chunk: number, pi: number}>} history 
   */
  drawMonteCarloGraph(history) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear background
    this.clear();

    const truePiY = h / 2;

    // Draw baseline for true Pi (3.14159)
    ctx.strokeStyle = '#fff700'; // Cyan line
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, truePiY);
    ctx.lineTo(w, truePiY);
    ctx.stroke();

    ctx.fillStyle = '#fff700';
    ctx.font = '16px "Space Grotesk", sans-serif';
    ctx.fillText('Target π ≈ 3.14159', 20, truePiY - 12);

    if (history.length < 2) return;

    // Plot historical convergence curve
    ctx.strokeStyle = '#f69bfa'; // Amber line
    ctx.lineWidth = 3;
    ctx.beginPath();

    const totalChunks = (typeof TC_CONFIG !== 'undefined' && TC_CONFIG.MONTE_CARLO_CHUNKS) ? TC_CONFIG.MONTE_CARLO_CHUNKS : 50;
    const xStep = w / totalChunks;
    const scaleY = 15000; // Sensitivity height multiplier

    history.forEach((point, i) => {
      const x = i * xStep;
      const diff = point.pi - Math.PI;
      const y = truePiY - (diff * scaleY);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // Plot current trajectory dot
    const last = history[history.length - 1];
    const lastX = (history.length - 1) * xStep;
    const lastY = truePiY - ((last.pi - Math.PI) * scaleY);

    ctx.fillStyle = '#f69bfa';
    ctx.beginPath();
    ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

if (typeof window !== 'undefined') window.TCCanvasPainter = TCCanvasPainter;