// js/shared/builtin-fns.js
// The original Mandelbrot/Monte Carlo demos, re-expressed as plain
// function SOURCE TEXT rather than hardcoded worker logic - proving the
// plugin system in plugins.js can express everything the old hardcoded
// dispatcher/math-worker used to do. Each function returns a source
// string because job constants (viewport, maxIter) have to be baked
// into the text sent over the wire to workers; there are no closures
// once this crosses to another tab/device.

const TC_BUILTIN_FNS = {
  // Used with the frame2d3d plugin (resultType: 'canvas-tile').
  mandelbrot(maxIter, viewport) {
    return `
      const { x, y, width, height, canvasWidth, canvasHeight } = task;
      const xMin = ${viewport.xMin}, xMax = ${viewport.xMax};
      const yMin = ${viewport.yMin}, yMax = ${viewport.yMax};
      const maxIter = ${maxIter};
      const pixels = new Array(width * height * 4);

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
      return { pixels, width, height };
    `;
  },

  // Used with the miniBatch plugin (resultType: 'accumulate').
  monteCarlo() {
    return `
      const { batchStart, batchEnd } = task;
      const samples = batchEnd - batchStart;
      let state = (batchStart >>> 0) || 1;

      function rand() {
        state |= 0;
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      }

      let insideCount = 0;
      for (let i = 0; i < samples; i++) {
        const px = rand() * 2 - 1, py = rand() * 2 - 1;
        if (px * px + py * py <= 1) insideCount++;
      }
      return { insideCount, samples };
    `;
  },

  // --- Python equivalents, for native (non-browser) workers. `xp` is
  // injected by worker.py: CuPy on a CUDA-capable worker, NumPy otherwise.
  // `to_host` makes the final result JSON-serializable without forcing
  // custom jobs to care whether their arrays originated on a GPU or CPU.

  mandelbrotPy(maxIter, viewport) {
    return `
def run(task):
    x, y, width, height = task['x'], task['y'], task['width'], task['height']
    canvas_width, canvas_height = task['canvasWidth'], task['canvasHeight']
    x_min, x_max = ${viewport.xMin}, ${viewport.xMax}
    y_min, y_max = ${viewport.yMin}, ${viewport.yMax}
    max_iter = ${maxIter}

    px = xp.arange(x, x + width)
    py = xp.arange(y, y + height)
    cx = x_min + (px / canvas_width) * (x_max - x_min)
    cy = y_min + (py / canvas_height) * (y_max - y_min)
    cx, cy = xp.meshgrid(cx, cy)

    zx = xp.zeros_like(cx)
    zy = xp.zeros_like(cy)
    iters = xp.zeros(cx.shape, dtype=xp.int32)

    for i in range(max_iter):
        zx2, zy2 = zx * zx, zy * zy
        mask = (zx2 + zy2) <= 4
        if not bool(mask.any()):
            break
        zy[mask] = 2 * zx[mask] * zy[mask] + cy[mask]
        zx[mask] = zx2[mask] - zy2[mask] + cx[mask]
        iters[mask] += 1

    t = iters / max_iter
    pixels = xp.zeros((height, width, 4), dtype=xp.uint8)
    done = iters >= max_iter
    pixels[done] = [6, 6, 14, 255]
    pixels[~done, 0] = (9 * (1 - t[~done]) * t[~done]**3 * 255).astype(np.uint8)
    pixels[~done, 1] = (15 * (1 - t[~done])**2 * t[~done]**2 * 255).astype(np.uint8)
    pixels[~done, 2] = (140 + 115 * t[~done]).astype(np.uint8)
    pixels[~done, 3] = 255

    return {'pixels': to_host(pixels).ravel().tolist(), 'width': width, 'height': height}
`;
  },

  monteCarloPy() {
    return `
def run(task):
    samples = task['batchEnd'] - task['batchStart']
    rng = xp.random.default_rng(task['batchStart'])
    pts = rng.uniform(-1, 1, size=(samples, 2))
    inside = int(to_host(xp.count_nonzero((pts[:, 0]**2 + pts[:, 1]**2) <= 1)))
    return {'insideCount': inside, 'samples': samples}
`;
  },

  // Native-only demo: each task owns a small range of animation frames.
  // The .blend is downloaded from the host server once per worker process;
  // completed PNGs are sent back to that same server for the host UI.
  blenderRenderPy(assetUrl, uploadBaseUrl, assetId) {
    return `
def run(task):
    import json
    import os
    import shutil
    import subprocess
    import tempfile
    import urllib.request

    blender = os.environ.get('BLENDER_BIN') or shutil.which('blender')
    if not blender:
        raise RuntimeError('Blender is not installed or not on PATH (set BLENDER_BIN if needed)')

    work_dir = os.path.join(tempfile.gettempdir(), 'tabcluster-blender', '${assetId}')
    os.makedirs(work_dir, exist_ok=True)
    blend_path = os.path.join(work_dir, 'scene.blend')
    if not os.path.exists(blend_path):
        urllib.request.urlretrieve('${assetUrl}', blend_path)

    rendered = []
    for frame in range(task['rangeStart'], task['rangeEnd']):
        output_pattern = os.path.join(work_dir, 'frame_####')
        proc = subprocess.run(
            [blender, '-b', blend_path, '-o', output_pattern, '-F', 'PNG', '-f', str(frame)],
            capture_output=True, text=True, timeout=900
        )
        if proc.returncode != 0:
            raise RuntimeError('Blender failed on frame %s: %s' % (frame, proc.stderr[-500:]))
        png_path = os.path.join(work_dir, 'frame_%04d.png' % frame)
        if not os.path.exists(png_path):
            raise RuntimeError('Blender finished but did not create %s' % png_path)
        with open(png_path, 'rb') as image:
            request = urllib.request.Request(
                '${uploadBaseUrl}/api/render-output?asset=${assetId}&frame=' + str(frame),
                data=image.read(), method='POST', headers={'Content-Type': 'image/png'}
            )
            response = json.loads(urllib.request.urlopen(request, timeout=60).read())
        rendered.append({'frame': frame, 'url': response['url']})
    return {'frames': rendered}
`;
  }
};

if (typeof window !== 'undefined') window.TC_BUILTIN_FNS = TC_BUILTIN_FNS;
