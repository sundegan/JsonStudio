import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const configuredRounds = Number.parseInt(
  process.env.JSON_STUDIO_E2E_ROUNDS || '3',
  10,
);
const PERFORMANCE_ROUNDS = Number.isFinite(configuredRounds)
  ? Math.max(1, configuredRounds)
  : 3;
const BASELINE_OUTPUT = resolve(
  process.env.JSON_STUDIO_E2E_BASELINE_OUTPUT ||
    'test-results/large-json-performance-baseline.json',
);

const LIMITS = {
  pasteFormatMs: Number(process.env.JSON_STUDIO_E2E_PASTE_MS || 5_000),
  pasteSettledMs: Number(process.env.JSON_STUDIO_E2E_PASTE_SETTLED_MS || 5_000),
  pasteMaxEventLoopGapMs: Number(process.env.JSON_STUDIO_E2E_PASTE_GAP_MS || 350),
  tabSwitchMedianMs: Number(process.env.JSON_STUDIO_E2E_TAB_MEDIAN_MS || 250),
  tabSwitchWorstMs: Number(process.env.JSON_STUDIO_E2E_TAB_WORST_MS || 500),
  tabSettledMedianMs: Number(process.env.JSON_STUDIO_E2E_TAB_SETTLED_MEDIAN_MS || 650),
  tabSettledWorstMs: Number(process.env.JSON_STUDIO_E2E_TAB_SETTLED_WORST_MS || 800),
  tabSwitchMaxEventLoopGapMs: Number(process.env.JSON_STUDIO_E2E_TAB_GAP_MS || 250),
  coldTabSwitchMs: Number(process.env.JSON_STUDIO_E2E_COLD_TAB_SWITCH_MS || 500),
  coldTabSettledMs: Number(process.env.JSON_STUDIO_E2E_COLD_TAB_SETTLED_MS || 1_500),
  treeScrollMedianMs: Number(process.env.JSON_STUDIO_E2E_TREE_SCROLL_MEDIAN_MS || 100),
  treeScrollWorstMs: Number(process.env.JSON_STUDIO_E2E_TREE_SCROLL_WORST_MS || 200),
  treeScrollMaxEventLoopGapMs: Number(process.env.JSON_STUDIO_E2E_TREE_SCROLL_GAP_MS || 150),
};

const TAB_STATE_KEY = 'jsonstudio_tabs_state';
const SETTINGS_KEY = 'app-settings';
const baselineResults = [];

function createLargeJson(recordCount = 3_000) {
  return JSON.stringify(Array.from({ length: recordCount }, (_, index) => ({
    id: index,
    name: `record-${index}`,
    enabled: index % 2 === 0,
    payload: `${String(index).padStart(6, '0')}-${'x'.repeat(250)}`,
  })));
}

function createLargeTreeJson(recordCount = 100_000) {
  return JSON.stringify(Array.from({ length: recordCount }, (_, index) => ({
    id: index,
    value: index % 100,
  })));
}

function emptyStats() {
  return {
    valid: false,
    key_count: 0,
    depth: 0,
    byte_size: 0,
    format_type: '',
    error_info: null,
  };
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function median(values) {
  return percentile(values, 0.5);
}

async function installBrowserHarness(page) {
  await page.addInitScript(() => {
    let callbackId = 0;
    const callbacks = new Map();

    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main' },
      },
      plugins: {
        path: { sep: '/', delimiter: ':' },
      },
      transformCallback(callback) {
        const id = ++callbackId;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      runCallback(id, payload) {
        callbacks.get(id)?.(payload);
      },
      convertFileSrc(path) {
        return path;
      },
      async invoke(command) {
        if (command === 'get_pending_files') return [];
        if (command === 'plugin:event|listen') return ++callbackId;
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener() {},
    };

    const samples = [];
    let previous = performance.now();
    const observer = typeof PerformanceObserver === 'function'
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            samples.push(entry.duration);
          }
        })
      : null;
    observer?.observe({ entryTypes: ['longtask'] });

    window.__jsonStudioPerf = {
      gaps: samples,
      reset() {
        samples.length = 0;
        previous = performance.now();
      },
    };

    setInterval(() => {
      const now = performance.now();
      const gap = Math.max(0, now - previous - 16);
      if (gap > 20) samples.push(gap);
      previous = now;
    }, 16);
  });
}

async function loadCommonState(page, tabs, activeTabId, options = {}) {
  await page.goto('/');
  await page.evaluate(({ tabs, activeTabId, tabStateKey, settingsKey, showTreeView }) => {
    localStorage.setItem(tabStateKey, JSON.stringify({ tabs, activeTabId }));
    localStorage.setItem(settingsKey, JSON.stringify({
      language: 'en',
      showTreeView,
      showFolderView: false,
      autoSave: false,
      isDarkMode: false,
    }));
  }, {
    tabs,
    activeTabId,
    tabStateKey: TAB_STATE_KEY,
    settingsKey: SETTINGS_KEY,
    showTreeView: options.showTreeView ?? true,
  });
  await page.reload();
}

async function readMaxGap(page) {
  return await page.evaluate(() => Math.max(0, ...window.__jsonStudioPerf.gaps));
}

async function resetGaps(page) {
  await page.evaluate(() => window.__jsonStudioPerf.reset());
}

async function waitForActiveModel(page, modelKey) {
  await expect(page.getByTestId('json-editor')).toHaveAttribute('data-active-model-key', modelKey);
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function readTreeBuildVersion(page) {
  return await page.evaluate(() => Number(
    document.querySelector('[data-testid="tree-ready"]')
      ?.getAttribute('data-tree-build-version') || 0,
  ));
}

async function waitForTreeBuildAfter(page, previousVersion) {
  await expect.poll(
    () => readTreeBuildVersion(page),
    { message: 'Tree View should finish rebuilding for the active tab' },
  ).toBeGreaterThan(previousVersion);
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

test.describe('large JSON UI performance', () => {
  test.afterAll(async () => {
    await mkdir(dirname(BASELINE_OUTPUT), { recursive: true });
    await writeFile(BASELINE_OUTPUT, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      commit: process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || null,
      rounds: PERFORMANCE_ROUNDS,
      limits: LIMITS,
      scenarios: baselineResults,
    }, null, 2)}\n`);
    console.log(`Performance baseline: ${BASELINE_OUTPUT}`);
  });

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await installBrowserHarness(page);
  });

  test('formats a 1 MiB paste without freezing the UI', async ({ page }) => {
    test.setTimeout(45_000 * PERFORMANCE_ROUNDS);
    const largeJson = createLargeJson();
    const formattedLineCount = 3_000 * 6 + 3;
    const tabs = [{
      id: 'paste-target',
      filePath: null,
      fileName: 'Paste Target',
      content: '',
      isModified: false,
      stats: emptyStats(),
      isPinned: false,
    }];
    const formatDurations = [];
    const settledDurations = [];
    const maxGaps = [];

    for (let round = 0; round < PERFORMANCE_ROUNDS; round += 1) {
      await loadCommonState(page, tabs, 'paste-target');
      const editorSurface = page.locator('[data-testid="json-editor"] .view-lines');
      await expect(editorSurface).toBeVisible();
      await editorSurface.click();
      const previousTreeVersion = await readTreeBuildVersion(page);
      await resetGaps(page);

      const startedAt = performance.now();
      await page.evaluate((value) => {
        const clipboard = new DataTransfer();
        clipboard.setData('text/plain', value);
        document.activeElement?.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard,
        }));
      }, largeJson);
      await expect(page.getByTestId('editor-line-count')).toContainText(
        `${formattedLineCount} lines`,
        { timeout: LIMITS.pasteFormatMs },
      );
      formatDurations.push(performance.now() - startedAt);
      await waitForTreeBuildAfter(page, previousTreeVersion);
      settledDurations.push(performance.now() - startedAt);
      maxGaps.push(await readMaxGap(page));

      await expect(page.getByTestId('tree-ready')).toBeAttached();
      const treeViewport = page.getByTestId('tree-viewport');
      expect(await treeViewport.locator('[data-tree-path]').count()).toBeLessThan(100);
      await treeViewport.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event('scroll'));
      });
      await expect(treeViewport.locator('[data-tree-path="/2999/payload"]')).toBeVisible();
      expect(await treeViewport.locator('[data-tree-path]').count()).toBeLessThan(100);
    }

    const formatMedianMs = median(formatDurations);
    const settledMedianMs = median(settledDurations);
    const maxGapMs = Math.max(...maxGaps);
    const passed = formatMedianMs <= LIMITS.pasteFormatMs &&
      settledMedianMs <= LIMITS.pasteSettledMs &&
      maxGapMs <= LIMITS.pasteMaxEventLoopGapMs;

    console.table([{
      scenario: 'Large JSON Paste',
      rounds: PERFORMANCE_ROUNDS,
      input: `${(Buffer.byteLength(largeJson) / 1024 / 1024).toFixed(2)} MiB`,
      formatMedian: `${formatMedianMs.toFixed(1)} ms`,
      settledMedian: `${settledMedianMs.toFixed(1)} ms`,
      maxUiGap: `${maxGapMs.toFixed(1)} ms`,
      result: passed ? 'PASS' : 'FAIL',
    }]);

    baselineResults.push({
      scenario: 'Large JSON Paste',
      samples: {
        formatMs: formatDurations,
        settledMs: settledDurations,
        maxUiGapMs: maxGaps,
      },
      median: {
        formatMs: formatMedianMs,
        settledMs: settledMedianMs,
      },
      worst: { maxUiGapMs: maxGapMs },
      passed,
    });

    expect(formatMedianMs).toBeLessThanOrEqual(LIMITS.pasteFormatMs);
    expect(settledMedianMs).toBeLessThanOrEqual(LIMITS.pasteSettledMs);
    expect(maxGapMs).toBeLessThanOrEqual(LIMITS.pasteMaxEventLoopGapMs);
  });

  test('switches repeatedly between cached large JSON tabs without freezing', async ({ page }) => {
    test.setTimeout(45_000 * PERFORMANCE_ROUNDS);
    const largeA = JSON.stringify({ marker: 'LARGE_A', records: JSON.parse(createLargeJson()) }, null, 2);
    const largeB = JSON.stringify({ marker: 'LARGE_B', records: JSON.parse(createLargeJson()) }, null, 2);
    const tabs = [
      {
        id: 'large-a',
        filePath: null,
        fileName: 'Large A',
        content: largeA,
        isModified: false,
        stats: emptyStats(),
        isPinned: false,
      },
      {
        id: 'large-b',
        filePath: null,
        fileName: 'Large B',
        content: largeB,
        isModified: false,
        stats: emptyStats(),
        isPinned: false,
      },
      {
        id: 'invalid-json',
        filePath: null,
        fileName: 'Invalid JSON',
        content: '{"invalid":',
        isModified: false,
        stats: emptyStats(),
        isPinned: false,
      },
    ];
    const coldSwitchDurations = [];
    const coldSettledDurations = [];
    const coldMaxGaps = [];
    const switchRoundMedians = [];
    const settledRoundMedians = [];
    const switchDurations = [];
    const settledDurations = [];
    const warmMaxGaps = [];

    for (let round = 0; round < PERFORMANCE_ROUNDS; round += 1) {
      await loadCommonState(page, tabs, 'large-a', {
        showTreeView: process.env.JSON_STUDIO_E2E_TREE !== 'false',
      });
      await waitForActiveModel(page, 'large-a');
      await expect(page.getByTestId('tree-ready')).toBeAttached();
      let treeVersion = await readTreeBuildVersion(page);
      await resetGaps(page);
      const coldStartedAt = performance.now();
      await page.getByTestId('tab-large-b').click();
      await waitForActiveModel(page, 'large-b');
      coldSwitchDurations.push(performance.now() - coldStartedAt);
      await waitForTreeBuildAfter(page, treeVersion);
      coldSettledDurations.push(performance.now() - coldStartedAt);
      coldMaxGaps.push(await readMaxGap(page));

      treeVersion = await readTreeBuildVersion(page);
      await page.getByTestId('tab-large-a').click();
      await waitForActiveModel(page, 'large-a');
      await waitForTreeBuildAfter(page, treeVersion);

      await resetGaps(page);
      const roundSwitchDurations = [];
      const roundSettledDurations = [];
      for (let index = 0; index < 6; index += 1) {
        const targetId = index % 2 === 0 ? 'large-b' : 'large-a';
        treeVersion = await readTreeBuildVersion(page);
        const startedAt = performance.now();
        await page.getByTestId(`tab-${targetId}`).click();
        await waitForActiveModel(page, targetId);
        const switchMs = performance.now() - startedAt;
        roundSwitchDurations.push(switchMs);
        switchDurations.push(switchMs);
        await waitForTreeBuildAfter(page, treeVersion);
        const settledMs = performance.now() - startedAt;
        roundSettledDurations.push(settledMs);
        settledDurations.push(settledMs);
      }
      switchRoundMedians.push(median(roundSwitchDurations));
      settledRoundMedians.push(median(roundSettledDurations));
      warmMaxGaps.push(await readMaxGap(page));

      await page.getByTestId('tab-invalid-json').click();
      await waitForActiveModel(page, 'invalid-json');
      await expect(page.getByTestId('tree-error')).toBeAttached();

      await page.getByTestId('tab-large-a').click();
      await waitForActiveModel(page, 'large-a');
      await expect(page.getByTestId('tree-ready')).toBeAttached();
      await expect(page.getByTestId('tree-error')).not.toBeAttached();
    }

    const coldSwitchMedianMs = median(coldSwitchDurations);
    const coldSettledMedianMs = median(coldSettledDurations);
    const coldMaxGapMs = Math.max(...coldMaxGaps);
    const coldPassed = coldSwitchMedianMs <= LIMITS.coldTabSwitchMs &&
      coldSettledMedianMs <= LIMITS.coldTabSettledMs &&
      coldMaxGapMs <= LIMITS.tabSwitchMaxEventLoopGapMs;
    const switchMedianMs = median(switchRoundMedians);
    const switchWorstMs = Math.max(...switchDurations);
    const settledMedianMs = median(settledRoundMedians);
    const settledWorstMs = Math.max(...settledDurations);
    const maxGapMs = Math.max(...warmMaxGaps);
    const warmPassed = switchMedianMs <= LIMITS.tabSwitchMedianMs &&
      switchWorstMs <= LIMITS.tabSwitchWorstMs &&
      settledMedianMs <= LIMITS.tabSettledMedianMs &&
      settledWorstMs <= LIMITS.tabSettledWorstMs &&
      maxGapMs <= LIMITS.tabSwitchMaxEventLoopGapMs;

    console.table([{
      scenario: 'Cold Large Tab Switch',
      rounds: PERFORMANCE_ROUNDS,
      switchMedian: `${coldSwitchMedianMs.toFixed(1)} ms`,
      settledMedian: `${coldSettledMedianMs.toFixed(1)} ms`,
      maxUiGap: `${coldMaxGapMs.toFixed(1)} ms`,
      result: coldPassed ? 'PASS' : 'FAIL',
    }]);

    console.table([{
      scenario: 'Large Tab Switch',
      rounds: PERFORMANCE_ROUNDS,
      samples: switchDurations.length,
      switchMedian: `${switchMedianMs.toFixed(1)} ms`,
      switchWorst: `${switchWorstMs.toFixed(1)} ms`,
      settledMedian: `${settledMedianMs.toFixed(1)} ms`,
      settledWorst: `${settledWorstMs.toFixed(1)} ms`,
      maxUiGap: `${maxGapMs.toFixed(1)} ms`,
      result: warmPassed ? 'PASS' : 'FAIL',
    }]);

    baselineResults.push(
      {
        scenario: 'Cold Large Tab Switch',
        samples: {
          switchMs: coldSwitchDurations,
          settledMs: coldSettledDurations,
          maxUiGapMs: coldMaxGaps,
        },
        median: {
          switchMs: coldSwitchMedianMs,
          settledMs: coldSettledMedianMs,
        },
        worst: { maxUiGapMs: coldMaxGapMs },
        passed: coldPassed,
      },
      {
        scenario: 'Large Tab Switch',
        samples: {
          roundSwitchMedianMs: switchRoundMedians,
          roundSettledMedianMs: settledRoundMedians,
          switchMs: switchDurations,
          settledMs: settledDurations,
          maxUiGapMs: warmMaxGaps,
        },
        median: {
          switchMs: switchMedianMs,
          settledMs: settledMedianMs,
        },
        worst: {
          switchMs: switchWorstMs,
          settledMs: settledWorstMs,
          maxUiGapMs: maxGapMs,
        },
        passed: warmPassed,
      },
    );

    expect(coldSwitchMedianMs).toBeLessThanOrEqual(LIMITS.coldTabSwitchMs);
    expect(coldSettledMedianMs).toBeLessThanOrEqual(LIMITS.coldTabSettledMs);
    expect(coldMaxGapMs).toBeLessThanOrEqual(LIMITS.tabSwitchMaxEventLoopGapMs);
    expect(switchMedianMs).toBeLessThanOrEqual(LIMITS.tabSwitchMedianMs);
    expect(switchWorstMs).toBeLessThanOrEqual(LIMITS.tabSwitchWorstMs);
    expect(settledMedianMs).toBeLessThanOrEqual(LIMITS.tabSettledMedianMs);
    expect(settledWorstMs).toBeLessThanOrEqual(LIMITS.tabSettledWorstMs);
    expect(maxGapMs).toBeLessThanOrEqual(LIMITS.tabSwitchMaxEventLoopGapMs);
  });

  test('scrolls a 100K-record virtual tree without scanning every row', async ({ page }) => {
    test.setTimeout(90_000 * PERFORMANCE_ROUNDS);
    const largeJson = createLargeTreeJson();
    const tabs = [{
      id: 'tree-scroll',
      filePath: null,
      fileName: 'Tree Scroll',
      content: largeJson,
      isModified: false,
      stats: emptyStats(),
      isPinned: false,
    }];
    const roundMedians = [];
    const scrollDurations = [];
    const maxGaps = [];
    let renderedRowCount = 0;

    for (let round = 0; round < PERFORMANCE_ROUNDS; round += 1) {
      await loadCommonState(page, tabs, 'tree-scroll');
      await expect(page.getByTestId('tree-ready')).toBeAttached({ timeout: 30_000 });
      const treeViewport = page.getByTestId('tree-viewport');
      const renderedRows = treeViewport.locator('[data-tree-path]');
      expect(await renderedRows.count()).toBeLessThan(100);
      await resetGaps(page);

      const roundDurations = [];
      for (let index = 0; index < 24; index += 1) {
        const ratio = ((index * 7) % 24) / 23;
        const startedAt = performance.now();
        await treeViewport.evaluate((element, nextRatio) => {
          element.scrollTop = (element.scrollHeight - element.clientHeight) * nextRatio;
          element.dispatchEvent(new Event('scroll'));
        }, ratio);
        await page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        const duration = performance.now() - startedAt;
        roundDurations.push(duration);
        scrollDurations.push(duration);
        expect(await renderedRows.count()).toBeLessThan(100);
      }
      roundMedians.push(median(roundDurations));
      maxGaps.push(await readMaxGap(page));
      renderedRowCount = await renderedRows.count();
    }

    const medianMs = median(roundMedians);
    const worstMs = Math.max(...scrollDurations);
    const maxGapMs = Math.max(...maxGaps);
    const passed = medianMs <= LIMITS.treeScrollMedianMs &&
      worstMs <= LIMITS.treeScrollWorstMs &&
      maxGapMs <= LIMITS.treeScrollMaxEventLoopGapMs;

    console.table([{
      scenario: '100K Tree Scroll',
      rounds: PERFORMANCE_ROUNDS,
      samples: scrollDurations.length,
      median: `${medianMs.toFixed(1)} ms`,
      worst: `${worstMs.toFixed(1)} ms`,
      maxUiGap: `${maxGapMs.toFixed(1)} ms`,
      renderedRows: renderedRowCount,
      result: passed ? 'PASS' : 'FAIL',
    }]);

    baselineResults.push({
      scenario: '100K Tree Scroll',
      samples: {
        roundMedianMs: roundMedians,
        scrollMs: scrollDurations,
        maxUiGapMs: maxGaps,
      },
      median: { scrollMs: medianMs },
      worst: {
        scrollMs: worstMs,
        maxUiGapMs: maxGapMs,
      },
      renderedRows: renderedRowCount,
      passed,
    });

    expect(medianMs).toBeLessThanOrEqual(LIMITS.treeScrollMedianMs);
    expect(worstMs).toBeLessThanOrEqual(LIMITS.treeScrollWorstMs);
    expect(maxGapMs).toBeLessThanOrEqual(LIMITS.treeScrollMaxEventLoopGapMs);
  });
});
