export class CanvasPainter {
  constructor(canvasId = 'renderCanvas') {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
  }

  drawTile(buffer, startX, startY, width = 120, height = 120) {
    if (!this.ctx) {
      this.canvas = document.getElementById('renderCanvas');
      if (this.canvas) this.ctx = this.canvas.getContext('2d');
    }
    const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
    this.ctx.putImageData(imageData, startX, startY);
  }
}

// Standalone function used directly by Dispatcher
const painter = new CanvasPainter('renderCanvas');
export function paintChunk(buffer, startX, startY, width = 120, height = 120) {
  painter.drawTile(buffer, startX, startY, width, height);
}