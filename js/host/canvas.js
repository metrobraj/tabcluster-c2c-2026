// js/host/canvas.js
// Paints Mandelbrot tiles onto the host canvas as raw pixel buffers come
// back from workers. Each tile is blitted directly with putImageData -
// no per-pixel JS drawing calls on the host side.

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

  // Blender workers return finished PNG files rather than raw pixel tiles.
  // Show the newest completed frame in the same stage used by Mandelbrot so
  // the host gets a live, visual indication that the distributed render is
  // progressing.
  previewImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        this.canvas.width = image.naturalWidth;
        this.canvas.height = image.naturalHeight;
        this.ctx.drawImage(image, 0, 0);
        resolve();
      };
      image.onerror = () => reject(new Error('Could not load rendered frame preview.'));
      image.src = src;
    });
  }
}

if (typeof window !== 'undefined') window.TCCanvasPainter = TCCanvasPainter;
