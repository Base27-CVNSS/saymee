const DEFAULT_SEGMENT_DURATION_MS = 1800;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeMs(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.max(0, Math.round(number));
}

export function createSessionId(now = Date.now(), random = Math.random) {
  const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const suffix = random().toString(36).slice(2, 10).padEnd(8, '0');
  return `saymee-${timestamp}-${suffix}`;
}

export function createSession(config = {}, options = {}) {
  const startedAt = finiteNumber(options.startedAt) ?? Date.now();
  return {
    id: options.id || createSessionId(startedAt, options.random),
    startedAt,
    endedAt: null,
    title: String(options.title || 'Phiên Saymee').slice(0, 240),
    source: config.source || 'tab',
    engine: config.engine || 'deepgram',
    language: config.language || 'vi',
    model: config.model || 'nova-3'
  };
}

export function normalizeTranscriptEvent(event = {}, context = {}) {
  const session = context.session || {};
  const receivedAt = finiteNumber(event.receivedAt) ?? Date.now();
  const startMs = nonNegativeMs(event.startMs);
  const durationMs = nonNegativeMs(event.durationMs);
  let endMs = nonNegativeMs(event.endMs);
  if (endMs === null && startMs !== null && durationMs !== null) {
    endMs = startMs + durationMs;
  }
  if (startMs !== null && endMs !== null && endMs < startMs) {
    endMs = startMs;
  }

  const confidence = finiteNumber(event.confidence);
  const speaker = finiteNumber(event.speaker);
  const source = event.source || context.source || session.source || 'mic';
  const engine = event.engine || context.engine || session.engine || 'deepgram';
  const sessionId = event.sessionId || context.sessionId || session.id || null;
  const text = String(event.text || '').trim();

  return {
    id: String(event.id || `${sessionId || 'session'}-${source}-${receivedAt}`),
    sessionId,
    source,
    engine,
    text,
    final: Boolean(event.final),
    speechFinal: Boolean(event.speechFinal),
    startMs,
    endMs,
    durationMs: startMs !== null && endMs !== null
      ? Math.max(0, endMs - startMs)
      : durationMs,
    receivedAt,
    speaker: speaker === null ? null : Math.max(0, Math.round(speaker)),
    confidence: confidence === null ? null : Math.max(0, Math.min(1, confidence))
  };
}

export function dedupeSegments(segments = []) {
  const byId = new Map();
  for (const segment of segments) {
    if (!segment?.id || !segment.text) continue;
    const previous = byId.get(segment.id);
    if (!previous || segment.final || !previous.final) {
      byId.set(segment.id, { ...previous, ...segment });
    }
  }
  return [...byId.values()].sort((left, right) => {
    const leftTime = finiteNumber(left.startMs) ?? finiteNumber(left.receivedAt) ?? 0;
    const rightTime = finiteNumber(right.startMs) ?? finiteNumber(right.receivedAt) ?? 0;
    return leftTime - rightTime || String(left.id).localeCompare(String(right.id));
  });
}

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

export function formatSrtTimestamp(value) {
  const ms = nonNegativeMs(value) ?? 0;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(ms % 1000, 3)}`;
}

export function formatVttTimestamp(value) {
  return formatSrtTimestamp(value).replace(',', '.');
}

function estimateDuration(text) {
  return Math.max(1200, Math.min(6500, String(text || '').length * 70));
}

export function buildCues(session = {}, segments = []) {
  const finalSegments = dedupeSegments(segments).filter((segment) => segment.final);
  let fallbackCursor = 0;

  return finalSegments.map((segment) => {
    const explicitStart = nonNegativeMs(segment.startMs);
    const explicitEnd = nonNegativeMs(segment.endMs);
    const explicitDuration = nonNegativeMs(segment.durationMs);
    const wallOffset = Math.max(
      0,
      (finiteNumber(segment.receivedAt) ?? session.startedAt ?? 0) - (session.startedAt ?? 0)
    );
    const startMs = explicitStart ?? Math.max(fallbackCursor, wallOffset);
    let endMs = explicitEnd;
    if (endMs === null && explicitDuration !== null) endMs = startMs + explicitDuration;
    if (endMs === null || endMs <= startMs) endMs = startMs + estimateDuration(segment.text);
    if (explicitStart === null) fallbackCursor = endMs + 80;

    const source = segment.source === 'tab' ? 'TAB' : 'MIC';
    const speaker = Number.isFinite(segment.speaker) ? ` · Người ${segment.speaker + 1}` : '';
    return {
      ...segment,
      startMs,
      endMs,
      cueText: `[${source}${speaker}] ${segment.text}`
    };
  });
}

export function exportTxt(segments = []) {
  return dedupeSegments(segments)
    .filter((segment) => segment.final)
    .map((segment) => {
      const source = segment.source === 'tab' ? 'TAB' : 'MIC';
      const speaker = Number.isFinite(segment.speaker) ? ` / Người ${segment.speaker + 1}` : '';
      const time = new Date(segment.receivedAt || Date.now()).toLocaleTimeString('vi-VN');
      return `[${time}] [${source}${speaker}] ${segment.text}`;
    })
    .join('\n');
}

export function exportJson(session = {}, segments = []) {
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    session: { ...session },
    segments: dedupeSegments(segments).filter((segment) => segment.final)
  }, null, 2);
}

export function exportSrt(session = {}, segments = []) {
  return buildCues(session, segments).map((cue, index) => [
    String(index + 1),
    `${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}`,
    cue.cueText
  ].join('\n')).join('\n\n');
}

export function exportVtt(session = {}, segments = []) {
  const cues = buildCues(session, segments).map((cue) => [
    `${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}`,
    cue.cueText
  ].join('\n')).join('\n\n');
  return `WEBVTT\n\n${cues}${cues ? '\n' : ''}`;
}

export function buildExport(format, session = {}, segments = []) {
  const normalizedFormat = String(format || 'txt').toLowerCase();
  const exporters = {
    txt: {
      extension: 'txt',
      mime: 'text/plain;charset=utf-8',
      content: `\uFEFF${exportTxt(segments)}`
    },
    json: {
      extension: 'json',
      mime: 'application/json;charset=utf-8',
      content: exportJson(session, segments)
    },
    srt: {
      extension: 'srt',
      mime: 'application/x-subrip;charset=utf-8',
      content: `\uFEFF${exportSrt(session, segments)}`
    },
    vtt: {
      extension: 'vtt',
      mime: 'text/vtt;charset=utf-8',
      content: exportVtt(session, segments)
    }
  };
  if (!exporters[normalizedFormat]) {
    throw new Error(`Định dạng export không được hỗ trợ: ${normalizedFormat}`);
  }
  return { format: normalizedFormat, ...exporters[normalizedFormat] };
}
