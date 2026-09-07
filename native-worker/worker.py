#!/usr/bin/env python3
"""
native-worker/worker.py

A real OS process (not a browser tab) that joins a tabCluster room and pulls
tasks exactly like a browser worker does - request work, compute, ship the
result back, request more - except this one has actual hardware access:
every CPU core, numpy/BLAS, GPU bindings if you add them, disk, whatever
the box allows. It talks to the same dispatcher.js you already have via the
WebSocket relay (relay-server/server.js), which just forwards messages -
it doesn't know or care that this peer isn't a browser tab.

Usage:
    pip install websockets
    python3 worker.py ws://<relay-host>:8765 <ROOM_CODE>

The per-task function comes from the host as Python SOURCE TEXT (the
"Python function" box in the custom-job builder, or the built-in
Mandelbrot/Monte Carlo jobs) and must define a top-level `run(task)`
function returning a JSON-serializable result - same contract as the
JS-side `new Function('task', fnSource)` worker, just Python instead.
"""

import asyncio
import json
import sys
import time

import websockets

TASK_REQUEST = 'task_request'
TASK_ASSIGN = 'task_assign'
TASK_RESULT = 'task_result'
NO_WORK = 'no_work'
HEARTBEAT_PING = 'heartbeat_ping'
HEARTBEAT_PONG = 'heartbeat_pong'
JOB_INIT = 'job_init'
CAPABILITIES_REQUEST = 'capabilities_request'
WORKER_CAPABILITIES = 'worker_capabilities'


class ArrayBackend:
    """The array library exposed to trusted Python job functions as ``xp``."""

    def __init__(self, module, name, device_name=None):
        self.module = module
        self.name = name
        self.device_name = device_name

    @property
    def is_gpu(self):
        return self.name == 'cupy'

    def to_host(self, value):
        """Copy a GPU value to host memory; leave NumPy values untouched."""
        return self.module.asnumpy(value) if self.is_gpu else value


def detect_array_backend():
    """Prefer an available CUDA/CuPy device, otherwise use the CPU via NumPy.

    CuPy wheels are CUDA-version-specific and deliberately optional. A worker
    therefore remains usable on machines without an NVIDIA GPU or CuPy.
    """
    try:
        import cupy as cp  # Optional: installed only on CUDA-capable workers.

        if cp.cuda.runtime.getDeviceCount() > 0:
            device = cp.cuda.Device()
            attrs = cp.cuda.runtime.getDeviceProperties(device.id)
            name = attrs['name'].decode() if isinstance(attrs['name'], bytes) else attrs['name']
            return ArrayBackend(cp, 'cupy', name)
    except ImportError:
        pass
    except Exception as exc:  # Missing CuPy, driver mismatch, or no CUDA device.
        print(f'[native-worker] GPU unavailable ({exc}); using NumPy CPU backend')

    import numpy as np
    return ArrayBackend(np, 'numpy')


ARRAY_BACKEND = detect_array_backend()


def worker_capabilities():
    """A JSON-safe hardware summary the host can display in its UI."""
    return {
        'backend': ARRAY_BACKEND.name,
        'hasGpu': ARRAY_BACKEND.is_gpu,
        'deviceName': ARRAY_BACKEND.device_name,
    }


def make_message(msg_type, payload=None):
    return {'type': msg_type, 'payload': payload or {}, 'ts': int(time.time() * 1000)}


async def run_worker(relay_url, room_code):
    self_id = None
    user_fn = None

    async with websockets.connect(relay_url) as ws:

        async def send_to_host(message):
            await ws.send(json.dumps({'kind': 'msg', 'to': 'host', 'message': message}))

        await ws.send(json.dumps({'kind': 'join', 'role': 'worker', 'room': room_code}))

        async for raw in ws:
            data = json.loads(raw)
            kind = data.get('kind')

            if kind == 'joined':
                self_id = data['peerId']
                print(f"[native-worker] joined room {room_code} as {self_id}")
                backend_label = ARRAY_BACKEND.name
                if ARRAY_BACKEND.device_name:
                    backend_label += f' ({ARRAY_BACKEND.device_name})'
                print(f'[native-worker] compute backend: {backend_label}')
                await send_to_host(make_message(WORKER_CAPABILITIES, worker_capabilities()))
                await send_to_host(make_message(TASK_REQUEST))
                continue

            if kind != 'msg':
                continue

            message = data['message']
            mtype = message.get('type')
            payload = message.get('payload', {})

            if mtype == JOB_INIT:
                src = payload.get('pyFnSource')
                if not src:
                    print('[native-worker] job has no Python function - waiting for one that does')
                    user_fn = None
                    continue
                # Custom source can use xp (CuPy or NumPy), GPU_AVAILABLE,
                # and to_host(value). This keeps GPU selection local to the
                # worker instead of baking one machine's hardware into a job.
                ns = {
                    'xp': ARRAY_BACKEND.module,
                    'GPU_AVAILABLE': ARRAY_BACKEND.is_gpu,
                    'GPU_BACKEND': ARRAY_BACKEND.name,
                    'to_host': ARRAY_BACKEND.to_host,
                }
                try:
                    exec(src, ns)  # noqa: S102 - trusted host, see README trust note
                    user_fn = ns['run']
                    print('[native-worker] compiled job function, ready')
                except Exception as e:
                    print(f'[native-worker] failed to compile job function: {e}')
                    user_fn = None

            elif mtype == CAPABILITIES_REQUEST:
                await send_to_host(make_message(WORKER_CAPABILITIES, worker_capabilities()))

            elif mtype == TASK_ASSIGN:
                task = payload
                if user_fn is None:
                    # No Python function for this job - ask again shortly
                    # rather than losing our place in the queue forever.
                    await asyncio.sleep(1.0)
                    await send_to_host(make_message(TASK_REQUEST))
                    continue
                try:
                    result = user_fn(task)
                    await send_to_host(make_message(TASK_RESULT, {
                        'id': task['id'], 'jobType': task.get('jobType'), 'result': result
                    }))
                except Exception as e:
                    await send_to_host(make_message(TASK_RESULT, {
                        'id': task['id'], 'jobType': task.get('jobType'), 'error': str(e)
                    }))
                await send_to_host(make_message(TASK_REQUEST))

            elif mtype == NO_WORK:
                await asyncio.sleep(1.5)
                await send_to_host(make_message(TASK_REQUEST))

            elif mtype == HEARTBEAT_PING:
                await send_to_host(make_message(HEARTBEAT_PONG))


if __name__ == '__main__':
    # 1. Parse arguments to define relay_url and room_code
    relay_url = sys.argv[1] if len(sys.argv) > 1 else 'ws://localhost:8000/ws'
    room_code = sys.argv[2] if len(sys.argv) > 2 else input('Room code: ').strip().upper()
    
    print(f"[native-worker] connecting to {relay_url}, room {room_code}...")
    
    # 2. Wrap the worker execution in an infinite loop
    while True:
        try:
            asyncio.run(run_worker(relay_url, room_code))
        except Exception as e:
            print(f"Worker crashed or disconnected: {e}. Restarting...")
        
        # Brief pause before reconnecting to the host for the next task
        time.sleep(1)
