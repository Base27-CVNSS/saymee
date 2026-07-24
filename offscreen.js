const TARGET_SAMPLE_RATE = 16000;
const MAX_TRANSCRIPTS = 1000;
const TOKEN_TIMEOUT_MS = 8000;
const SpeechRecognitionApi = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

const runtimeState = {
  phase: 'idle',
  startedAt: null,
  config: null,
  sources: {},
  transcripts: [],
  diagnostics: [],
  error: null
};

const pipelines = new Map();
let stopping = false;

function nowIso() {
  return new Date().toISOString();
}

function safeSend(message) {
  chrome.runtime.sendMessage({ ...message, target: 'ui' }).catch(() => {});
}

function publishState() {
  safeSend({ type: 'RUNTIME_STATE', state: serializeState() });
}

function serializeState() {
  return {
    phase: runtimeState.phase,
    startedAt: runtimeState.startedAt,
    config: runtimeState.config,
    sources: runtimeState.sources,
    transcripts: runtimeState.transcripts.slice(-300),
    diagnostics: runtimeState.diagnostics.slice(-100),
    error: runtimeState.error
  };
}

function logDiagnostic(stage, status, detail = '', source = null) {
  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    stage,
    status,
    detail: String(detail || '').slice(0, 500),
    source,
    at: Date.now()
  };
  runtimeState.diagnostics.push(event);
  if (runtimeState.diagnostics.length > 200) runtimeState.diagnostics.shift();
  safeSend({ type: 'DIAGNOSTIC_EVENT', event });
}

function setSourceState(source, patch) {
  runtimeState.sources[source] = {
    ...(runtimeState.sources[source] || {}),
    ...patch,
    updatedAt: nowIso()
  };
  publishState();
}

function markSourceRecovered(source, patch = {}) {
  const previous = runtimeState.sources[source] || {};
  const hadError = Boolean(previous.error);
  runtimeState.sources[source] = {
    ...previous,
    ...patch,
    status: patch.status || 'streaming',
    error: null,
    updatedAt: nowIso()
  };
  runtimeState.error = Object.values(runtimeState.sources)
    .map((state) => state?.error)
    .find(Boolean) || null;
  if (hadError) {
    logDiagnostic('recovery', 'ok', 'Nguồn đã phục hồi; trạng thái lỗi cũ được xóa.', source);
  }
  publishState();
}

function publishError(source, error) {
  const text = error?.message || String(error);
  logDiagnostic('error', 'error', text, source);
  runtimeState.error = text;
  if (source) setSourceState(source, { status: 'error', error: text });
  safeSend({ type: 'RUNTIME_ERROR', source, error: text });
}

function publishTranscript(event) {
  safeSend({ type: 'TRANSCRIPT_EVENT', event });
  if (!event.final) return;

  runtimeState.transcripts.push(event);
  if (runtimeState.transcripts.length > MAX_TRANSCRIPTS) {
    runtimeState.transcripts.splice(0, runtimeState.transcripts.length - MAX_TRANSCRIPTS);
  }
}

async function resolveCredential(config, source = null) {
  if (config.authMode === 'api_key') {
    if (!config.apiKey?.trim()) throw new Error('Chưa nhập Deepgram API key.');
    logDiagnostic('credential', 'ok', 'Đã nhận API key từ phiên extension.', source);
    return { scheme: 'token', value: config.apiKey.trim() };
  }

  const endpoint = config.tokenEndpoint?.trim();
  if (!endpoint) throw new Error('Chưa nhập token endpoint.');
  let endpointOrigin = 'endpoint';
  try { endpointOrigin = new URL(endpoint).origin; } catch {}
  logDiagnostic('credential', 'pending', `Đang lấy temporary token từ ${endpointOrigin}.`, source);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain' },
      cache: 'no-store',
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        `TOKEN_TIMEOUT|Máy chủ token không phản hồi sau ${TOKEN_TIMEOUT_MS / 1000} giây. Kiểm tra lại ${endpoint}.`
      );
    }
    const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(endpoint);
    const hint = isLocal
      ? 'Hãy chạy server/token-server.mjs rồi thử nút “Kiểm tra kết nối”.'
      : 'Kiểm tra HTTPS, CORS, chứng chỉ và quyền truy cập endpoint.';
    throw new Error(`TOKEN_FETCH_FAILED|Không kết nối được máy chủ token ${endpoint}. ${hint}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 240).trim();
    } catch {}
    throw new Error(
      `TOKEN_HTTP_ERROR|Token endpoint trả HTTP ${response.status}${detail ? `: ${detail}` : '.'}`
    );
  }

  const contentType = response.headers.get('content-type') || '';
  let token;
  if (contentType.includes('application/json')) {
    const data = await response.json();
    token = data.access_token || data.token || data.key;
  } else {
    token = (await response.text()).trim();
  }

  if (!token) {
    throw new Error('TOKEN_INVALID|Token endpoint không trả access_token, token hoặc key hợp lệ.');
  }
  logDiagnostic('credential', 'ok', 'Temporary token hợp lệ đã được nhận.', source);
  return { scheme: 'bearer', value: token };
}

function buildDeepgramUrl(config, source) {
  const url = new URL('wss://api.deepgram.com/v1/listen');
  const endpointing = config.language === 'multi' ? '100' : '300';
  const params = {
    model: config.model || 'nova-3',
    language: config.language || 'vi',
    encoding: 'linear16',
    sample_rate: String(TARGET_SAMPLE_RATE),
    channels: '1',
    smart_format: 'true',
    punctuate: 'true',
    interim_results: 'true',
    endpointing,
    utterance_end_ms: '1000',
    vad_events: 'true',
    diarize_model: source === 'tab' && config.diarize ? 'latest' : undefined
  };

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, value);
  });
  return url.toString();
}

class DirectSttPipeline {
  constructor(source, config, mediaFactory) {
    this.source = source;
    this.config = config;
    this.mediaFactory = mediaFactory;
    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.silentGain = null;
    this.playbackGain = null;
    this.socket = null;
    this.socketGeneration = 0;
    this.connectPromise = null;
    this.reconnectTimer = null;
    this.manualStop = false;
    this.reconnectAttempts = 0;
    this.utteranceCounter = 1;
    this.workingId = this.makeUtteranceId();
    this.lastAudioAt = 0;
    this.sentFirstPcm = false;
    this.receivedFirstTranscript = false;
  }

  makeUtteranceId() {
    return `${this.source}-${Date.now()}-${this.utteranceCounter}`;
  }

  async start() {
    setSourceState(this.source, { status: 'connecting', level: 0, error: null });
    try {
      // Stream IDs của Chrome chỉ dùng một lần và hết hạn rất nhanh.
      // Luôn tiêu thụ media trước, sau đó mới lấy token/mở WebSocket.
      await this.connectAudio();
      await this.connectSocket();
      markSourceRecovered(this.source, { level: 0, reconnectAttempts: 0 });
      logDiagnostic('pipeline', 'ok', 'Audio và Deepgram đã sẵn sàng.', this.source);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async connectSocket() {
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.openSocket().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async openSocket() {
    const credential = await resolveCredential(this.config, this.source);
    const url = buildDeepgramUrl(this.config, this.source);
    const protocols = [credential.scheme, credential.value];
    logDiagnostic('websocket', 'pending', 'Đang mở Deepgram Streaming WebSocket.', this.source);

    await new Promise((resolve, reject) => {
      let settled = false;
      let opened = false;
      const generation = ++this.socketGeneration;
      const socket = new WebSocket(url, protocols);
      socket.binaryType = 'arraybuffer';
      this.socket = socket;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.close();
          reject(new Error('Hết thời gian kết nối Deepgram.'));
        }
      }, 10000);

      socket.onopen = () => {
        if (generation !== this.socketGeneration || this.manualStop) {
          socket.close(1000, 'Stale connection');
          return;
        }
        clearTimeout(timeout);
        settled = true;
        opened = true;
        this.reconnectAttempts = 0;
        logDiagnostic('websocket', 'ok', 'Deepgram WebSocket đã kết nối.', this.source);
        resolve();
      };

      socket.onerror = () => {
        if (!settled) {
          clearTimeout(timeout);
          settled = true;
          logDiagnostic('websocket', 'error', 'WebSocket bị từ chối trong handshake.', this.source);
          reject(new Error('Không mở được WebSocket Deepgram. Kiểm tra token/API key.'));
        }
      };

      socket.onmessage = (event) => this.handleDeepgramMessage(event.data);
      socket.onclose = (event) => {
        if (generation !== this.socketGeneration) return;
        if (!settled) {
          clearTimeout(timeout);
          settled = true;
          const reason = event.reason ? `: ${event.reason}` : '';
          reject(new Error(`Deepgram đóng kết nối (${event.code})${reason}.`));
          return;
        }
        if (opened && !this.manualStop && !stopping) this.scheduleReconnect(event);
      };
    });
  }

  async connectAudio() {
    logDiagnostic('media', 'pending', 'Đang yêu cầu MediaStream từ Chrome.', this.source);
    this.stream = await this.mediaFactory();
    const track = this.stream.getAudioTracks()[0];
    if (!track) throw new Error(`Không có audio track cho nguồn ${this.source}.`);
    const settings = track.getSettings?.() || {};
    logDiagnostic(
      'media',
      'ok',
      `Đã nhận audio track${settings.sampleRate ? ` ${settings.sampleRate} Hz` : ''}${settings.channelCount ? `, ${settings.channelCount} kênh` : ''}.`,
      this.source
    );

    track.addEventListener('ended', () => {
      if (!this.manualStop) {
        publishError(this.source, new Error(`Nguồn ${this.source} đã kết thúc.`));
        this.stop();
      }
    });

    this.audioContext = new AudioContext({ latencyHint: 'interactive' });
    logDiagnostic('audio-context', 'pending', `AudioContext: ${this.audioContext.state}.`, this.source);
    await this.audioContext.audioWorklet.addModule(chrome.runtime.getURL('audio-worklet.js'));
    await this.audioContext.resume();
    logDiagnostic(
      'audio-context',
      this.audioContext.state === 'running' ? 'ok' : 'warning',
      `AudioContext sau resume: ${this.audioContext.state}; sample rate ${this.audioContext.sampleRate} Hz.`,
      this.source
    );

    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm16-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { targetSampleRate: TARGET_SAMPLE_RATE }
    });

    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;
    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.silentGain).connect(this.audioContext.destination);

    if (this.source === 'tab') {
      this.playbackGain = this.audioContext.createGain();
      this.playbackGain.gain.value = 1;
      this.sourceNode.connect(this.playbackGain).connect(this.audioContext.destination);
    }

    this.workletNode.port.onmessage = (event) => {
      const data = event.data;
      if (data?.type === 'level') {
        runtimeState.sources[this.source] = {
          ...(runtimeState.sources[this.source] || {}),
          level: data.value,
          updatedAt: nowIso()
        };
        safeSend({ type: 'AUDIO_LEVEL', source: this.source, level: data.value });
        return;
      }

      if (data?.type === 'pcm') {
        this.lastAudioAt = Date.now();
        if (!this.sentFirstPcm) {
          this.sentFirstPcm = true;
          logDiagnostic('audio-worklet', 'ok', 'Đã tạo gói PCM16 đầu tiên.', this.source);
        }
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(data.buffer);
        }
      }
    };
  }

  handleDeepgramMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === 'Results') {
      const alternative = message.channel?.alternatives?.[0];
      const text = alternative?.transcript?.trim();
      if (!text) return;

      const words = alternative.words || [];
      const speaker = words.length ? words[0].speaker : undefined;
      const isFinal = Boolean(message.is_final);
      const event = {
        id: this.workingId,
        source: this.source,
        text,
        final: isFinal,
        speechFinal: Boolean(message.speech_final),
        confidence: Number(alternative.confidence || 0),
        speaker,
        startMs: Math.round(Number(message.start || 0) * 1000),
        durationMs: Math.round(Number(message.duration || 0) * 1000),
        receivedAt: Date.now()
      };

      if (!this.receivedFirstTranscript) {
        this.receivedFirstTranscript = true;
        logDiagnostic('transcript', 'ok', 'Deepgram đã trả kết quả nhận dạng đầu tiên.', this.source);
      }
      publishTranscript(event);

      if (isFinal) {
        this.utteranceCounter += 1;
        this.workingId = this.makeUtteranceId();
      }
      return;
    }

    if (message.type === 'SpeechStarted') {
      setSourceState(this.source, { speech: true });
    } else if (message.type === 'UtteranceEnd') {
      setSourceState(this.source, { speech: false });
    } else if (message.type === 'Metadata') {
      setSourceState(this.source, { requestId: message.request_id || null });
    } else if (message.type === 'Error') {
      publishError(this.source, new Error(message.description || message.message || 'Deepgram lỗi.'));
    }
  }

  scheduleReconnect(event) {
    if (this.manualStop || stopping || this.reconnectTimer) return;
    if (this.reconnectAttempts >= 3) {
      publishError(this.source, new Error(`Mất kết nối Deepgram (${event.code}); đã thử lại 3 lần.`));
      return;
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(5000, 500 * (2 ** (this.reconnectAttempts - 1)));
    setSourceState(this.source, {
      status: 'reconnecting',
      reconnectAttempts: this.reconnectAttempts
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.manualStop || stopping) return;
      try {
        await this.connectSocket();
        markSourceRecovered(this.source, { reconnectAttempts: 0 });
      } catch (error) {
        publishError(this.source, error);
        this.scheduleReconnect({ code: 1006 });
      }
    }, delay);
  }

  async stop() {
    this.manualStop = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socketGeneration += 1;
    setSourceState(this.source, { status: 'stopping', level: 0 });

    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify({ type: 'Finalize' }));
        await new Promise((resolve) => setTimeout(resolve, 200));
        this.socket.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {}
    }

    try { this.socket?.close(1000, 'Session stopped'); } catch {}
    this.socket = null;

    try { this.workletNode?.disconnect(); } catch {}
    if (this.workletNode?.port) this.workletNode.port.onmessage = null;
    try { this.sourceNode?.disconnect(); } catch {}
    try { this.silentGain?.disconnect(); } catch {}
    try { this.playbackGain?.disconnect(); } catch {}

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.workletNode = null;
    this.sourceNode = null;
    this.silentGain = null;
    this.playbackGain = null;

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try { await this.audioContext.close(); } catch {}
    }
    this.audioContext = null;

    setSourceState(this.source, { status: 'stopped', level: 0, speech: false });
  }
}

class BrowserSpeechPipeline {
  constructor(config) {
    this.source = 'mic';
    this.config = config;
    this.recognition = null;
    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.analyser = null;
    this.silentGain = null;
    this.levelTimer = null;
    this.restartTimer = null;
    this.startupTimer = null;
    this.manualStop = false;
    this.generation = 0;
    this.sessionId = Date.now();
  }

  async start() {
    if (!SpeechRecognitionApi) {
      throw new Error(
        'BROWSER_STT_UNAVAILABLE|Chrome hiện tại không cung cấp Web Speech Recognition. Hãy cập nhật Chrome hoặc chọn Deepgram.'
      );
    }

    setSourceState('mic', { status: 'connecting', level: 0, error: null });
    try {
      this.stream = await createMicrophoneStream();
      await this.startLevelMeter();
      await this.startRecognition();
    } catch (error) {
      await this.stop();
      throw this.normalizeMicrophoneError(error);
    }
  }

  normalizeMicrophoneError(error) {
    const raw = error?.message || String(error);
    if (['NotAllowedError', 'PermissionDeniedError'].includes(error?.name) || /not-allowed/i.test(raw)) {
      return new Error(
        'MIC_PERMISSION_DENIED|Chrome chưa cho phép microphone. Bấm “Cấp quyền mic”, chọn Cho phép, rồi thử lại.'
      );
    }
    if (error?.name === 'NotFoundError' || /audio-capture/i.test(raw)) {
      return new Error('MIC_NOT_FOUND|Không tìm thấy microphone khả dụng trên máy.');
    }
    return error;
  }

  async startLevelMeter() {
    this.audioContext = new AudioContext({ latencyHint: 'interactive' });
    await this.audioContext.resume();
    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;
    this.sourceNode.connect(this.analyser).connect(this.silentGain).connect(this.audioContext.destination);

    const samples = new Float32Array(this.analyser.fftSize);
    this.levelTimer = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
      runtimeState.sources.mic = {
        ...(runtimeState.sources.mic || {}),
        level,
        updatedAt: nowIso()
      };
      safeSend({ type: 'AUDIO_LEVEL', source: 'mic', level });
    }, 100);
  }

  startRecognition() {
    clearTimeout(this.restartTimer);
    this.generation += 1;
    const generation = this.generation;
    const recognition = new SpeechRecognitionApi();
    this.recognition = recognition;
    recognition.lang = this.config.language === 'en' ? 'en-US' : 'vi-VN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    let startupSettled = false;
    let rejectStartup = () => {};

    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const alternative = result[0];
        const text = alternative?.transcript?.trim();
        if (!text) continue;

        publishTranscript({
          id: `mic-browser-${this.sessionId}-${generation}-${index}`,
          source: 'mic',
          engine: 'browser',
          text,
          final: Boolean(result.isFinal),
          speechFinal: Boolean(result.isFinal),
          confidence: Number(alternative.confidence || 0),
          receivedAt: Date.now()
        });
      }
    };

    recognition.onerror = (event) => {
      if (this.manualStop || event.error === 'aborted') return;

      const errors = {
        'not-allowed': 'MIC_PERMISSION_DENIED|Chrome từ chối microphone. Hãy cấp quyền mic cho extension.',
        'service-not-allowed': 'BROWSER_STT_BLOCKED|Dịch vụ nhận dạng giọng nói của Chrome đang bị chặn.',
        'audio-capture': 'MIC_NOT_FOUND|Chrome không nhận được âm thanh từ microphone.',
        network: 'BROWSER_STT_NETWORK|Dịch vụ nhận dạng của Chrome mất kết nối mạng.',
        'no-speech': ''
      };
      const message = errors[event.error] ?? `BROWSER_STT_ERROR|Nhận dạng trình duyệt lỗi: ${event.error}.`;
      if (message) publishError('mic', new Error(message));
      if (!startupSettled && message) {
        startupSettled = true;
        rejectStartup(new Error(message));
      }

      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
        this.manualStop = true;
        this.stop({ preserveError: true }).catch(() => {});
      }
    };

    recognition.onend = () => {
      if (this.manualStop || stopping) return;
      setSourceState('mic', { status: 'reconnecting' });
      this.restartTimer = setTimeout(() => {
        if (this.manualStop || stopping) return;
        this.startRecognition().catch((error) => publishError('mic', error));
      }, 350);
    };

    return new Promise((resolve, reject) => {
      rejectStartup = reject;
      const timeout = setTimeout(() => {
        if (startupSettled) return;
        startupSettled = true;
        reject(new Error('BROWSER_STT_TIMEOUT|Chrome không khởi động được nhận dạng giọng nói.'));
      }, 8000);
      this.startupTimer = timeout;

      recognition.onstart = () => {
        clearTimeout(timeout);
        this.startupTimer = null;
        if (startupSettled) return;
        startupSettled = true;
        markSourceRecovered('mic', { level: 0 });
        resolve();
      };

      try {
        recognition.start();
      } catch (error) {
        clearTimeout(timeout);
        this.startupTimer = null;
        startupSettled = true;
        reject(error);
      }
    });
  }

  async stop({ preserveError = false } = {}) {
    this.manualStop = true;
    clearTimeout(this.restartTimer);
    clearTimeout(this.startupTimer);
    clearInterval(this.levelTimer);
    this.restartTimer = null;
    this.startupTimer = null;
    this.levelTimer = null;
    const currentError = runtimeState.sources.mic?.error || null;
    setSourceState('mic', { status: 'stopping', level: 0 });

    if (this.recognition) {
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      this.recognition.onstart = null;
      try { this.recognition.abort(); } catch {}
    }
    this.recognition = null;
    try { this.sourceNode?.disconnect(); } catch {}
    try { this.analyser?.disconnect(); } catch {}
    try { this.silentGain?.disconnect(); } catch {}
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.sourceNode = null;
    this.analyser = null;
    this.silentGain = null;

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try { await this.audioContext.close(); } catch {}
    }
    this.audioContext = null;
    setSourceState('mic', {
      status: preserveError ? 'error' : 'stopped',
      level: 0,
      speech: false,
      error: preserveError ? currentError : null
    });
  }
}

async function createTabStream(streamId) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });
}

async function createDesktopStream(streamId, canRequestAudioTrack) {
  if (!canRequestAudioTrack) {
    throw new Error(
      'DESKTOP_AUDIO_DISABLED|Bạn chưa bật “Chia sẻ âm thanh tab” trong hộp chọn của Chrome.'
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: streamId
      }
    },
    // Desktop Capture yêu cầu video track; giới hạn video tối đa để giảm CPU.
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: streamId,
        maxWidth: 320,
        maxHeight: 180,
        maxFrameRate: 1
      }
    }
  });

  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(
      'DESKTOP_NO_AUDIO|Tab đã chọn không cung cấp audio. Chọn đúng tab và bật “Chia sẻ âm thanh tab”.'
    );
  }
  return stream;
}

async function createMicrophoneStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: false
  });
}

async function stopAll() {
  stopping = true;
  const active = [...pipelines.values()];
  pipelines.clear();
  await Promise.allSettled(active.map((pipeline) => pipeline.stop()));
  stopping = false;
  runtimeState.phase = 'idle';
  runtimeState.startedAt = null;
  runtimeState.config = null;
  publishState();
}

async function startSession(config, tabCapture) {
  await stopAll();

  const engine = config.engine || 'deepgram';
  const source = config.source || (engine === 'browser' ? 'mic' : 'tab');
  if (!['deepgram', 'browser'].includes(engine)) {
    throw new Error(`ENGINE_UNSUPPORTED|Engine không được hỗ trợ: ${engine}.`);
  }
  if (!['tab', 'mic', 'both'].includes(source)) {
    throw new Error(`SOURCE_UNSUPPORTED|Nguồn âm thanh không được hỗ trợ: ${source}.`);
  }
  if (engine === 'browser' && source !== 'mic') {
    throw new Error(
      'ENGINE_SOURCE_MISMATCH|Nhận dạng bằng trình duyệt chỉ hỗ trợ Microphone. Muốn ghi âm tab, hãy chọn Deepgram.'
    );
  }
  const runtimeConfig = { ...config, engine, source };

  runtimeState.phase = 'starting';
  runtimeState.diagnostics = [];
  runtimeState.startedAt = Date.now();
  runtimeState.config = {
    source,
    engine,
    language: runtimeConfig.language || 'vi',
    model: runtimeConfig.model || 'nova-3',
    diarize: Boolean(runtimeConfig.diarize)
  };
  runtimeState.sources = {};
  runtimeState.error = null;
  logDiagnostic('session', 'pending', `Khởi động phiên bằng ${engine}.`);
  publishState();

  const tasks = [];

  if (engine === 'browser') {
    const pipeline = new BrowserSpeechPipeline(runtimeConfig);
    pipelines.set('mic', pipeline);
    tasks.push(pipeline.start());
  }

  if (engine === 'deepgram' && (source === 'tab' || source === 'both')) {
    if (!tabCapture?.streamId) throw new Error('Thiếu stream ID của tab.');
    const mediaFactory = tabCapture.captureType === 'desktop'
      ? () => createDesktopStream(tabCapture.streamId, tabCapture.canRequestAudioTrack)
      : () => createTabStream(tabCapture.streamId);
    const pipeline = new DirectSttPipeline(
      'tab',
      runtimeConfig,
      mediaFactory
    );
    pipelines.set('tab', pipeline);
    tasks.push(pipeline.start());
  }

  if (engine === 'deepgram' && (source === 'mic' || source === 'both')) {
    const pipeline = new DirectSttPipeline('mic', runtimeConfig, createMicrophoneStream);
    pipelines.set('mic', pipeline);
    tasks.push(pipeline.start());
  }

  const results = await Promise.allSettled(tasks);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length === results.length && failures.length > 0) {
    await stopAll();
    throw failures[0].reason;
  }

  failures.forEach((failure) => publishError(null, failure.reason));
  runtimeState.phase = 'streaming';
  publishState();
  return { ok: true, state: serializeState() };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return false;

  (async () => {
    if (message.type === 'START_SESSION') {
      sendResponse(await startSession(message.config || {}, message.tabCapture));
      return;
    }

    if (message.type === 'STOP_SESSION') {
      await stopAll();
      sendResponse({ ok: true, state: serializeState() });
      return;
    }

    if (message.type === 'GET_RUNTIME_STATE') {
      sendResponse({ ok: true, state: serializeState() });
      return;
    }

    if (message.type === 'HEALTH_CHECK') {
      sendResponse({
        ok: true,
        capabilities: {
          secureContext: globalThis.isSecureContext,
          mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
          audioContext: Boolean(globalThis.AudioContext),
          audioWorklet: Boolean(globalThis.AudioWorkletNode),
          speechRecognition: Boolean(SpeechRecognitionApi),
          webSocket: Boolean(globalThis.WebSocket)
        }
      });
      return;
    }

    if (message.type === 'TEST_CREDENTIAL') {
      const credential = await resolveCredential(message.config || {});
      sendResponse({
        ok: true,
        authMode: message.config?.authMode || 'token_endpoint',
        credentialType: credential.scheme
      });
      return;
    }

    if (message.type === 'CLEAR_TRANSCRIPTS') {
      runtimeState.transcripts = [];
      publishState();
      sendResponse({ ok: true, state: serializeState() });
      return;
    }

    sendResponse({ ok: false, error: 'Lệnh offscreen không hợp lệ.' });
  })().catch((error) => {
    publishError(null, error);
    sendResponse({ ok: false, error: error?.message || String(error) });
  });

  return true;
});
