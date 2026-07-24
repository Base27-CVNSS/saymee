import { buildExport, exportTxt } from './transcript-core.mjs';

const SETTINGS_KEY = 'saymeeLiveSettings';
const SESSION_API_KEY = 'saymeeSessionApiKey';
const LEGACY_SETTINGS_KEY = 'saydiLiveSettings';
const LEGACY_SESSION_API_KEY = 'saydiSessionApiKey';

const elements = {
  engine: document.querySelector('#engine'),
  source: document.querySelector('#source'),
  tabCaptureMode: document.querySelector('#tabCaptureMode'),
  tabCaptureModeGroup: document.querySelector('#tabCaptureModeGroup'),
  tabCaptureModeHint: document.querySelector('#tabCaptureModeHint'),
  language: document.querySelector('#language'),
  diarize: document.querySelector('#diarize'),
  browserNotice: document.querySelector('#browserNotice'),
  connectionSettings: document.querySelector('#connectionSettings'),
  authMode: document.querySelector('#authMode'),
  tokenEndpoint: document.querySelector('#tokenEndpoint'),
  apiKey: document.querySelector('#apiKey'),
  rememberApiKey: document.querySelector('#rememberApiKey'),
  tokenEndpointGroup: document.querySelector('#tokenEndpointGroup'),
  apiKeyGroup: document.querySelector('#apiKeyGroup'),
  testConnection: document.querySelector('#testConnection'),
  connectionTestStatus: document.querySelector('#connectionTestStatus'),
  tabContext: document.querySelector('#tabContext'),
  tabContextTitle: document.querySelector('#tabContextTitle'),
  tabContextDetail: document.querySelector('#tabContextDetail'),
  tabContextBadge: document.querySelector('#tabContextBadge'),
  startButton: document.querySelector('#startButton'),
  stopButton: document.querySelector('#stopButton'),
  grantMic: document.querySelector('#grantMic'),
  globalStatus: document.querySelector('#globalStatus'),
  sessionTimer: document.querySelector('#sessionTimer'),
  errorBox: document.querySelector('#errorBox'),
  tabStatusCard: document.querySelector('#tabStatusCard'),
  micStatusCard: document.querySelector('#micStatusCard'),
  tabState: document.querySelector('#tabState'),
  micState: document.querySelector('#micState'),
  tabLevel: document.querySelector('#tabLevel'),
  micLevel: document.querySelector('#micLevel'),
  capabilityStatus: document.querySelector('#capabilityStatus'),
  diagnosticList: document.querySelector('#diagnosticList'),
  runDiagnostic: document.querySelector('#runDiagnostic'),
  copyDiagnostic: document.querySelector('#copyDiagnostic'),
  transcriptList: document.querySelector('#transcriptList'),
  transcriptCount: document.querySelector('#transcriptCount'),
  wordCount: document.querySelector('#wordCount'),
  copyButton: document.querySelector('#copyButton'),
  exportFormat: document.querySelector('#exportFormat'),
  exportButton: document.querySelector('#exportButton'),
  clearButton: document.querySelector('#clearButton'),
  jumpLive: document.querySelector('#jumpLive')
};

const transcriptState = {
  final: [],
  working: new Map()
};
const diagnosticState = [];
let capabilities = null;

let runtimePhase = 'idle';
let startedAt = null;
let currentSession = null;
let restoreGeneration = 0;
let followLive = true;
let timerHandle = null;
let busy = false;
let activeEngine = 'deepgram';
let lastDeepgramSettings = {
  source: 'tab',
  tabCaptureMode: 'active_tab',
  language: 'vi',
  diarize: true
};

function defaultSettings() {
  return {
    engine: 'deepgram',
    source: 'tab',
    tabCaptureMode: 'active_tab',
    language: 'vi',
    model: 'nova-3',
    diarize: true,
    authMode: 'token_endpoint',
    tokenEndpoint: 'http://127.0.0.1:8787/token',
    rememberApiKey: false,
    apiKey: '',
    deepgramSettings: { ...lastDeepgramSettings }
  };
}

function formSettings() {
  return {
    engine: elements.engine.value,
    source: elements.source.value,
    tabCaptureMode: elements.tabCaptureMode.value,
    language: elements.language.value,
    model: 'nova-3',
    diarize: elements.diarize.checked,
    authMode: elements.authMode.value,
    tokenEndpoint: elements.tokenEndpoint.value.trim(),
    rememberApiKey: elements.rememberApiKey.checked,
    apiKey: elements.apiKey.value.trim()
  };
}

async function saveSettings() {
  const settings = formSettings();
  if (settings.engine === 'deepgram') {
    lastDeepgramSettings = {
      source: settings.source,
      tabCaptureMode: settings.tabCaptureMode,
      language: settings.language,
      diarize: settings.diarize
    };
  }
  const persistent = {
    ...settings,
    deepgramSettings: { ...lastDeepgramSettings },
    apiKey: settings.rememberApiKey ? settings.apiKey : ''
  };
  await Promise.all([
    chrome.storage.local.set({ [SETTINGS_KEY]: persistent }),
    chrome.storage.session.set({ [SESSION_API_KEY]: settings.apiKey })
  ]);
}

async function loadSettings() {
  const [localData, sessionData] = await Promise.all([
    chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]),
    chrome.storage.session.get([SESSION_API_KEY, LEGACY_SESSION_API_KEY])
  ]);
  const storedSettings = localData[SETTINGS_KEY] || localData[LEGACY_SETTINGS_KEY] || {};
  const settings = { ...defaultSettings(), ...storedSettings };
  const storedDeepgram = storedSettings.deepgramSettings || (
    storedSettings.engine === 'deepgram' ? storedSettings : {}
  );
  lastDeepgramSettings = {
    source: storedDeepgram.source ?? lastDeepgramSettings.source,
    tabCaptureMode: storedDeepgram.tabCaptureMode ?? lastDeepgramSettings.tabCaptureMode,
    language: storedDeepgram.language ?? lastDeepgramSettings.language,
    diarize: storedDeepgram.diarize ?? lastDeepgramSettings.diarize
  };
  activeEngine = settings.engine;
  elements.engine.value = settings.engine;
  elements.source.value = settings.source;
  elements.tabCaptureMode.value = settings.tabCaptureMode;
  elements.language.value = settings.language;
  elements.diarize.checked = Boolean(settings.diarize);
  elements.authMode.value = settings.authMode;
  elements.tokenEndpoint.value = settings.tokenEndpoint;
  elements.rememberApiKey.checked = Boolean(settings.rememberApiKey);
  elements.apiKey.value = sessionData[SESSION_API_KEY]
    || sessionData[LEGACY_SESSION_API_KEY]
    || settings.apiKey
    || '';
  updateMode();

  if (!localData[SETTINGS_KEY] || (
    !sessionData[SESSION_API_KEY] && sessionData[LEGACY_SESSION_API_KEY]
  )) {
    await saveSettings();
  }
}

function updateMode() {
  const browserMode = elements.engine.value === 'browser';
  if (browserMode && elements.source.value !== 'mic') elements.source.value = 'mic';
  if (browserMode && elements.language.value === 'multi') elements.language.value = 'vi';

  for (const option of elements.source.options) {
    option.disabled = browserMode && option.value !== 'mic';
  }
  for (const option of elements.language.options) {
    option.disabled = browserMode && option.value === 'multi';
  }

  elements.browserNotice.classList.toggle('hidden', !browserMode);
  elements.connectionSettings.classList.toggle('hidden', browserMode);
  updateAuthMode();
  updateSourceControls();
}

function updateAuthMode() {
  const apiKeyMode = elements.authMode.value === 'api_key';
  elements.apiKeyGroup.classList.toggle('hidden', !apiKeyMode);
  elements.tokenEndpointGroup.classList.toggle('hidden', apiKeyMode);
}

function updateSourceControls() {
  const capturesTab = ['tab', 'both'].includes(elements.source.value);
  const deepgram = elements.engine.value === 'deepgram';
  const pickerMode = elements.tabCaptureMode.value === 'picker';
  elements.tabCaptureModeGroup.classList.toggle('hidden', !capturesTab || !deepgram);
  elements.tabContext.classList.toggle('hidden', !capturesTab || !deepgram);
  elements.diarize.disabled = !capturesTab || elements.engine.value !== 'deepgram';
  elements.tabCaptureModeHint.textContent = pickerMode
    ? 'Chrome sẽ mở hộp thoại để bạn chọn đúng tab và bật “Chia sẻ âm thanh tab”.'
    : 'Chế độ nhanh chỉ hoạt động khi panel được mở bằng biểu tượng extension trên chính tab cần ghi.';

  if (capturesTab && deepgram) {
    if (pickerMode) {
      renderTabContext({
        title: 'Sẽ chọn tab khi bắt đầu',
        capturable: true,
        picker: true,
        reason: 'Không dùng activeTab; Chrome sẽ hỏi bạn chọn nguồn âm thanh.'
      });
    } else {
      refreshTabContext();
    }
  }
}

function displayError(rawMessage) {
  const raw = String(rawMessage || 'Đã xảy ra lỗi không xác định.');
  const separator = raw.indexOf('|');
  return separator > 0 ? raw.slice(separator + 1) : raw;
}

function showError(message) {
  elements.errorBox.textContent = displayError(message);
  elements.errorBox.classList.remove('hidden');
  elements.globalStatus.textContent = 'Cần xử lý';
  elements.globalStatus.className = 'status-pill error';
}

function clearError() {
  elements.errorBox.textContent = '';
  elements.errorBox.classList.add('hidden');
}

async function ensureTokenEndpointPermission(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Địa chỉ token endpoint không hợp lệ.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Token endpoint phải bắt đầu bằng http:// hoặc https://.');
  }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
  if (url.protocol !== 'https:') throw new Error('Token endpoint từ xa bắt buộc dùng HTTPS.');

  const originPattern = `${url.origin}/*`;
  const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
  if (hasPermission) return true;
  return chrome.permissions.request({ origins: [originPattern] });
}

async function refreshTabContext() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_CONTEXT' });
    const tab = response?.tab;
    if (!tab) {
      renderTabContext(null);
      return null;
    }
    renderTabContext(tab);
    return tab;
  } catch (error) {
    renderTabContext({
      title: 'Không đọc được tab',
      invoked: false,
      capturable: false,
      reason: error.message
    });
    return null;
  }
}

function renderTabContext(tab) {
  if (!tab) {
    elements.tabContextTitle.textContent = 'Không tìm thấy tab hiện tại';
    elements.tabContextDetail.textContent = 'Mở một trang web rồi bấm lại biểu tượng extension.';
    elements.tabContextBadge.textContent = 'Chưa sẵn sàng';
    elements.tabContextBadge.className = 'context-badge pending';
    return;
  }

  elements.tabContextTitle.textContent = tab.title || 'Tab hiện tại';
  elements.tabContextDetail.textContent = tab.capturable
    ? tab.picker
      ? tab.reason
      : 'Địa chỉ tab hợp lệ. Chrome sẽ kiểm tra quyền activeTab khi bắt đầu.'
    : tab.reason || 'Tab chưa sẵn sàng để ghi âm.';
  elements.tabContextBadge.textContent = tab.capturable
    ? tab.picker ? 'Sẽ chọn' : 'Có thể ghi'
    : 'Không thể ghi';
  elements.tabContextBadge.className = `context-badge ${
    tab.capturable ? 'ready' : 'blocked'
  }`;
}

async function testConnection() {
  clearError();
  const config = formSettings();
  elements.testConnection.disabled = true;
  elements.connectionTestStatus.textContent = 'Đang kiểm tra kết nối…';

  try {
    if (config.authMode === 'token_endpoint') {
      if (!config.tokenEndpoint) throw new Error('Hãy nhập token endpoint.');
      const granted = await ensureTokenEndpointPermission(config.tokenEndpoint);
      if (!granted) throw new Error('Chưa cấp quyền truy cập token endpoint.');
    } else if (!config.apiKey) {
      throw new Error('Hãy nhập Deepgram API key.');
    }

    const response = await chrome.runtime.sendMessage({
      type: 'TEST_CREDENTIAL',
      config
    });
    if (!response?.ok) throw new Error(response?.error || 'Không kiểm tra được kết nối.');
    elements.connectionTestStatus.textContent = 'Kết nối hợp lệ. Có thể bắt đầu nhận dạng.';
    await saveSettings();
  } catch (error) {
    elements.connectionTestStatus.textContent = displayError(error.message);
    showError(error.message);
  } finally {
    elements.testConnection.disabled = false;
  }
}

async function validateStartConfig(config) {
  if (config.engine === 'browser') return;

  if (config.authMode === 'token_endpoint') {
    if (!config.tokenEndpoint) throw new Error('Hãy nhập token endpoint.');
    const granted = await ensureTokenEndpointPermission(config.tokenEndpoint);
    if (!granted) throw new Error('Chưa cấp quyền truy cập token endpoint.');
  } else if (!config.apiKey) {
    throw new Error('Hãy nhập Deepgram API key hoặc chọn temporary token.');
  }

  if (
    ['tab', 'both'].includes(config.source)
    && config.tabCaptureMode === 'active_tab'
  ) {
    const tab = await refreshTabContext();
    if (!tab?.capturable) {
      throw new Error(tab?.reason || 'Tab chưa sẵn sàng. Hãy bấm biểu tượng extension trên tab cần ghi.');
    }
  }
}

function chooseDesktopTabAudio() {
  return new Promise((resolve, reject) => {
    if (!chrome.desktopCapture?.chooseDesktopMedia) {
      reject(new Error('DESKTOP_CAPTURE_UNAVAILABLE|Chrome không cung cấp Desktop Capture API.'));
      return;
    }

    chrome.desktopCapture.chooseDesktopMedia(['tab', 'audio'], (streamId, options = {}) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(`DESKTOP_PICKER_FAILED|${lastError.message}`));
        return;
      }
      if (!streamId) {
        reject(new Error('DESKTOP_PICKER_CANCELLED|Bạn đã đóng hộp chọn tab mà chưa chọn nguồn.'));
        return;
      }
      if (!options.canRequestAudioTrack) {
        reject(new Error(
          'DESKTOP_AUDIO_DISABLED|Hãy chọn một tab đang phát âm thanh và bật “Chia sẻ âm thanh tab”.'
        ));
        return;
      }
      resolve({
        streamId,
        canRequestAudioTrack: true,
        title: 'Tab được chọn trong Chrome'
      });
    });
  });
}

async function start(config = formSettings(), desktopCapture = null) {
  clearError();
  await validateStartConfig(config);
  await saveSettings();
  setBusy(true);
  setGlobalPhase('starting');

  const response = await chrome.runtime.sendMessage({
    type: 'START_SESSION',
    config,
    desktopCapture
  });

  if (!response?.ok) throw new Error(response?.error || 'Không thể bắt đầu phiên.');
  applyRuntimeState(response.state);
}

function beginStartFromGesture() {
  clearError();
  const config = formSettings();
  const needsPicker = config.engine === 'deepgram'
    && ['tab', 'both'].includes(config.source)
    && config.tabCaptureMode === 'picker';

  if (!needsPicker) {
    start(config).catch(handleStartError);
    return;
  }

  // Gọi picker trực tiếp trong event click; không chuyển qua service worker.
  elements.globalStatus.textContent = 'Chọn tab…';
  elements.globalStatus.className = 'status-pill live';
  setBusy(true);
  chooseDesktopTabAudio()
    .then((capture) => start(config, capture))
    .catch(handleStartError);
}

function handleStartError(error) {
  mergeDiagnostics([{
    id: `start-error-${Date.now()}`,
    stage: 'error',
    status: 'error',
    detail: error.message,
    at: Date.now()
  }]);
  renderDiagnostics();
  setGlobalPhase('idle');
  showError(error.message);
}

async function stop() {
  setBusy(true);
  const response = await chrome.runtime.sendMessage({ type: 'STOP_SESSION' });
  if (!response?.ok) throw new Error(response?.error || 'Không thể dừng phiên.');
  applyRuntimeState(response.state);
}

function setBusy(value) {
  busy = value;
  updateActionButtons();
}

function updateActionButtons() {
  elements.startButton.disabled = busy || runtimePhase !== 'idle';
  elements.stopButton.disabled = busy || runtimePhase === 'idle';
}

function setGlobalPhase(phase) {
  runtimePhase = phase || 'idle';
  const live = ['starting', 'streaming'].includes(runtimePhase);
  const label = {
    idle: 'Sẵn sàng',
    starting: 'Đang mở…',
    streaming: 'Đang nghe',
    stopping: 'Đang dừng…'
  }[runtimePhase] || runtimePhase;

  elements.globalStatus.textContent = label;
  elements.globalStatus.className = `status-pill ${live ? 'live' : 'idle'}`;
  busy = ['starting', 'stopping'].includes(runtimePhase);
  updateActionButtons();
  if (runtimePhase === 'idle') {
    startedAt = null;
    updateTimer();
  }
}

function sourceStatusLabel(status) {
  return {
    connecting: 'Đang mở',
    streaming: 'Đang nghe',
    reconnecting: 'Đang nối lại',
    stopping: 'Đang dừng',
    stopped: 'Tắt',
    error: 'Lỗi'
  }[status] || 'Tắt';
}

function renderSourceState(source, state = {}) {
  const isTab = source === 'tab';
  const card = isTab ? elements.tabStatusCard : elements.micStatusCard;
  const label = isTab ? elements.tabState : elements.micState;
  const level = isTab ? elements.tabLevel : elements.micLevel;
  const active = ['connecting', 'streaming', 'reconnecting'].includes(state.status);

  card.classList.toggle('muted', !active);
  label.textContent = sourceStatusLabel(state.status);
  level.style.width = `${Math.round(Math.max(0, Math.min(1, state.level || 0)) * 100)}%`;
}

function mergeRuntimeTranscripts(items) {
  for (const event of items || []) {
    const index = transcriptState.final.findIndex((item) => item.id === event.id);
    if (index >= 0) transcriptState.final[index] = event;
    else transcriptState.final.push(event);
  }
}

function resetTranscriptState() {
  transcriptState.final = [];
  transcriptState.working.clear();
  followLive = true;
  elements.jumpLive.classList.add('hidden');
}

async function restoreSessionData(expectedSessionId = null) {
  const generation = ++restoreGeneration;
  const response = await chrome.runtime.sendMessage({ type: 'GET_SESSION_DATA' });
  if (!response?.ok) throw new Error(response?.error || 'Không khôi phục được phiên chép lời.');
  if (generation !== restoreGeneration) return;
  if (expectedSessionId && response.session?.id !== expectedSessionId) return;

  const incomingSession = response.session || null;
  if (incomingSession?.id && incomingSession.id !== currentSession?.id) {
    resetTranscriptState();
  }
  currentSession = incomingSession;
  mergeRuntimeTranscripts(response.segments);
  renderTranscripts();
}

const diagnosticLabels = {
  capabilities: 'API trình duyệt',
  session: 'Phiên nhận dạng',
  media: 'MediaStream',
  'audio-context': 'AudioContext',
  'audio-worklet': 'AudioWorklet',
  credential: 'Xác thực',
  websocket: 'Deepgram WebSocket',
  pipeline: 'Pipeline',
  transcript: 'Nhận dạng',
  error: 'Lỗi'
};

function mergeDiagnostics(items) {
  for (const event of items || []) {
    if (!event?.id || diagnosticState.some((item) => item.id === event.id)) continue;
    diagnosticState.push(event);
  }
  if (diagnosticState.length > 120) diagnosticState.splice(0, diagnosticState.length - 120);
}

function renderDiagnostics() {
  elements.diagnosticList.replaceChildren();
  if (!diagnosticState.length) {
    const empty = document.createElement('li');
    empty.className = 'diagnostic-empty';
    empty.textContent = 'Chưa có dữ liệu chẩn đoán.';
    elements.diagnosticList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const event of diagnosticState.slice(-80)) {
    const item = document.createElement('li');
    item.className = event.status || 'pending';
    const content = document.createElement('div');
    const title = document.createElement('strong');
    const source = event.source ? ` · ${event.source.toUpperCase()}` : '';
    title.textContent = `${diagnosticLabels[event.stage] || event.stage}${source}`;
    const detail = document.createElement('span');
    const time = new Date(event.at || Date.now()).toLocaleTimeString('vi-VN');
    detail.textContent = `${time} — ${displayError(event.detail || event.status)}`;
    content.append(title, detail);
    item.append(content);
    fragment.append(item);
  }
  elements.diagnosticList.append(fragment);
  elements.diagnosticList.scrollTop = elements.diagnosticList.scrollHeight;
}

async function runCapabilityCheck() {
  elements.capabilityStatus.textContent = 'Đang kiểm tra…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_CAPABILITIES' });
    if (!response?.ok) throw new Error(response?.error || 'Offscreen runtime không phản hồi.');
    capabilities = response;
    const browserChecks = response.browser || {};
    const offscreenChecks = response.offscreen || {};
    const failed = [
      ...Object.entries(browserChecks).filter(([key, value]) => key !== 'userAgent' && !value),
      ...Object.entries(offscreenChecks).filter(([, value]) => !value && value !== undefined)
    ].map(([key]) => key);

    mergeDiagnostics([{
      id: `capabilities-${Date.now()}`,
      stage: 'capabilities',
      status: failed.length ? 'warning' : 'ok',
      detail: failed.length
        ? `Thiếu hoặc tắt: ${failed.join(', ')}.`
        : 'Side Panel, Tab Capture, Desktop Capture, Offscreen, MediaDevices, AudioWorklet và WebSocket đã sẵn sàng.',
      at: Date.now()
    }]);
    elements.capabilityStatus.textContent = failed.length
      ? `${failed.length} API cần kiểm tra`
      : 'API sẵn sàng';
    renderDiagnostics();
  } catch (error) {
    elements.capabilityStatus.textContent = 'Runtime lỗi';
    mergeDiagnostics([{
      id: `capabilities-error-${Date.now()}`,
      stage: 'capabilities',
      status: 'error',
      detail: error.message,
      at: Date.now()
    }]);
    renderDiagnostics();
    showError(error.message);
  }
}

function diagnosticAsText() {
  const header = [
    `Saymee Live STT ${chrome.runtime.getManifest().version}`,
    capabilities?.browser?.userAgent || navigator.userAgent,
    `Thời điểm: ${new Date().toISOString()}`
  ];
  const lines = diagnosticState.map((event) => {
    const time = new Date(event.at || Date.now()).toISOString();
    return `[${time}] [${event.status}] [${event.stage}${event.source ? `/${event.source}` : ''}] ${displayError(event.detail)}`;
  });
  return [...header, '', ...lines].join('\n');
}

async function copyDiagnostics() {
  await navigator.clipboard.writeText(diagnosticAsText());
  elements.copyDiagnostic.textContent = 'Đã chép';
  setTimeout(() => { elements.copyDiagnostic.textContent = 'Sao chép nhật ký'; }, 1200);
}

function applyRuntimeState(state) {
  if (!state) return;
  startedAt = state.startedAt || startedAt;
  if (state.session?.id && state.session.id !== currentSession?.id) {
    resetTranscriptState();
    currentSession = state.session;
    restoreSessionData(state.session.id).catch((error) => showError(error.message));
  } else if (state.session) {
    currentSession = state.session;
  }
  setGlobalPhase(state.phase);
  renderSourceState('tab', state.sources?.tab);
  renderSourceState('mic', state.sources?.mic);
  mergeRuntimeTranscripts(state.transcripts);
  mergeDiagnostics(state.diagnostics);
  renderTranscripts();
  renderDiagnostics();
  updateTimer();

  if (state.error) showError(state.error);
  else clearError();
}

function upsertTranscript(event) {
  if (!event?.id || !event.text) return;
  if (event.sessionId && currentSession?.id && event.sessionId !== currentSession.id) return;

  if (event.final) {
    transcriptState.working.delete(event.id);
    const index = transcriptState.final.findIndex((item) => item.id === event.id);
    if (index >= 0) transcriptState.final[index] = event;
    else transcriptState.final.push(event);
  } else {
    transcriptState.working.set(event.id, event);
  }
  renderTranscripts(true);
}

function createTranscriptNode(event, partial = false) {
  const item = document.createElement('article');
  item.className = `transcript-item ${event.source} ${partial ? 'partial' : 'final'}`;

  const badge = document.createElement('span');
  badge.className = 'transcript-source';
  badge.textContent = event.source === 'tab' ? 'TAB' : 'MIC';

  const content = document.createElement('div');
  const text = document.createElement('p');
  text.className = 'transcript-text';
  text.textContent = event.text;

  const meta = document.createElement('div');
  meta.className = 'transcript-meta';
  const confidence = event.confidence ? ` · ${Math.round(event.confidence * 100)}%` : '';
  const speaker = Number.isFinite(event.speaker) ? ` · Người ${event.speaker + 1}` : '';
  const time = new Date(event.receivedAt || Date.now()).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  meta.textContent = `${partial ? 'Đang nhận dạng' : time}${confidence}${speaker}`;

  content.append(text, meta);
  item.append(badge, content);
  return item;
}

function createEmptyState() {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  const icon = document.createElement('div');
  icon.className = 'empty-icon';
  icon.textContent = '≋';
  const title = document.createElement('strong');
  title.textContent = 'Chưa có nội dung';
  const detail = document.createElement('span');
  detail.textContent = 'Chọn nguồn âm thanh rồi nhấn “Bắt đầu nhận dạng”.';
  empty.append(icon, title, detail);
  return empty;
}

function renderTranscripts(scrollToEnd = false) {
  const previousScrollTop = elements.transcriptList.scrollTop;
  const items = [
    ...transcriptState.final.map((event) => ({ event, partial: false })),
    ...transcriptState.working.values().map((event) => ({ event, partial: true }))
  ].sort((a, b) => (
    (a.event.startMs ?? a.event.receivedAt ?? 0)
    - (b.event.startMs ?? b.event.receivedAt ?? 0)
  ));

  elements.transcriptList.replaceChildren();
  if (items.length === 0) {
    elements.transcriptList.append(createEmptyState());
  } else {
    const fragment = document.createDocumentFragment();
    items.forEach(({ event, partial }) => fragment.append(createTranscriptNode(event, partial)));
    elements.transcriptList.append(fragment);
  }

  const allText = transcriptState.final.map((item) => item.text).join(' ').trim();
  const words = allText ? allText.split(/\s+/u).length : 0;
  elements.transcriptCount.textContent = `${transcriptState.final.length} đoạn`;
  elements.wordCount.textContent = `${words} từ`;
  if (scrollToEnd && followLive) {
    elements.transcriptList.scrollTop = elements.transcriptList.scrollHeight;
  } else if (!followLive) {
    elements.transcriptList.scrollTop = previousScrollTop;
  }
  elements.jumpLive.classList.toggle('hidden', followLive || items.length === 0);
}

async function getCompleteTranscript() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SESSION_DATA' });
  if (!response?.ok) throw new Error(response?.error || 'Không đọc được dữ liệu phiên.');
  if (response.session) currentSession = response.session;
  return {
    session: response.session || currentSession || {},
    segments: response.segments || transcriptState.final
  };
}

async function copyTranscript() {
  const { segments } = await getCompleteTranscript();
  const text = exportTxt(segments);
  if (!text) return;
  await navigator.clipboard.writeText(text);
  elements.copyButton.textContent = 'Đã chép';
  setTimeout(() => { elements.copyButton.textContent = 'Sao chép'; }, 1200);
}

async function exportTranscript() {
  const { session, segments } = await getCompleteTranscript();
  if (!segments.length) return;
  const exported = buildExport(elements.exportFormat.value, session, segments);
  const blob = new Blob([exported.content], { type: exported.mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  const exportedAt = new Date(session.startedAt || Date.now()).toISOString().replace(/[:.]/g, '-');
  anchor.download = `saymee-live-${exportedAt}.${exported.extension}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function clearTranscript() {
  resetTranscriptState();
  renderTranscripts();
  const response = await chrome.runtime.sendMessage({ type: 'CLEAR_TRANSCRIPTS' });
  if (!response?.ok) throw new Error(response?.error || 'Không xóa được bản chép lời.');
}

function updateTimer() {
  if (!startedAt || runtimePhase === 'idle') {
    elements.sessionTimer.textContent = '00:00';
    return;
  }
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  elements.sessionTimer.textContent = hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.target !== 'ui') return;
  if (message.type === 'TRANSCRIPT_EVENT') upsertTranscript(message.event);
  if (message.type === 'RUNTIME_STATE') applyRuntimeState(message.state);
  if (message.type === 'RUNTIME_ERROR') showError(message.error);
  if (message.type === 'DIAGNOSTIC_EVENT') {
    mergeDiagnostics([message.event]);
    renderDiagnostics();
  }
  if (message.type === 'AUDIO_LEVEL') {
    const level = Math.max(0, Math.min(1, Number(message.level) || 0));
    const bar = message.source === 'tab' ? elements.tabLevel : elements.micLevel;
    bar.style.width = `${Math.round(level * 100)}%`;
  }
});

for (const element of [
  elements.source,
  elements.tabCaptureMode,
  elements.language,
  elements.diarize,
  elements.authMode,
  elements.tokenEndpoint,
  elements.rememberApiKey
]) {
  element.addEventListener('change', () => {
    saveSettings().catch((error) => showError(error.message));
  });
}

elements.engine.addEventListener('change', () => {
  if (activeEngine === 'deepgram') {
    lastDeepgramSettings = {
      source: elements.source.value,
      tabCaptureMode: elements.tabCaptureMode.value,
      language: elements.language.value,
      diarize: elements.diarize.checked
    };
  }

  if (elements.engine.value === 'deepgram') {
    elements.source.value = lastDeepgramSettings.source;
    elements.tabCaptureMode.value = lastDeepgramSettings.tabCaptureMode;
    elements.language.value = lastDeepgramSettings.language;
    elements.diarize.checked = Boolean(lastDeepgramSettings.diarize);
  }

  activeEngine = elements.engine.value;
  updateMode();
  saveSettings().catch((error) => showError(error.message));
});
elements.source.addEventListener('change', updateSourceControls);
elements.tabCaptureMode.addEventListener('change', updateSourceControls);
elements.authMode.addEventListener('change', updateAuthMode);
elements.apiKey.addEventListener('input', () => {
  chrome.storage.session.set({ [SESSION_API_KEY]: elements.apiKey.value.trim() }).catch(() => {});
});
elements.testConnection.addEventListener('click', testConnection);
elements.startButton.addEventListener('click', beginStartFromGesture);
elements.stopButton.addEventListener('click', () => stop().catch((error) => {
  setBusy(false);
  showError(error.message);
}));
elements.grantMic.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_MIC_PERMISSION' }).catch((error) => showError(error.message));
});
elements.copyButton.addEventListener('click', () => copyTranscript().catch((error) => showError(error.message)));
elements.exportButton.addEventListener('click', () => exportTranscript().catch((error) => showError(error.message)));
elements.clearButton.addEventListener('click', () => clearTranscript().catch((error) => showError(error.message)));
elements.transcriptList.addEventListener('scroll', () => {
  const distanceToBottom = (
    elements.transcriptList.scrollHeight
    - elements.transcriptList.scrollTop
    - elements.transcriptList.clientHeight
  );
  followLive = distanceToBottom < 48;
  elements.jumpLive.classList.toggle(
    'hidden',
    followLive || (!transcriptState.final.length && !transcriptState.working.size)
  );
});
elements.jumpLive.addEventListener('click', () => {
  followLive = true;
  elements.transcriptList.scrollTop = elements.transcriptList.scrollHeight;
  elements.jumpLive.classList.add('hidden');
});
elements.runDiagnostic.addEventListener('click', runCapabilityCheck);
elements.copyDiagnostic.addEventListener('click', () => {
  copyDiagnostics().catch((error) => showError(error.message));
});

window.addEventListener('focus', () => {
  if (elements.tabCaptureMode.value === 'active_tab') refreshTabContext();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && elements.tabCaptureMode.value === 'active_tab') refreshTabContext();
});

timerHandle = setInterval(updateTimer, 1000);
window.addEventListener('unload', () => clearInterval(timerHandle), { once: true });

await loadSettings();
renderTranscripts();
renderDiagnostics();
if (elements.tabCaptureMode.value === 'active_tab') setTimeout(refreshTabContext, 250);
await runCapabilityCheck();

try {
  const response = await chrome.runtime.sendMessage({ type: 'GET_RUNTIME_STATE' });
  if (response?.ok) {
    applyRuntimeState(response.state);
    await restoreSessionData(response.state?.session?.id || null);
  }
} catch {
  setGlobalPhase('idle');
}
