import assert from 'node:assert/strict';
import {
  buildCues,
  buildExport,
  createSession,
  dedupeSegments,
  exportJson,
  exportSrt,
  exportTxt,
  exportVtt,
  formatSrtTimestamp,
  formatVttTimestamp,
  normalizeTranscriptEvent
} from '../transcript-core.mjs';

const session = createSession(
  { source: 'tab', engine: 'deepgram', language: 'vi', model: 'nova-3' },
  {
    id: 'saymee-test-session',
    startedAt: 1_700_000_000_000,
    title: 'Kiểm thử tiếng Việt'
  }
);

const normalized = normalizeTranscriptEvent({
  id: 'segment-1',
  source: 'tab',
  text: '  Xin chào Việt Nam ✨  ',
  final: true,
  speechFinal: true,
  confidence: 1.4,
  speaker: 0,
  startMs: -20,
  durationMs: 1250,
  receivedAt: session.startedAt + 1250
}, { session });

assert.deepEqual(normalized, {
  id: 'segment-1',
  sessionId: session.id,
  source: 'tab',
  engine: 'deepgram',
  text: 'Xin chào Việt Nam ✨',
  final: true,
  speechFinal: true,
  startMs: 0,
  endMs: 1250,
  durationMs: 1250,
  receivedAt: session.startedAt + 1250,
  speaker: 0,
  confidence: 1
});

const interim = { ...normalized, text: 'Xin chào', final: false };
assert.deepEqual(dedupeSegments([interim, normalized]), [normalized]);
assert.deepEqual(dedupeSegments([normalized, interim]), [normalized]);

assert.equal(formatSrtTimestamp(3_723_004), '01:02:03,004');
assert.equal(formatVttTimestamp(3_723_004), '01:02:03.004');
assert.equal(formatSrtTimestamp(-1), '00:00:00,000');

const untimed = normalizeTranscriptEvent({
  id: 'segment-2',
  source: 'mic',
  engine: 'browser',
  text: 'Đoạn không có media timestamp',
  final: true,
  receivedAt: session.startedAt + 3000
}, { session });
const cues = buildCues(session, [normalized, untimed]);
assert.equal(cues.length, 2);
assert.ok(cues[1].startMs >= 3000);
assert.ok(cues[1].endMs > cues[1].startMs);

const segments = [normalized, untimed];
assert.match(exportTxt(segments), /Xin chào Việt Nam ✨/u);
assert.match(exportSrt(session, segments), /00:00:00,000 --> 00:00:01,250/u);
assert.match(exportVtt(session, segments), /^WEBVTT\n\n/u);
const json = JSON.parse(exportJson(session, segments));
assert.equal(json.session.id, session.id);
assert.equal(json.segments.length, 2);
assert.equal(json.segments[0].sessionId, session.id);

for (const format of ['txt', 'json', 'srt', 'vtt']) {
  const exported = buildExport(format, session, segments);
  assert.equal(exported.extension, format);
  assert.ok(exported.content.length > 10);
}
assert.throws(() => buildExport('pdf', session, segments), /không được hỗ trợ/u);

const largeSession = {
  ...session,
  id: 'saymee-large-session'
};
const largeSegments = Array.from({ length: 1000 }, (_, index) => (
  normalizeTranscriptEvent({
    id: `large-${index}`,
    text: `Đoạn kiểm thử ${index + 1}`,
    final: true,
    startMs: index * 1000,
    durationMs: 900,
    receivedAt: session.startedAt + index * 1000
  }, { session: largeSession })
));
assert.equal(dedupeSegments(largeSegments).length, 1000);
assert.match(exportSrt(largeSession, largeSegments), /^1\n/u);
assert.match(exportSrt(largeSession, largeSegments), /\n\n1000\n/u);

console.log('Saymee transcript core test: OK');
