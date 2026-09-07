// server/server.js
// ONE server, ONE URL: serves the tabCluster static site (index.html + js/)
// AND relays messages for native (non-browser) workers over WebSocket at
// /ws on the same port.
//
//   node server.js
//   -> open http://<this-machine-ip>:8000/          (host or worker, browser)
//   -> native workers connect to  ws://<this-machine-ip>:8000/ws
//
// Env: PORT (default 8000)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8000;
const ROOT = path.join(__dirname, '..'); // project root: index.html, js/, etc.
const UPLOADS = path.join(ROOT, '.tabcluster-assets');
const RENDERS = path.join(ROOT, '.tabcluster-renders');
const MAX_BLEND_BYTES = 100 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(RENDERS, { recursive: true });

function safeId(value) {
  return typeof value === 'string' && /^[a-f0-9]{24}$/.test(value) ? value : null;
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on('data', (chunk) => {
      length += chunk.length;
      if (length > maxBytes) {
        reject(new Error('Upload is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// --- Helper: Find local LAN IPv4 address ---
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// --- Static file serving ---
function serveStatic(req, res) {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.join(ROOT, reqPath);
  // Don't allow escaping the project root.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const reqUrl = req.url.split('?')[0];

  // API 1: Auto-detect server's LAN IP
  if (reqUrl === '/api/ip') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ip: getLocalIP() }));
    return;
  }

  // A deliberately small asset store for the self-contained Blender demo.
  // Workers download the .blend once, render their assigned frames, then
  // upload PNGs so the host can show results from every machine.
  if (reqUrl === '/api/blend-upload' && req.method === 'POST') {
    readBody(req, MAX_BLEND_BYTES).then((body) => {
      if (!body.length) throw new Error('The .blend file was empty');
      const assetId = require('crypto').randomBytes(12).toString('hex');
      fs.writeFileSync(path.join(UPLOADS, `${assetId}.blend`), body);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ assetId, assetUrl: `/assets/${assetId}.blend` }));
    }).catch((err) => {
      res.writeHead(err.message === 'Upload is too large' ? 413 : 400, { 'Content-Type': 'text/plain' });
      res.end(err.message);
    });
    return;
  }

  if (reqUrl === '/api/render-output' && req.method === 'POST') {
    const query = new URLSearchParams(req.url.split('?')[1] || '');
    const assetId = safeId(query.get('asset'));
    const frame = Number.parseInt(query.get('frame'), 10);
    if (!assetId || !Number.isInteger(frame) || frame < 0) {
      res.writeHead(400); res.end('Invalid asset or frame'); return;
    }
    readBody(req, 25 * 1024 * 1024).then((body) => {
      if (!body.length) throw new Error('Rendered PNG was empty');
      const dir = path.join(RENDERS, assetId);
      fs.mkdirSync(dir, { recursive: true });
      const fileName = `frame_${String(frame).padStart(4, '0')}.png`;
      fs.writeFileSync(path.join(dir, fileName), body);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: `/renders/${assetId}/${fileName}` }));
    }).catch((err) => { res.writeHead(400); res.end(err.message); });
    return;
  }

  const assetMatch = reqUrl.match(/^\/assets\/([a-f0-9]{24})\.blend$/);
  const renderMatch = reqUrl.match(/^\/renders\/([a-f0-9]{24})\/frame_(\d{4,})\.png$/);
  if (assetMatch || renderMatch) {
    const filePath = assetMatch
      ? path.join(UPLOADS, `${assetMatch[1]}.blend`)
      : path.join(RENDERS, renderMatch[1], `frame_${renderMatch[2]}.png`);
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': assetMatch ? 'application/octet-stream' : 'image/png' });
      res.end(data);
    });
    return;
  }

  // API 2: Spawn background native worker process
  if (reqUrl === '/api/spawn-worker') {
    const query = new URLSearchParams(req.url.split('?')[1] || '');
    const roomCode = query.get('room');
    const relayUrl = query.get('relay');

    if (!roomCode || !relayUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing "room" or "relay" query parameters');
      return;
    }

    try {
      const workerScript = path.join(ROOT, 'native-worker', 'worker.py');
      const child = spawn('python3', [workerScript, relayUrl, roomCode], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, pid: child.pid }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Failed to spawn worker: ${err.message}`);
    }
    return;
  }

  if (req.url.startsWith('/ws')) {
    res.writeHead(400);
    res.end('This is a WebSocket endpoint, not a page - use ws:// via the app, not a browser tab.');
    return;
  }
  serveStatic(req, res);
});

// --- Native worker relay, mounted at /ws on the same port ---
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// roomCode -> { host: ws|null, workers: Map<peerId, ws> }
const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { host: null, workers: new Map() });
  return rooms.get(code);
}

function randomPeerId() {
  return 'native-' + Math.random().toString(36).slice(2, 10);
}

wss.on('connection', (ws) => {
  let room = null;
  let role = null;
  let peerId = null;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.kind === 'join') {
      role = data.role;
      room = getRoom(data.room);

      if (role === 'host') {
        room.host = ws;
        peerId = 'host';
        ws.send(JSON.stringify({ kind: 'joined', peerId }));
        for (const wId of room.workers.keys()) {
          ws.send(JSON.stringify({ kind: 'peer-join', peerId: wId }));
        }
      } else {
        peerId = randomPeerId();
        room.workers.set(peerId, ws);
        ws.send(JSON.stringify({ kind: 'joined', peerId }));
        if (room.host) room.host.send(JSON.stringify({ kind: 'peer-join', peerId }));
      }
      console.log(`[relay] ${role} joined room ${data.room} as ${peerId}`);
      return;
    }

    if (data.kind === 'msg' && room) {
      const envelope = JSON.stringify({ kind: 'msg', from: peerId, message: data.message });

      if (role !== 'host' && (data.to === 'host' || data.to === 'broadcast')) {
        if (room.host) room.host.send(envelope);
      }
      if (data.to === 'broadcast') {
        for (const [wId, wsW] of room.workers.entries()) {
          if (wId !== peerId) wsW.send(envelope);
        }
      } else if (data.to && data.to !== 'host' && data.to !== 'broadcast') {
        const target = room.workers.get(data.to);
        if (target) target.send(envelope);
      }
    }
  });

  ws.on('close', () => {
    if (!room) return;
    if (role === 'host') {
      // A reconnect can replace this socket before the old connection's
      // close event reaches the relay. Do not clear the replacement host.
      if (room.host === ws) {
        room.host = null;
        console.log('[relay] host disconnected');
      }
    } else if (peerId) {
      room.workers.delete(peerId);
      if (room.host) room.host.send(JSON.stringify({ kind: 'peer-leave', peerId }));
      console.log(`[relay] worker ${peerId} disconnected`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[tabcluster] serving the app AND the native-worker relay on port ${PORT}:`);
  console.log(`  http://localhost:${PORT}/         (open locally to host or join)`);
  console.log(`  ws://localhost:${PORT}/ws         (relay endpoint)`);
});
