const OFFSCREEN_URL = 'offscreen.html';
const CAPTURABLE_PROTOCOLS = new Set(['http:', 'https:', 'file:']);
let creatingOffscreen = null;

async function enableAutomaticPanelOpen() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn('Không thể đặt hành vi side panel:', error);
  }
}

chrome.runtime.onInstalled.addListener(enableAutomaticPanelOpen);
chrome.runtime.onStartup.addListener(enableAutomaticPanelOpen);
enableAutomaticPanelOpen();

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) return;
  if (creatingOffscreen) return creatingOffscreen;

  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Thu, phát lại và xử lý âm thanh tab/microphone trong AudioWorklet để truyền trực tiếp tới STT.'
  });

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function getActiveTabStreamId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('Không tìm thấy tab đang hoạt động.');

  const currentUrl = tab.url || '';
  const eligibility = await inspectCaptureEligibility(currentUrl);
  if (!eligibility.ok) {
    throw new Error(`TAB_NOT_CAPTURABLE|${eligibility.reason}`);
  }

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch (error) {
    const raw = error?.message || String(error);
    if (/not been invoked|activeTab/i.test(raw)) {
      throw new Error(
        'TAB_NOT_INVOKED|Quyền activeTab không còn hiệu lực. Hãy chọn “Hộp chọn tab của Chrome” hoặc bấm lại biểu tượng extension trên chính tab cần ghi.'
      );
    }
    if (/cannot be captured|chrome pages/i.test(raw)) {
      throw new Error(
        'TAB_NOT_CAPTURABLE|Chrome không cho extension ghi âm trang nội bộ. Hãy chuyển sang một trang web HTTP/HTTPS hoặc chọn chỉ Microphone.'
      );
    }
    throw new Error(`TAB_CAPTURE_FAILED|Không lấy được âm thanh tab: ${raw}`);
  }

  return { streamId, tabId: tab.id, title: tab.title || 'Tab hiện tại' };
}

async function inspectCaptureEligibility(rawUrl) {
  if (!rawUrl) {
    return {
      ok: false,
      reason: 'Không đọc được địa chỉ tab. Hãy bấm lại biểu tượng extension trên tab cần ghi.'
    };
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Địa chỉ tab không hợp lệ.' };
  }

  if (!CAPTURABLE_PROTOCOLS.has(url.protocol)) {
    return {
      ok: false,
      reason: `Không thể ghi trang ${url.protocol}//. Chrome chặn ghi âm chrome://, trang cài đặt, cửa hàng tiện ích và trang nội bộ.`
    };
  }

  if (url.protocol === 'file:') {
    const allowed = await chrome.extension.isAllowedFileSchemeAccess();
    if (!allowed) {
      return {
        ok: false,
        reason: 'Muốn ghi tab file://, hãy bật “Cho phép truy cập vào URL của tệp” trong trang quản lý extension.'
      };
    }
  }

  return { ok: true, reason: '' };
}

async function getTabContext() {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const url = active?.url || '';
  const eligibility = active
    ? await inspectCaptureEligibility(url)
    : { ok: false, reason: 'Không tìm thấy tab hiện tại.' };

  return {
    ok: true,
    tab: active
      ? {
          id: active.id,
          title: active.title || 'Tab hiện tại',
          url,
          capturable: eligibility.ok,
          reason: eligibility.reason
        }
      : null
  };
}

async function sendToOffscreen(message) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target === 'offscreen' || message.target === 'ui') return false;

  (async () => {
    switch (message.type) {
      case 'START_SESSION': {
        const config = structuredClone(message.config || {});
        let tabCapture = null;

        if (config.source === 'tab' || config.source === 'both') {
          if (message.desktopCapture?.streamId) {
            tabCapture = {
              streamId: message.desktopCapture.streamId,
              captureType: 'desktop',
              canRequestAudioTrack: Boolean(message.desktopCapture.canRequestAudioTrack),
              title: message.desktopCapture.title || 'Tab đã chọn'
            };
          } else {
            tabCapture = {
              ...(await getActiveTabStreamId()),
              captureType: 'tab'
            };
          }
        }

        const result = await sendToOffscreen({
          type: 'START_SESSION',
          config,
          tabCapture
        });
        sendResponse(result || { ok: true });
        break;
      }

      case 'GET_TAB_CONTEXT': {
        sendResponse(await getTabContext());
        break;
      }

      case 'GET_CAPABILITIES': {
        const offscreen = await sendToOffscreen({ type: 'HEALTH_CHECK' });
        sendResponse({
          ok: Boolean(offscreen?.ok),
          browser: {
            userAgent: navigator.userAgent,
            sidePanel: Boolean(chrome.sidePanel),
            tabCapture: Boolean(chrome.tabCapture),
            desktopCapture: Boolean(chrome.desktopCapture),
            offscreen: Boolean(chrome.offscreen)
          },
          offscreen: offscreen?.capabilities || null
        });
        break;
      }

      case 'TEST_CREDENTIAL': {
        const result = await sendToOffscreen({
          type: 'TEST_CREDENTIAL',
          config: structuredClone(message.config || {})
        });
        sendResponse(result || { ok: true });
        break;
      }

      case 'STOP_SESSION': {
        const result = await sendToOffscreen({ type: 'STOP_SESSION' });
        sendResponse(result || { ok: true });
        break;
      }

      case 'CLEAR_TRANSCRIPTS': {
        const result = await sendToOffscreen({ type: 'CLEAR_TRANSCRIPTS' });
        sendResponse(result || { ok: true });
        break;
      }

      case 'GET_RUNTIME_STATE': {
        const result = await sendToOffscreen({ type: 'GET_RUNTIME_STATE' });
        sendResponse(result || { ok: true, state: null });
        break;
      }

      case 'OPEN_MIC_PERMISSION': {
        await chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Thông điệp không được hỗ trợ.' });
    }
  })().catch((error) => {
    console.error(error);
    sendResponse({ ok: false, error: error?.message || String(error) });
  });

  return true;
});
