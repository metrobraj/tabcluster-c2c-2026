export class CanvasPainter {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
  }

  // Takes raw Uint8ClampedArray pixels and draws them at specific coordinates
  drawTile(startX, startY, width, height, pixelBuffer) {
    // Create an ImageData object from raw binary bytes
    const imageData = new ImageData(
      new Uint8ClampedArray(pixelBuffer),
      width,
      height
    );
    // Paint directly onto canvas at target coordinates
    this.ctx.putImageData(imageData, startX, startY);
  }
}