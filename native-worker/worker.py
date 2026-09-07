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
                ns = {}
                try:
                    exec(src, ns)  # noqa: S102 - trusted host, see README trust note
                    user_fn = ns['run']
                    print('[native-worker] compiled job function, ready')
                except Exception as e:
                    print(f'[native-worker] failed to compile job function: {e}')
                    user_fn = None

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


def main():
    relay_url = sys.argv[1] if len(sys.argv) > 1 else 'ws://localhost:8000/ws'
    room_code = sys.argv[2] if len(sys.argv) > 2 else input('Room code: ').strip().upper()
    print(f"[native-worker] connecting to {relay_url}, room {room_code}...")
    asyncio.run(run_worker(relay_url, room_code))


if __name__ == '__main__':
    main()
