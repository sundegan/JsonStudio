import { expect, test } from '@playwright/test';

const LIMITS = {
  pasteFormatMs: Number(process.env.JSON_STUDIO_E2E_PASTE_MS || 5_000),
  pasteSettledMs: Number(process.env.JSON_STUDIO_E2E_PASTE_SETTLED_MS || 5_000),
  pasteMaxEventLoopGapMs: Number(process.env.JSON_STUDIO_E2E_PASTE_GAP_MS || 350),
  tabSwitchMedianMs: Number(process.env.JSON_STUDIO_E2E_TAB_MEDIAN_MS || 250),
  tabSwitchWorstMs: Number(process.env.JSON_STUDIO_E2E_TAB_WORST_MS || 500),
  tabSettledMedianMs: Number(process.env.JSON_STUDIO_E2E_TAB_SETTLED_MEDIAN_MS || 650),
  tabSettledWorstMs: Number(process.env.JSON_STUDIO_E2E_TAB_SETTLED_WORST_MS || 800),
  tabSwitchMaxEventLoopGapMs: Number(process.env.JSON_STUDIO_E2E_TAB_GAP_MS || 250),
  treeScrollMedianMs: Number(process.env.JSON_STUDIO_E2E_TREE_SCROLL_MEDIAN_MS || 100),
  treeScrollWorstMs: Number(process.env.JSON_STUDIO_E2E_TREE_SCROLL_WORST_MS || 200),
  treeScrollMaxEventLoopGapMs: Number(process.env.JSON_STUDIO_E2E_TREE_SCROLL_GAP_MS || 150),
};

const TAB_STATE_KEY = 'jsonstudio_tabs_state';
const SETTINGS_KEY = 'app-settings';

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
      async invoke(command, args) {
        if (command === 'get_pending_files') return [];
        if (command === 'plugin:event|listen') return ++callbackId;
        if (command === 'json_stats') {
          return {
            valid: true,
            key_count: 0,
            depth: 0,
            byte_size: new TextEncoder().encode(args?.content || '').length,
            format_type: 'JSON',
            error_info: null,
          };
        }
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

async function setCommonState(page, tabs, activeTabId, options = {}) {
  await page.addInitScript(({ tabs, activeTabId, tabStateKey, settingsKey, showTreeView }) => {
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
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await installBrowserHarness(page);
  });

  test('formats a 1 MiB paste without freezing the UI', async ({ page }) => {
    const largeJson = createLargeJson();
    const formattedLineCount = 3_000 * 6 + 3;
    await setCommonState(page, [{
      id: 'paste-target',
      filePath: null,
      fileName: 'Paste Target',
      content: '',
      isModified: false,
      stats: emptyStats(),
      isPinned: false,
    }], 'paste-target');

    await page.goto('/');
    const editorSurface = page.locator('[data-testid="json-editor"] .view-lines');
    await expect(editorSurface).toBeVisible();
    await editorSurface.click();
    const previousTreeVersion = await readTreeBuildVersion(page);
    await resetGaps(page);

    const startedAt = Date.now();
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
    const formatMs = Date.now() - startedAt;
    await waitForTreeBuildAfter(page, previousTreeVersion);
    const settledMs = Date.now() - startedAt;
    const maxGapMs = await readMaxGap(page);

    console.table([{
      scenario: 'Large JSON Paste',
      input: `${(Buffer.byteLength(largeJson) / 1024 / 1024).toFixed(2)} MiB`,
      lines: formattedLineCount,
      format: `${formatMs} ms`,
      settled: `${settledMs} ms`,
      maxUiGap: `${maxGapMs.toFixed(1)} ms`,
      result: formatMs <= LIMITS.pasteFormatMs &&
        settledMs <= LIMITS.pasteSettledMs &&
        maxGapMs <= LIMITS.pasteMaxEventLoopGapMs
        ? 'PASS'
        : 'FAIL',
    }]);

    expect(formatMs).toBeLessThanOrEqual(LIMITS.pasteFormatMs);
    expect(settledMs).toBeLessThanOrEqual(LIMITS.pasteSettledMs);
    expect(maxGapMs).toBeLessThanOrEqual(LIMITS.pasteMaxEventLoopGapMs);
    await expect(page.getByTestId('tree-ready')).toBeAttached();

    const treeViewport = page.getByTestId('tree-viewport');
    const initialRenderedRows = await treeViewport.locator('[data-tree-path]').count();
    expect(initialRenderedRows).toBeLessThan(100);
    await treeViewport.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(treeViewport.locator('[data-tree-path="/2999/payload"]')).toBeVisible();
    expect(await treeViewport.locator('[data-tree-path]').count()).toBeLessThan(100);
  });

  test('switches repeatedly between cached large JSON tabs without freezing', async ({ page }) => {
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
    ];
    await setCommonState(page, tabs, 'large-a', {
      showTreeView: process.env.JSON_STUDIO_E2E_TREE !== 'false',
    });
    await page.goto('/');
    await waitForActiveModel(page, 'large-a');
    await expect(page.getByTestId('tree-ready')).toBeAttached();
    let treeVersion = await readTreeBuildVersion(page);
    await page.getByTestId('tab-large-b').click();
    await waitForActiveModel(page, 'large-b');
    await waitForTreeBuildAfter(page, treeVersion);
    treeVersion = await readTreeBuildVersion(page);
    await page.getByTestId('tab-large-a').click();
    await waitForActiveModel(page, 'large-a');
    await waitForTreeBuildAfter(page, treeVersion);

    await resetGaps(page);
    const switchDurations = [];
    const settledDurations = [];
    for (let index = 0; index < 6; index += 1) {
      const targetId = index % 2 === 0 ? 'large-b' : 'large-a';
      treeVersion = await readTreeBuildVersion(page);
      const startedAt = performance.now();
      await page.getByTestId(`tab-${targetId}`).click();
      await waitForActiveModel(page, targetId);
      switchDurations.push(performance.now() - startedAt);
      await waitForTreeBuildAfter(page, treeVersion);
      settledDurations.push(performance.now() - startedAt);
    }

    const switchMedianMs = percentile(switchDurations, 0.5);
    const switchWorstMs = Math.max(...switchDurations);
    const settledMedianMs = percentile(settledDurations, 0.5);
    const settledWorstMs = Math.max(...settledDurations);
    const maxGapMs = await readMaxGap(page);

    console.table([{
      scenario: 'Large Tab Switch',
      iterations: switchDurations.length,
      switchMedian: `${switchMedianMs.toFixed(1)} ms`,
      switchWorst: `${switchWorstMs.toFixed(1)} ms`,
      settledMedian: `${settledMedianMs.toFixed(1)} ms`,
      settledWorst: `${settledWorstMs.toFixed(1)} ms`,
      maxUiGap: `${maxGapMs.toFixed(1)} ms`,
      result: switchMedianMs <= LIMITS.tabSwitchMedianMs &&
        switchWorstMs <= LIMITS.tabSwitchWorstMs &&
        settledMedianMs <= LIMITS.tabSettledMedianMs &&
        settledWorstMs <= LIMITS.tabSettledWorstMs &&
        maxGapMs <= LIMITS.tabSwitchMaxEventLoopGapMs
        ? 'PASS'
        : 'FAIL',
    }]);

    expect(switchMedianMs).toBeLessThanOrEqual(LIMITS.tabSwitchMedianMs);
    expect(switchWorstMs).toBeLessThanOrEqual(LIMITS.tabSwitchWorstMs);
    expect(settledMedianMs).toBeLessThanOrEqual(LIMITS.tabSettledMedianMs);
    expect(settledWorstMs).toBeLessThanOrEqual(LIMITS.tabSettledWorstMs);
    expect(maxGapMs).toBeLessThanOrEqual(LIMITS.tabSwitchMaxEventLoopGapMs);
  });

  test('scrolls a 100K-record virtual tree without scanning every row', async ({ page }) => {
    test.setTimeout(90_000);
    const largeJson = createLargeTreeJson();
    await setCommonState(page, [{
      id: 'tree-scroll',
      filePath: null,
      fileName: 'Tree Scroll',
      content: largeJson,
      isModified: false,
      stats: emptyStats(),
      isPinned: false,
    }], 'tree-scroll');

    await page.goto('/');
    await expect(page.getByTestId('tree-ready')).toBeAttached({ timeout: 30_000 });
    const treeViewport = page.getByTestId('tree-viewport');
    const renderedRows = treeViewport.locator('[data-tree-path]');
    expect(await renderedRows.count()).toBeLessThan(100);
    await resetGaps(page);

    const scrollDurations = [];
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
      scrollDurations.push(performance.now() - startedAt);
      expect(await renderedRows.count()).toBeLessThan(100);
    }

    const medianMs = percentile(scrollDurations, 0.5);
    const worstMs = Math.max(...scrollDurations);
    const maxGapMs = await readMaxGap(page);

    console.table([{
      scenario: '100K Tree Scroll',
      iterations: scrollDurations.length,
      median: `${medianMs.toFixed(1)} ms`,
      worst: `${worstMs.toFixed(1)} ms`,
      maxUiGap: `${maxGapMs.toFixed(1)} ms`,
      renderedRows: await renderedRows.count(),
      result: medianMs <= LIMITS.treeScrollMedianMs &&
        worstMs <= LIMITS.treeScrollWorstMs &&
        maxGapMs <= LIMITS.treeScrollMaxEventLoopGapMs
        ? 'PASS'
        : 'FAIL',
    }]);

    expect(medianMs).toBeLessThanOrEqual(LIMITS.treeScrollMedianMs);
    expect(worstMs).toBeLessThanOrEqual(LIMITS.treeScrollWorstMs);
    expect(maxGapMs).toBeLessThanOrEqual(LIMITS.treeScrollMaxEventLoopGapMs);
  });
});
