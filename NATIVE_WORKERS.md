# Native (outside-the-browser) workers

Browser tabs are sandboxed on purpose - no filesystem, no arbitrary native
code, throttled CPU. To get real hardware access (all CPU cores, numpy,
GPU bindings), a worker has to be an actual OS process instead of a tab.
Since a plain Python process can't easily join WebRTC, it connects through
a small relay instead - bundled into the SAME server that serves the app,
so there's one URL and one process to run, not two.

```
Browser (host/worker)  ──HTTP───▶  server/server.js  ◀──WebSocket (/ws)──  native-worker/worker.py
```

## 1. Run the server

```bash
cd server
npm install
node server.js
```
```
[tabcluster] serving the app AND the native-worker relay on:
  http://localhost:8000/         (open this - or your LAN IP - to host or join)
  ws://localhost:8000/ws         (auto-filled for you on the host page)
```

Open `http://localhost:8000/` (or your machine's LAN IP if teammates are
joining from other devices - `localhost` only ever means something on one
machine). Nothing else needs typing: the host page auto-fills the "Relay
URL" field with `ws://<same host>:8000/ws` since it was loaded from this
exact server.

## 2. Enable the native bridge on the host page

Click **Enable native worker bridge** on the "Native workers" card - the
relay URL is already filled in for you.

## 3. Start a Python worker

```bash
cd native-worker
pip install -r requirements.txt
python3 worker.py ws://<server-host>:8000/ws <ROOM_CODE>
```

Run this on as many machines as you want - each one is a real OS process
with full hardware access, pulling tasks from the same queue as any
browser-tab workers in the room.

## Optional NVIDIA GPU acceleration

Native workers automatically select CuPy when it is installed and a CUDA GPU
is usable; otherwise they use NumPy on the CPU. No separate worker command or
host configuration is needed. The startup log states the selected backend, and
the host page lists each connected native worker as `GPU (<device>)` or `CPU
(NumPy)` in the Native workers card.

For a CUDA 12 worker with a compatible NVIDIA driver:

```bash
pip install -r requirements.txt -r requirements-cuda12.txt
```

For other CUDA versions, install the matching CuPy wheel using the
[CuPy installation guide](https://docs.cupy.dev/en/stable/install.html), then
start the worker normally. Keep GPU dependencies off CPU-only machines.

The built-in Mandelbrot and Monte Carlo jobs use the selected array backend.
Custom Python job functions can use `xp` (CuPy or NumPy), `GPU_AVAILABLE`,
`GPU_BACKEND`, and `to_host(value)`, which are injected by `worker.py` before
your function is compiled. Return ordinary JSON data; call `to_host` on an
array before converting it to a list or scalar.

## Writing a job that runs on native workers

The custom-job builder has two function boxes: **JavaScript** (compiled
in-browser via `new Function`) and **Python** (compiled in the worker via
`exec`, must define a top-level `run(task)`). A job only runs on native
workers if you fill in the Python box - leave it blank and native workers
will just wait, requesting work again every ~1s, until a job with a
Python function arrives.

The built-in Mandelbrot and Monte Carlo demos already ship both versions -
the Python ones use numpy for vectorized array math instead of a
pixel-by-pixel loop, which is the actual point of running outside the
browser: whole-array C operations instead of interpreted JS, and a clean
slot to swap in CuPy for GPU acceleration later since CuPy mirrors numpy's
API almost exactly.

## Blender render demo

The host page also has a **Blender render demo** card. Select a
self-contained `.blend` animation, choose an inclusive frame range, and the
host uploads the scene once to its local server. Native workers download that
scene, render their assigned frame ranges with `blender -b`, and upload PNG
results for the host page to link to.

Blender must be installed and available as `blender` on each native worker's
`PATH` (or set `BLENDER_BIN` to the executable path). This demo intentionally targets simple self-contained scenes; linked
libraries, external textures, fonts, caches, and add-ons are not packaged.

## Trust note

The function text a native worker executes comes from whoever is hosting
the room - same trust model as a BullMQ worker trusting the job processor
code its queue hands it, or a Dask worker trusting the scheduler. Only
point a Python worker at a relay/room you trust.
