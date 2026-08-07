'use strict';

/**
 * Builds the unpacked (--dir) Windows target and smoke-tests the actual
 * packaged output, not just the dev tree. Exists specifically to catch
 * regressions in electron-builder's native-module rebuild pipeline
 * (@electron/rebuild -> node-gyp), which is easy to break silently by
 * touching node-gyp/undici pins without ever running a real pack -- `npm
 * start` never exercises that path since it uses the dev-installed
 * @vscode/sqlite3 binary directly.
 *
 * Usage: node scripts/test-unpack.cjs
 * Exit code 0 on pass, 1 on any failure.
 */

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync, spawn } = require('node:child_process');
const { chromium } = require('D:\\npm\\cache\\_npx\\e41f203b7505f1fb\\node_modules\\playwright');

const ROOT = path.join(__dirname, '..');
const UNPACKED_DIR = path.join(ROOT, 'dist', 'win-unpacked');
const EXE = path.join(UNPACKED_DIR, 'Midnight Athenaeum.exe');
const NATIVE_BINDING = path.join(
  UNPACKED_DIR, 'resources', 'app.asar.unpacked',
  'node_modules', '@vscode', 'sqlite3', 'build', 'Release',
);
const DEMO_DATA_ROOT = path.join(ROOT, 'demo-data');
const CDP_PORT = 9334;

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
  return ok;
}

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  console.log('--- Building unpacked Windows target (npm run pack) ---');
  const build = spawnSync('npm', ['run', 'pack'], { cwd: ROOT, shell: true, encoding: 'utf8' });
  if (!check('electron-builder pack succeeded', build.status === 0, `exit ${build.status}`)) {
    console.log(build.stdout?.slice(-4000));
    console.log(build.stderr?.slice(-4000));
    process.exit(1);
  }

  check('unpacked exe exists', fs.existsSync(EXE), EXE);

  // The regression this test exists to catch: did electron-builder's
  // node-gyp-driven rebuild of @vscode/sqlite3 actually produce a binary,
  // given the scoped `node-gyp` -> undici override in package.json.
  let nativeBuilt = false;
  if (fs.existsSync(NATIVE_BINDING)) {
    nativeBuilt = fs.readdirSync(NATIVE_BINDING).some((f) => f.endsWith('.node'));
  }
  check('native sqlite3 binding was rebuilt into the package', nativeBuilt, NATIVE_BINDING);

  console.log('\n--- Launching the packaged exe against the demo library ---');
  // Electron treats *presence* of ELECTRON_RUN_AS_NODE as "run as plain
  // Node" regardless of its value -- setting it to '' still trips this and
  // makes the app exit silently with code 0 (looks like a launch crash but
  // isn't). Must actually delete the key, not just blank it. This machine
  // sets it to 1 at the user env level, inherited by every shell.
  const childEnv = { ...process.env, MIDNIGHT_ATHENAEUM_DATA_ROOT: DEMO_DATA_ROOT };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(EXE, [`--remote-debugging-port=${CDP_PORT}`], {
    cwd: UNPACKED_DIR,
    env: childEnv,
    detached: true,
  });
  child.unref();

  try {
    const cdpUp = await waitForCdp(CDP_PORT, 20000);
    check('packaged app opened a CDP-reachable window', cdpUp);
    if (!cdpUp) return;

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    // The CDP endpoint answering /json/version doesn't guarantee the
    // renderer's page target is registered yet -- poll briefly rather than
    // assuming context.pages() is populated on the first connect.
    let page = null;
    for (let i = 0; i < 10 && !page; i++) {
      const context = browser.contexts()[0];
      const pages = context ? context.pages() : [];
      page = pages.find((p) => p.url().includes('index.html')) || pages[0] || null;
      if (!page) await new Promise((r) => setTimeout(r, 500));
    }
    if (!check('found the renderer page target over CDP', Boolean(page))) return;
    await page.waitForTimeout(1500);

    const title = await page.title();
    check('window title is "Midnight Athenaeum"', title === 'Midnight Athenaeum', title);

    const bookCountText = await page.locator('text=/\\d+ books?/').first().textContent().catch(() => null);
    check('library loaded books from the (real, rebuilt) sqlite3 binding', Boolean(bookCountText), bookCountText);

    const cardCount = await page.locator('.card[data-book-id]').count();
    check('book cards rendered in the grid', cardCount > 0, `${cardCount} cards`);

    await browser.close();
  } finally {
    try { process.kill(child.pid); } catch { /* already gone */ }
  }
}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('test-unpack crashed:', err);
    process.exit(1);
  });
