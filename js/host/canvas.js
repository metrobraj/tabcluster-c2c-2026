export class CanvasManager {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
  }

  drawTile(startX, startY, width, height, buffer) {
    const imgData = new ImageData(new Uint8ClampedArray(buffer), width, height);
    this.ctx.putImageData(imgData, startX, startY);
  }

  clear() {
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
}