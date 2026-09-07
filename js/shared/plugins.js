// js/shared/plugins.js
// The "Big 5" workload templates. Each plugin defines split(params), which
// turns a job's parameters into an array of plain task descriptors - and
// nothing else. The actual per-task computation is NOT baked in here; it's
// a JS function supplied at run time (see host UI "fnSource" textarea),
// compiled once per worker in math-worker.js and reused for every task -
// the same pattern as a Dask delayed() call or a BullMQ job processor.
// defaultResultType tells the dispatcher how to merge results back:
//   - 'canvas-tile': result is { pixels, width, height }, painted onto the canvas
//   - 'accumulate' : result is an object of numbers, summed across all tasks
//   - 'collect'    : result is arbitrary JSON, kept as a list (e.g. for CSV export)

const TC_PLUGINS = {
  frame2d3d: {
    name: '2D/3D Frame Splitter',
    description: 'Divides visual coordinates (X, Y) or bounding boxes into pixel/voxel chunks.',
    defaultResultType: 'canvas-tile',
    // params: { width, height, tileSize }
    split({ width, height, tileSize }) {
      const tasks = [];
      for (let y = 0; y < height; y += tileSize) {
        for (let x = 0; x < width; x += tileSize) {
          tasks.push({
            x, y,
            width: Math.min(tileSize, width - x),
            height: Math.min(tileSize, height - y),
            canvasWidth: width,
            canvasHeight: height
          });
        }
      }
      return tasks;
    }
  },

  dataStream: {
    name: 'Data Stream Splitter',
    description: 'Splits a huge file/dataset by row ranges or byte offsets.',
    defaultResultType: 'collect',
    // params: { totalItems, chunkSize }
    split({ totalItems, chunkSize }) {
      const tasks = [];
      for (let start = 0; start < totalItems; start += chunkSize) {
        tasks.push({ rangeStart: start, rangeEnd: Math.min(start + chunkSize, totalItems) });
      }
      return tasks;
    }
  },

  paramGrid: {
    name: 'Parameter Grid Splitter',
    description: 'Generates combinations of numbers/variables for a grid search.',
    defaultResultType: 'collect',
    // params: { dimensions: [{ name, values: [...] }], chunkSize }
    split({ dimensions, chunkSize = 50 }) {
      let combos = [{}];
      for (const dim of dimensions) {
        const next = [];
        for (const combo of combos) {
          for (const v of dim.values) next.push({ ...combo, [dim.name]: v });
        }
        combos = next;
      }
      const tasks = [];
      for (let i = 0; i < combos.length; i += chunkSize) {
        tasks.push({ combos: combos.slice(i, i + chunkSize) });
      }
      return tasks;
    }
  },

  rangeKey: {
    name: 'Range/Key Splitter',
    description: 'Generates incremental search ranges (e.g. key space, prime candidates).',
    defaultResultType: 'collect',
    // params: { start, end, step }
    split({ start, end, step }) {
      const tasks = [];
      for (let s = start; s < end; s += step) {
        tasks.push({ rangeStart: s, rangeEnd: Math.min(s + step, end) });
      }
      return tasks;
    }
  },

  miniBatch: {
    name: 'Mini-Batch Splitter',
    description: 'Slices a dataset into small batches (e.g. for training or sampling).',
    defaultResultType: 'accumulate',
    // params: { datasetSize, batchSize }
    split({ datasetSize, batchSize }) {
      const tasks = [];
      for (let start = 0; start < datasetSize; start += batchSize) {
        tasks.push({ batchStart: start, batchEnd: Math.min(start + batchSize, datasetSize) });
      }
      return tasks;
    }
  }
};

if (typeof window !== 'undefined') window.TC_PLUGINS = TC_PLUGINS;
