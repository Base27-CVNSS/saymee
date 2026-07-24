import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const background = await readFile(resolve(root, 'background.js'), 'utf8');
const offscreen = await readFile(resolve(root, 'offscreen.js'), 'utf8');
const panel = await readFile(resolve(root, 'sidepanel.js'), 'utf8');
const panelHtml = await readFile(resolve(root, 'sidepanel.html'), 'utf8');

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, '1.1.0');
assert.equal(manifest.minimum_chrome_version, '116');
for (const permission of ['activeTab', 'desktopCapture', 'offscreen', 'sidePanel', 'storage', 'tabCapture']) {
  assert.ok(manifest.permissions.includes(permission), `Thiếu permission ${permission}`);
}
assert.ok(manifest.host_permissions.includes('http://127.0.0.1/*'));
assert.match(background, /openPanelOnActionClick:\s*true/);
assert.match(background, /captureType:\s*'desktop'/);
assert.match(background, /TAB_NOT_INVOKED/);
assert.match(background, /TAB_NOT_CAPTURABLE/);
assert.match(offscreen, /SpeechRecognition|webkitSpeechRecognition/);
assert.match(offscreen, /TOKEN_FETCH_FAILED/);
assert.match(offscreen, /interim_results/);
assert.match(offscreen, /createDesktopStream/);
assert.match(offscreen, /logDiagnostic/);
assert.match(panel, /GET_TAB_CONTEXT/);
assert.match(panel, /chooseDesktopMedia\(\['tab', 'audio'\]/);
assert.match(panel, /startButton\.addEventListener\('click', beginStartFromGesture\)/);
assert.match(panel, /busy = \['starting', 'stopping'\]\.includes\(runtimePhase\)/);
assert.match(panel, /engine:\s*'deepgram'/);
assert.match(panel, /source:\s*'tab'/);
assert.match(panel, /tabCaptureMode:\s*'active_tab'/);
assert.match(panel, /LEGACY_SETTINGS_KEY\s*=\s*'saydiLiveSettings'/);
assert.match(panel, /LEGACY_SESSION_API_KEY\s*=\s*'saydiSessionApiKey'/);
assert.match(panelHtml, /Chrome Speech/);
assert.match(manifest.name, /Saymee/);

console.log('Saymee Live STT smoke test: OK');
