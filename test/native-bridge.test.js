const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  send(message) { this.sent.push(JSON.parse(message)); }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen(); }
  message(message) { this.onmessage({ data: JSON.stringify(message) }); }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose({ code: 1006 });
  }
}

function createBridge() {
  FakeWebSocket.instances = [];
  const timers = [];
  const context = {
    WebSocket: FakeWebSocket,
    window: {},
    console: { warn() {} },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
    clearTimeout() {}
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'js/network/native-bridge.js'), 'utf8');
  vm.runInNewContext(source, context);
  return { Bridge: context.window.TCNativeBridge, timers };
}

function createDispatcher() {
  const timers = [];
  const context = {
    window: {},
    console,
    TC_CONFIG: { TASK_TIMEOUT_MS: 10000 },
    tcMakeMessage(type, payload = {}) { return { type, payload }; },
    TC_MSG: { TASK_ASSIGN: 'task_assign', NO_WORK: 'no_work', JOB_INIT: 'job_init' },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {}
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'js/host/dispatcher.js'), 'utf8');
  vm.runInNewContext(source, context);
  const sent = [];
  const transport = { send(peerId, message) { sent.push({ peerId, message }); } };
  return { dispatcher: new context.window.TCDispatcher(transport, {}), sent };
}

test('relay close removes native peers before reconnecting', () => {
  const { Bridge, timers } = createBridge();
  const leaves = [];
  const bridge = new Bridge();
  bridge.init({
    relayUrl: 'ws://relay.test/ws', role: 'host', roomCode: 'ROOM',
    onPeerLeave: (peerId) => leaves.push(peerId)
  });

  const first = FakeWebSocket.instances[0];
  first.open();
  assert.deepEqual(first.sent, [{ kind: 'join', role: 'host', room: 'ROOM' }]);
  first.message({ kind: 'joined', peerId: 'host' });
  first.message({ kind: 'peer-join', peerId: 'native-a' });
  first.message({ kind: 'peer-join', peerId: 'native-b' });

  first.close();

  assert.deepEqual(leaves, ['native-a', 'native-b']);
  assert.equal(bridge.peers.size, 0);
  assert.equal(bridge.selfId, null);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 1000);

  timers[0].fn();
  const replacement = FakeWebSocket.instances[1];
  replacement.open();
  assert.deepEqual(replacement.sent, [{ kind: 'join', role: 'host', room: 'ROOM' }]);
});

test('destroy cancels reconnect and does not leave peers registered', () => {
  const { Bridge, timers } = createBridge();
  const leaves = [];
  const bridge = new Bridge();
  bridge.init({
    relayUrl: 'ws://relay.test/ws', role: 'host', roomCode: 'ROOM',
    onPeerLeave: (peerId) => leaves.push(peerId)
  });

  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message({ kind: 'peer-join', peerId: 'native-a' });
  bridge.destroy();

  assert.deepEqual(leaves, ['native-a']);
  assert.equal(bridge.peers.size, 0);
  assert.equal(timers.length, 0);
});

test('a duplicate task request cannot give one worker multiple chunks', () => {
  const { dispatcher, sent } = createDispatcher();
  dispatcher.currentJob = 'test-job';
  dispatcher.total = 2;
  dispatcher.queue = [{ id: 'one' }, { id: 'two' }];

  dispatcher.handleTaskRequest('native-a');
  dispatcher.handleTaskRequest('native-a');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.type, 'task_assign');
  assert.equal(sent[0].message.payload.id, 'one');

  dispatcher.handleTaskResult('native-a', { id: 'one', result: {} });
  dispatcher.handleTaskRequest('native-a');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].message.type, 'task_assign');
  assert.equal(sent[1].message.payload.id, 'two');
});
