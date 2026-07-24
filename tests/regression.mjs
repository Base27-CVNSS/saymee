import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const [
  manifestText,
  background,
  offscreen,
  panel,
  panelHtml,
  panelCss,
  transcriptCore,
  transcriptStore,
  readme,
  license
] = await Promise.all([
  read('manifest.json'),
  read('background.js'),
  read('offscreen.js'),
  read('sidepanel.js'),
  read('sidepanel.html'),
  read('sidepanel.css'),
  read('transcript-core.mjs'),
  read('transcript-store.mjs'),
  read('README.md'),
  read('LICENSE')
]);
const manifest = JSON.parse(manifestText);

assert.match(panel, /engine:\s*'deepgram'/u);
assert.match(panel, /source:\s*'tab'/u);
assert.match(panel, /tabCaptureMode:\s*'active_tab'/u);
assert.match(panel, /language:\s*'vi'/u);
assert.match(panel, /model:\s*'nova-3'/u);
assert.match(offscreen, /model:\s*config\.model \|\| 'nova-3'/u);
assert.match(offscreen, /language:\s*config\.language \|\| 'vi'/u);

assert.match(
  offscreen,
  /engine === 'browser' && source !== 'mic'/u,
  'Chrome Speech must remain microphone-only.'
);
assert.doesNotMatch(manifest.permissions.join(','), /microphone/u);
assert.match(panel, /lastDeepgramSettings/u);
assert.match(panel, /LEGACY_SETTINGS_KEY\s*=\s*'saydiLiveSettings'/u);
assert.match(panel, /LEGACY_SESSION_API_KEY\s*=\s*'saydiSessionApiKey'/u);

assert.match(offscreen, /createSession\(runtimeState\.config/u);
assert.match(offscreen, /normalizeTranscriptEvent/u);
assert.match(offscreen, /MAX_TRANSCRIPT_CACHE = 300/u);
assert.match(transcriptStore, /const DB_NAME = 'saymee-db'/u);
assert.match(transcriptStore, /if \(!segment\?\.final\) return segment/u);
assert.match(panel, /restoreSessionData/u);
assert.match(background, /GET_SESSION_DATA/u);

for (const format of ['txt', 'json', 'srt', 'vtt']) {
  assert.match(transcriptCore, new RegExp(`${format}: \\{`, 'u'));
  assert.match(panelHtml, new RegExp(`<option value="${format}">`, 'u'));
}
assert.match(transcriptCore, /startMs !== null && endMs !== null/u);
assert.match(offscreen, /socketSampleBase/u);
assert.match(panel, /followLive/u);
assert.match(panelHtml, /id="jumpLive"/u);
assert.match(panelCss, /\.transcript-item\.partial \.transcript-text/u);

assert.match(offscreen, /reconnectStableTimer/u);
assert.match(offscreen, /socketGeneration/u);
assert.match(offscreen, /stopPromise/u);
assert.match(offscreen, /AUDIO_CONTEXT_SUSPENDED/u);
assert.match(offscreen, /recentFinalFingerprints/u);
assert.match(offscreen, /runtimeState\.error = null/u);

const serializedConfigBlock = offscreen.match(/runtimeState\.config = \{([\s\S]*?)\n  \};/u)?.[1] || '';
assert.ok(serializedConfigBlock, 'Runtime config block not found.');
assert.doesNotMatch(serializedConfigBlock, /apiKey|tokenEndpoint|credential/iu);

async function sourceFiles(directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await sourceFiles(path));
    else if (['.js', '.mjs', '.json', '.md', ''].includes(extname(entry.name))) paths.push(path);
  }
  return paths;
}

const credentialPatterns = [
  /\bdg_[A-Za-z0-9]{20,}\b/u,
  /Authorization:\s*Token\s+[A-Za-z0-9_-]{20,}/u,
  /DEEPGRAM_API_KEY\s*=\s*["'](?!YOUR_|<)[^"']+["']/u
];
for (const path of await sourceFiles()) {
  const content = await readFile(path, 'utf8');
  for (const pattern of credentialPatterns) {
    assert.doesNotMatch(content, pattern, `Possible credential in ${path}`);
  }
}

assert.equal(manifest.name, 'Saymee Live STT');
assert.equal(manifest.author, 'Long Ngo');
assert.match(license, /MIT License/u);
assert.match(license, /Long Ngo/u);
assert.match(readme, /TXT, JSON, SRT và WebVTT/u);
assert.match(readme, /IndexedDB/u);
assert.doesNotMatch(readme, /không có cơ sở dữ liệu transcript/iu);

console.log('Saymee full regression test: OK');
