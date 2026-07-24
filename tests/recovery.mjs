import assert from 'node:assert/strict';

const sentMessages = [];
const mediaDevices = {
  async getUserMedia() {
    throw new Error('No fake stream configured.');
  }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { mediaDevices }
});
globalThis.chrome = {
  runtime: {
    getURL: (path) => `chrome-extension://test/${path}`,
    onMessage: { addListener() {} },
    sendMessage: async (message) => {
      sentMessages.push(message);
      return { ok: true };
    }
  }
};

class FakeRecognition {
  start() {
    queueMicrotask(() => this.onstart?.());
  }

  abort() {}
}
globalThis.SpeechRecognition = FakeRecognition;

class FakeAudioNode {
  connect(node) {
    return node;
  }

  disconnect() {}
}

class FakeAnalyser extends FakeAudioNode {
  constructor() {
    super();
    this.fftSize = 512;
  }

  getFloatTimeDomainData(samples) {
    samples.fill(0);
  }
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.sampleRate = 48000;
    this.destination = new FakeAudioNode();
    this.audioWorklet = { addModule: async () => {} };
    this.listeners = new Set();
  }

  async resume() {
    this.state = 'running';
  }

  async close() {
    this.state = 'closed';
  }

  addEventListener(type, listener) {
    if (type === 'statechange') this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === 'statechange') this.listeners.delete(listener);
  }

  createMediaStreamSource() {
    return new FakeAudioNode();
  }

  createGain() {
    const node = new FakeAudioNode();
    node.gain = { value: 1 };
    return node;
  }

  createAnalyser() {
    return new FakeAnalyser();
  }
}
globalThis.AudioContext = FakeAudioContext;
globalThis.AudioWorkletNode = class extends FakeAudioNode {
  constructor() {
    super();
    this.port = { onmessage: null };
  }
};

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  send(value) {
    this.sent.push(value);
  }

  close(code = 1000, reason = '') {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.closeCode = code;
    this.closeReason = reason;
    this.onclose?.({ code, reason });
  }
}
globalThis.WebSocket = FakeWebSocket;

const {
  BrowserSpeechPipeline,
  DirectSttPipeline,
  createMicrophoneStream,
  observeAudioContext,
  resolveCredential,
  runtimeState,
  stopAll,
  unobserveAudioContext
} = await import('../offscreen.js');

function createFakeTrack() {
  const listeners = new Map();
  return {
    stopped: false,
    getSettings: () => ({ sampleRate: 48000, channelCount: 1 }),
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    emit(type) {
      listeners.get(type)?.();
    },
    listenerCount: () => listeners.size,
    stop() {
      this.stopped = true;
    }
  };
}

function createFakeStream(track = createFakeTrack()) {
  return {
    track,
    getAudioTracks: () => [track],
    getTracks: () => [track]
  };
}

async function openPipelineSocket(pipeline) {
  const opening = pipeline.openSocket();
  await Promise.resolve();
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  await opening;
  return socket;
}

const pipeline = new DirectSttPipeline(
  'tab',
  { authMode: 'api_key', apiKey: 'test-only', language: 'vi', model: 'nova-3' },
  async () => null
);
pipeline.reconnectAttempts = 2;
const firstSocket = await openPipelineSocket(pipeline);
assert.equal(pipeline.reconnectAttempts, 2, 'Retry budget must not reset on a short-lived open.');

firstSocket.close(1006, 'network');
assert.equal(pipeline.reconnectAttempts, 3);
const reconnectTimer = pipeline.reconnectTimer;
pipeline.scheduleReconnect({ code: 1006 });
assert.equal(pipeline.reconnectTimer, reconnectTimer, 'Only one reconnect timer may exist.');
assert.equal(pipeline.reconnectAttempts, 3);
clearTimeout(pipeline.reconnectTimer);
pipeline.reconnectTimer = null;
pipeline.scheduleReconnect({ code: 1006 });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pipeline.manualStop, true, 'Exhausted retry budget must release the pipeline.');

const deepgramErrorPipeline = new DirectSttPipeline(
  'mic',
  { authMode: 'api_key', apiKey: 'test-only', language: 'vi', model: 'nova-3' },
  async () => null
);
const errorSocket = await openPipelineSocket(deepgramErrorPipeline);
deepgramErrorPipeline.handleDeepgramMessage(JSON.stringify({
  type: 'Error',
  description: 'expired token'
}));
assert.equal(errorSocket.closeCode, 4001, 'Deepgram stream errors must force credential refresh.');
clearTimeout(deepgramErrorPipeline.reconnectTimer);
deepgramErrorPipeline.reconnectTimer = null;
await deepgramErrorPipeline.stop({ preserveError: true });

const duplicatePipeline = new DirectSttPipeline(
  'tab',
  { authMode: 'api_key', apiKey: 'test-only', language: 'vi', model: 'nova-3' },
  async () => null
);
const finalMessage = JSON.stringify({
  type: 'Results',
  is_final: true,
  speech_final: true,
  start: 1,
  duration: 0.8,
  channel: {
    alternatives: [{
      transcript: 'Xin chào',
      confidence: 0.9,
      words: [{ speaker: 0 }]
    }]
  }
});
duplicatePipeline.handleDeepgramMessage(finalMessage);
duplicatePipeline.handleDeepgramMessage(finalMessage);
assert.equal(duplicatePipeline.utteranceCounter, 2, 'Duplicate final results must be ignored.');

const endedStream = createFakeStream();
const endedPipeline = new DirectSttPipeline(
  'tab',
  { authMode: 'api_key', apiKey: 'test-only', language: 'vi', model: 'nova-3' },
  async () => endedStream
);
await endedPipeline.connectAudio();
endedStream.track.emit('ended');
await endedPipeline.stopPromise;
assert.equal(endedPipeline.manualStop, true);
assert.equal(endedStream.track.stopped, true);
assert.equal(endedStream.track.listenerCount(), 0, 'Track listeners must be removed on cleanup.');

const audioListeners = new Set();
const fakeAudioContext = {
  state: 'suspended',
  addEventListener(type, listener) {
    if (type === 'statechange') audioListeners.add(listener);
  },
  removeEventListener(type, listener) {
    if (type === 'statechange') audioListeners.delete(listener);
  },
  async resume() {
    this.state = 'running';
  }
};
const audioOwner = {
  audioContext: fakeAudioContext,
  audioContextStateHandler: null,
  audioRecoveryPromise: null,
  manualStop: false,
  stop: async () => {}
};
observeAudioContext(audioOwner, 'mic');
assert.equal(audioListeners.size, 1);
for (const listener of audioListeners) listener();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(fakeAudioContext.state, 'running');
assert.equal(audioOwner.audioRecoveryPromise, null);
unobserveAudioContext(audioOwner);
assert.equal(audioListeners.size, 0);

const browserPipeline = new BrowserSpeechPipeline({ language: 'vi' });
const browserStream = createFakeStream();
mediaDevices.getUserMedia = async () => browserStream;
await browserPipeline.start();
browserPipeline.recognition.onerror({ error: 'network' });
browserPipeline.recognition.onend();
assert.ok(browserPipeline.restartTimer, 'Chrome Speech onend must schedule one restart.');
const firstStop = browserPipeline.stop();
const repeatedStop = browserPipeline.stop();
assert.equal(firstStop, repeatedStop, 'Concurrent Stop calls must share one cleanup operation.');
await firstStop;
assert.equal(browserPipeline.restartTimer, null);
assert.equal(browserPipeline.recognition, null);

const removedMicPipeline = new BrowserSpeechPipeline({ language: 'vi' });
const removedMicStream = createFakeStream();
mediaDevices.getUserMedia = async () => removedMicStream;
await removedMicPipeline.start();
removedMicStream.track.emit('ended');
await removedMicPipeline.stopPromise;
assert.equal(removedMicStream.track.stopped, true);
assert.equal(removedMicStream.track.listenerCount(), 0);

mediaDevices.getUserMedia = async () => {
  const error = new Error('denied');
  error.name = 'NotAllowedError';
  throw error;
};
await assert.rejects(
  createMicrophoneStream(),
  /MIC_PERMISSION_DENIED/u
);

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
  options.signal.addEventListener('abort', () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    reject(error);
  });
});
globalThis.setTimeout = (callback) => {
  queueMicrotask(callback);
  return 1;
};
globalThis.clearTimeout = () => {};
await assert.rejects(
  resolveCredential({
    authMode: 'token_endpoint',
    tokenEndpoint: 'https://tokens.example.test/token'
  }),
  /TOKEN_TIMEOUT/u
);
globalThis.fetch = originalFetch;
globalThis.setTimeout = originalSetTimeout;
globalThis.clearTimeout = originalClearTimeout;

runtimeState.sources = {
  tab: { status: 'error', error: 'stale error', level: 0.5 }
};
runtimeState.error = 'stale error';
await stopAll();
assert.equal(runtimeState.error, null);
assert.equal(runtimeState.sources.tab.status, 'stopped');
assert.equal(runtimeState.sources.tab.error, null);

assert.ok(
  sentMessages.some((message) => (
    message.type === 'DIAGNOSTIC_EVENT'
    && message.event?.stage === 'audio-context'
    && message.event?.status === 'ok'
  )),
  'AudioContext recovery must be observable in diagnostics.'
);

console.log('Saymee recovery test: OK');
