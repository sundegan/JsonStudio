import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('tauri updater uses GitHub Releases as the update endpoint', () => {
  const config = JSON.parse(
    readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
  );

  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.equal(
    config.plugins.updater.endpoints[0],
    'https://github.com/sundegan/JsonStudio/releases/latest/download/latest.json'
  );
  assert.match(config.plugins.updater.pubkey, /^[A-Za-z0-9+/=]+$/);
  assert.ok(config.plugins.updater.pubkey.length > 40);
  assert.equal(config.plugins.updater.windows.installMode, 'passive');
});

test('release workflow signs updater bundles and publishes latest.json', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/build-release.yml', import.meta.url),
    'utf8'
  );

  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{\s*secrets\.TAURI_SIGNING_PRIVATE_KEY\s*\}\}/);
  assert.match(
    workflow,
    /TAURI_SIGNING_PRIVATE_KEY_PASSWORD:\s*\$\{\{\s*secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD\s*\}\}/
  );
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.match(workflow, /latest\.json/);
  assert.match(workflow, /darwin-aarch64/);
  assert.match(workflow, /darwin-x86_64/);
  assert.match(workflow, /linux-x86_64/);
  assert.match(workflow, /windows-x86_64/);
  assert.match(workflow, /softprops\/action-gh-release@v2\.6\.2/);
});

test('release workflow publishes a Windows portable zip without changing updater asset', () => {
  const releaseWorkflow = readFileSync(
    new URL('../.github/workflows/build-release.yml', import.meta.url),
    'utf8'
  );
  const buildTestWorkflow = readFileSync(
    new URL('../.github/workflows/build-test.yml', import.meta.url),
    'utf8'
  );

  assert.match(
    releaseWorkflow,
    /UPDATER_FILE="\$RELEASE_DIR\/Json Studio_\$\{VERSION_NO_V\}_windows_\$\{\{ matrix\.arch_suffix \}\}-setup\.exe"/
  );
  assert.match(
    releaseWorkflow,
    /PORTABLE_ZIP="\$RELEASE_DIR\/Json Studio_\$\{VERSION_NO_V\}_windows_\$\{\{ matrix\.arch_suffix \}\}-portable\.zip"/
  );
  assert.match(releaseWorkflow, /PORTABLE_EXE_CANDIDATES=\(/);
  assert.match(releaseWorkflow, /for candidate in "\$\{PORTABLE_EXE_CANDIDATES\[@\]\}"; do/);
  assert.match(releaseWorkflow, /if \[ -f "\$candidate" \]; then/);
  assert.match(releaseWorkflow, /cp "\$PORTABLE_EXE" "\$PORTABLE_ROOT\/Json Studio\.exe"/);
  assert.match(releaseWorkflow, /Compress-Archive -Path \\?\$env:PORTABLE_ROOT_WIN -DestinationPath \\?\$env:PORTABLE_ZIP_WIN -Force/);
  assert.match(releaseWorkflow, /windows_x64-portable\.zip/);
  assert.match(buildTestWorkflow, /PORTABLE_ZIP="\$BUNDLE_DIR\/Json Studio_\$\{VERSION\}_windows_\$\{\{ matrix\.arch_suffix \}\}-portable\.zip"/);
  assert.match(buildTestWorkflow, /-name "\*\.zip"/);
});
