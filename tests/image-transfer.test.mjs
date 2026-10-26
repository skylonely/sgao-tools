import test from 'node:test';
import assert from 'node:assert/strict';
import { sendToCompressor, receiveCropFile } from '../src/image-transfer.js';

function setup() {
  const old = { window: globalThis.window, location: globalThis.location, history: globalThis.history };
  const listeners = new Map();
  const window = { addEventListener(name, handler) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(handler); }, removeEventListener(name, handler) { listeners.get(name)?.delete(handler); }, opener: null };
  globalThis.window = window; globalThis.location = { origin: 'https://tools.sgao.cc', pathname: '/image-compressor/', search: '?from=crop', hash: '' }; globalThis.history = { replaceState() {} };
  return { window, listeners, emit(event) { for (const handler of [...(listeners.get('message') || [])]) handler(event); }, restore() { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } } };
}

test('sender only transfers the requested file to the expected same-origin window and one-use token', async () => {
  const env = setup(), messages = [], popup = { postMessage(data, origin) { messages.push({ data, origin }); } };
  let destination;
  env.window.open = url => { destination = url; return popup; };
  try {
    const file = new File(['pixels'], 'crop.png', { type: 'image/png' }), result = sendToCompressor(file), token = destination.split('=')[1];
    const ready = { origin: location.origin, source: popup, data: { type: 'sgao-crop-transfer:ready', token } };
    env.emit({ ...ready, origin: 'https://other.example' }); env.emit({ ...ready, source: {} }); env.emit({ ...ready, data: { ...ready.data, token: 'wrong' } });
    assert.equal(messages.length, 0);
    env.emit(ready); assert.equal(messages.length, 1); assert.equal(messages[0].data.file, file); assert.equal(messages[0].origin, location.origin);
    env.emit({ ...ready, data: { type: 'sgao-crop-transfer:received', token } }); await result;
    assert.equal(env.listeners.get('message').size, 0);
    assert.equal(env.listeners.get('pagehide').size, 0);
  } finally { env.restore(); }
});

test('receiver rejects unrelated messages, clears the token URL, receives once and releases its opener', () => {
  const env = setup(), messages = [], token = 'a1234567-1234-4567-8910-123456789abc';
  const sender = { postMessage(data, origin) { messages.push({ data, origin }); } }; env.window.opener = sender; location.hash = `#crop-transfer=${token}`;
  let received = [], paths = []; history.replaceState = (state, title, path) => paths.push(path);
  try {
    receiveCropFile(file => received.push(file), message => assert.fail(message));
    assert.deepEqual(paths, ['/image-compressor/?from=crop']);
    assert.equal(messages[0].data.type, 'sgao-crop-transfer:ready');
    const file = new File(['pixels'], 'crop.webp', { type: 'image/webp' }), message = { origin: location.origin, source: sender, data: { type: 'sgao-crop-transfer:file', token, file } };
    env.emit({ ...message, origin: 'https://other.example' }); env.emit({ ...message, source: {} }); env.emit({ ...message, data: { ...message.data, token: 'wrong' } });
    assert.equal(received.length, 0);
    env.emit(message); env.emit(message);
    assert.deepEqual(received, [file]); assert.equal(env.window.opener, null); assert.equal(messages[1].data.type, 'sgao-crop-transfer:received');
    assert.equal(env.listeners.get('message').size, 0);
  } finally { env.restore(); }
});

test('blocked popups and direct transfer links have usable errors without hanging listeners', async () => {
  const env = setup();
  try {
    env.window.open = () => null;
    await assert.rejects(sendToCompressor(new File(['x'], 'crop.jpg')), /浏览器阻止/);
    assert.equal(env.listeners.get('message').size, 0);
    location.hash = '#crop-transfer=invalid'; let message;
    receiveCropFile(() => assert.fail('unexpected file'), error => { message = error; });
    assert.match(message, /未收到裁剪图片/);
  } finally { env.restore(); }
});
