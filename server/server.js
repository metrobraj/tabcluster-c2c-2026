// ...existing code...
process.env.NO_OPEN = process.env.NO_OPEN || '1';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 8000;
const ROOT = path.join(__dirname, '..'); // project root: index.html, js/, etc.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

// --- Static file serving ---
function serveStatic(req, res) {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.join(ROOT, reqPath);
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

// helper to safely send and prune dead sockets
function safeSend(targetWs, msg, onFail) {
  try {
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(msg);
      return true;
    }
  } catch (err) { /* fallthrough to cleanup */ }
  try { if (targetWs) targetWs.terminate(); } catch {}
  if (onFail) onFail();
  return false;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let room = null;
  let role = null;
  let peerId = null;

  ws.on('message', (raw) => {
    const text = (typeof raw === 'string') ? raw : raw.toString();
    let data;
    try { data = JSON.parse(text); } catch { return; }

    if (data.kind === 'join') {
      role = data.role;
      room = getRoom(data.room);

      if (role === 'host') {
        room.host = ws;
        peerId = 'host';
        safeSend(ws, JSON.stringify({ kind: 'joined', peerId }));
        for (const wId of room.workers.keys()) {
          safeSend(ws, JSON.stringify({ kind: 'peer-join', peerId: wId }));
        }
      } else {
        peerId = randomPeerId();
        room.workers.set(peerId, ws);
        safeSend(ws, JSON.stringify({ kind: 'joined', peerId }));
        if (room.host) safeSend(room.host, JSON.stringify({ kind: 'peer-join', peerId }));
      }
      console.log(`[relay] ${role} joined room ${data.room} as ${peerId}`);
      return;
    }

    if (data.kind === 'msg' && room) {
      const envelope = JSON.stringify({ kind: 'msg', from: peerId, message: data.message });

      if (role !== 'host' && (data.to === 'host' || data.to === 'broadcast')) {
        if (room.host) safeSend(room.host, envelope);
      }
      if (data.to === 'broadcast') {
        for (const [wId, wsW] of room.workers.entries()) {
          if (wId !== peerId) {
            const ok = safeSend(wsW, envelope, () => room.workers.delete(wId));
            if (!ok) room.workers.delete(wId);
          }
        }
      } else if (data.to && data.to !== 'host' && data.to !== 'broadcast') {
        const target = room.workers.get(data.to);
        if (target) {
          const ok = safeSend(target, envelope, () => room.workers.delete(data.to));
          if (!ok) room.workers.delete(data.to);
        }
      }
    }
  });

  ws.on('close', () => {
    if (!room) return;
    if (role === 'host') {
      room.host = null;
      console.log('[relay] host disconnected');
    } else if (peerId) {
      room.workers.delete(peerId);
      if (room.host) safeSend(room.host, JSON.stringify({ kind: 'peer-leave', peerId }));
      console.log(`[relay] worker ${peerId} disconnected`);
    }
  });
});

// heartbeat interval
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((s) => {
    if (s.isAlive === false) return s.terminate();
    s.isAlive = false;
    try { s.ping(); } catch (e) {}
  });
}, 30000);

server.on('close', () => clearInterval(heartbeatInterval));

server.listen(PORT, () => {
  console.log(`[tabcluster] serving the app AND the native-worker relay on:`);
  console.log(`  http://localhost:${PORT}/         (open this - or your LAN IP - to host or join)`);
  console.log(`  ws://localhost:${PORT}/ws         (auto-filled for you on the host page)`);
});

// Opens the default browser to the local URL so you don't have to copy/paste it.
// Set NO_OPEN=1 to skip this.
function maybeOpenBrowser(url) {
  if (process.env.NO_OPEN) return;

  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open'
    : platform === 'win32' ? 'start'
    : 'xdg-open';

  const { exec } = require('child_process');
  const fullCmd = platform === 'win32' ? `start "" "${url}"` : `${cmd} "${url}"`;

  exec(fullCmd, (err) => {
    if (err) {
      console.log(`[tabcluster] couldn't auto-open a browser (${err.message}) - just open ${url} yourself.`);
    }
  });
}
// ...existing code...