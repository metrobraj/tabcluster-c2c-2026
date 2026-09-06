self.onmessage = function(e) {
  const { id, startX, startY, width, height, hostPeerId } = e.data;
  
  // Generate fake pixel color data
  const buffer = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = (startX + i) % 255;
    buffer[i + 1] = (startY + i) % 255;
    buffer[i + 2] = 200;
    buffer[i + 3] = 255;
  }

  // Post back array buffer
  self.postMessage({ id, buffer: buffer.buffer, hostPeerId }, [buffer.buffer]);
};