import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  buildJsonSourcePointers,
  parseJsonSourceDocument,
  parseJsonSourceModel,
} from '../src/lib/services/jsonSourceModel.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MIB = 1024 * 1024;
const workerScenario = readArgument('--worker');
const memoryWorkerScenario = readArgument('--memory-worker');
const openWorkerScenario = readArgument('--open-worker');
const jsonOutput = process.argv.includes('--json');
const quick = process.argv.includes('--quick');

const scenarios = [
  {
    id: 'records-50k',
    name: '50K Object Records',
    rounds: 5,
    dialect: 'AUTO',
    limits: { medianMs: 700, openDocumentMiB: 55 },
    createInput: () => createRecordArray(50_000),
  },
  {
    id: 'records-100k',
    name: '100K Object Records',
    rounds: 3,
    dialect: 'AUTO',
    limits: { medianMs: 1200, openDocumentMiB: 100 },
    createInput: () => createRecordArray(100_000),
  },
  {
    id: 'auto-trailing-comma-100k',
    name: '100K Records + Trailing Comma',
    rounds: 3,
    dialect: 'AUTO',
    relativeTo: 'records-100k',
    maxParseRatio: 1.30,
    limits: { medianMs: 1300, openDocumentMiB: 100 },
    createInput: () => addDocumentTrailingComma(createRecordArray(100_000)),
  },
  {
    id: 'flat-array-500k',
    name: '500K-Item Flat Array',
    rounds: 3,
    dialect: 'AUTO',
    limits: { medianMs: 1000, openDocumentMiB: 80 },
    createInput: () => JSON.stringify(Array.from({ length: 500_000 }, (_, index) => index)),
  },
  {
    id: 'json5-records-100k',
    name: '100K JSON5 Records',
    rounds: 3,
    dialect: 'JSON5',
    limits: { medianMs: 1400, openDocumentMiB: 100 },
    createInput: () => createJson5RecordArray(100_000),
  },
  {
    id: 'depth-3000',
    name: '3K-Level Nested Array',
    rounds: 3,
    dialect: 'AUTO',
    limits: { medianMs: 150, openDocumentMiB: 15 },
    createInput: () => `${'['.repeat(3000)}0${']'.repeat(3000)}`,
  },
];

if (workerScenario) {
  const scenario = scenarios.find(({ id }) => id === workerScenario);
  if (!scenario) throw new Error(`Unknown benchmark scenario: ${workerScenario}`);
  process.stdout.write(JSON.stringify(runWorker(scenario)));
} else if (openWorkerScenario) {
  const scenario = scenarios.find(({ id }) => id === openWorkerScenario);
  if (!scenario) throw new Error(`Unknown benchmark scenario: ${openWorkerScenario}`);
  process.stdout.write(JSON.stringify(runDocumentMemoryWorker(scenario, false)));
} else if (memoryWorkerScenario) {
  const scenario = scenarios.find(({ id }) => id === memoryWorkerScenario);
  if (!scenario) throw new Error(`Unknown benchmark scenario: ${memoryWorkerScenario}`);
  process.stdout.write(JSON.stringify(runDocumentMemoryWorker(scenario, true)));
} else {
  runCoordinator();
}

function runCoordinator() {
  const selectedScenarios = quick
    ? scenarios.filter(({ id }) => id === 'records-50k' || id === 'depth-3000')
    : scenarios;
  const results = selectedScenarios.map(runScenarioProcess);
  const passed = results.every((result) => result.passed);

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({
      passed,
      node: process.version,
      arch: process.arch,
      platform: process.platform,
      results,
    }, null, 2)}\n`);
  } else {
    printReport(results, passed);
  }

  if (!passed) process.exitCode = 1;
}

function runScenarioProcess(scenario) {
  const child = spawnSync(
    process.execPath,
    ['--expose-gc', SCRIPT_PATH, '--worker', scenario.id],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * MIB,
    },
  );

  if (child.status !== 0) {
    throw new Error(
      `Benchmark worker failed for ${scenario.id}:\n${child.stderr || child.stdout}`,
    );
  }
  const result = JSON.parse(child.stdout);
  const openDocumentChild = spawnSync(
    process.execPath,
    ['--expose-gc', SCRIPT_PATH, '--open-worker', scenario.id],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * MIB,
    },
  );
  if (openDocumentChild.status !== 0) {
    throw new Error(
      `Open-document benchmark worker failed for ${scenario.id}:\n` +
      `${openDocumentChild.stderr || openDocumentChild.stdout}`,
    );
  }
  const memoryChild = spawnSync(
    process.execPath,
    ['--expose-gc', SCRIPT_PATH, '--memory-worker', scenario.id],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * MIB,
    },
  );
  if (memoryChild.status !== 0) {
    throw new Error(
      `Memory benchmark worker failed for ${scenario.id}:\n` +
      `${memoryChild.stderr || memoryChild.stdout}`,
    );
  }
  const merged = {
    ...result,
    ...JSON.parse(memoryChild.stdout),
    ...JSON.parse(openDocumentChild.stdout),
  };
  merged.checks.openDocumentMiB =
    merged.openDocumentRetainedMiB <= merged.limits.openDocumentMiB;
  merged.passed = Object.values(merged.checks).every(Boolean);
  return merged;
}

function runWorker(scenario) {
  if (typeof global.gc !== 'function') {
    throw new Error('Benchmark workers must run with --expose-gc');
  }

  const input = scenario.createInput();
  const baselineScenario = scenario.relativeTo
    ? scenarios.find(({ id }) => id === scenario.relativeTo)
    : null;
  const baselineInput = baselineScenario?.createInput();
  const inputBytes = Buffer.byteLength(input);
  const limits = applyLimitScale(scenario.limits);

  let warmup = parseSourceDocument(input, scenario.dialect);
  validateResult(warmup, scenario);
  warmup = null;
  if (baselineScenario && baselineInput) {
    let baselineWarmup = parseSourceDocument(baselineInput, baselineScenario.dialect);
    validateResult(baselineWarmup, baselineScenario);
    baselineWarmup = null;
  }
  forceGc();

  const samples = [];
  const baselineParseTimes = [];
  for (let index = 0; index < scenario.rounds; index += 1) {
    if (baselineScenario && baselineInput) {
      forceGc();
      const baselineStart = performance.now();
      let baselineModel = parseJsonSourceModel(baselineInput, {
        dialect: baselineScenario.dialect ?? 'JSON',
      });
      baselineParseTimes.push(performance.now() - baselineStart);
      baselineModel = null;
    }
    forceGc();
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();
    const sourceModel = parseJsonSourceModel(input, {
      dialect: scenario.dialect ?? 'JSON',
    });
    const parsedAt = performance.now();
    const pointers = buildJsonSourcePointers(sourceModel);
    const completedAt = performance.now();
    let parsed = { sourceModel, pointers };
    forceGc();
    const heapAfter = process.memoryUsage().heapUsed;

    validateResult(parsed, scenario);
    samples.push({
      parseMs: parsedAt - start,
      pointerMs: completedAt - parsedAt,
      elapsedMs: completedAt - start,
      retainedBytes: Math.max(0, heapAfter - heapBefore),
      pointerCount: Object.keys(parsed.pointers).length,
    });
    parsed = null;
  }

  const elapsed = samples.map(({ elapsedMs }) => elapsedMs).sort((a, b) => a - b);
  const parseTimes = samples.map(({ parseMs }) => parseMs).sort((a, b) => a - b);
  const pointerTimes = samples.map(({ pointerMs }) => pointerMs).sort((a, b) => a - b);
  const retained = samples
    .map(({ retainedBytes }) => retainedBytes)
    .sort((a, b) => a - b);
  const medianMs = percentile(elapsed, 0.5);
  const p95Ms = percentile(elapsed, 0.95);
  const parseMedianMs = percentile(parseTimes, 0.5);
  const pointerMedianMs = percentile(pointerTimes, 0.5);
  const retainedMiB = percentile(retained, 0.5) / MIB;
  const throughputMiBPerSecond = (inputBytes / MIB) / (medianMs / 1000);
  const baselineParseMedianMs = baselineParseTimes.length > 0
    ? percentile(baselineParseTimes.sort((a, b) => a - b), 0.5)
    : undefined;
  const parseRatio = baselineParseMedianMs === undefined
    ? undefined
    : parseMedianMs / baselineParseMedianMs;
  const checks = {
    medianMs: medianMs <= limits.medianMs,
  };
  if (parseRatio !== undefined) {
    checks.parseRatio = parseRatio <= scenario.maxParseRatio;
  }

  return {
    id: scenario.id,
    name: scenario.name,
    dialect: scenario.dialect ?? 'JSON',
    inputBytes,
    pointerCount: samples[0].pointerCount,
    rounds: scenario.rounds,
    parseMedianMs,
    pointerMedianMs,
    medianMs,
    p95Ms,
    throughputMiBPerSecond,
    retainedMiB,
    limits,
    checks,
    passed: Object.values(checks).every(Boolean),
    relativeTo: scenario.relativeTo,
    maxParseRatio: scenario.maxParseRatio,
    baselineParseMedianMs,
    parseRatio,
  };
}

function runDocumentMemoryWorker(scenario, retainSourceModel) {
  if (typeof global.gc !== 'function') {
    throw new Error('Benchmark workers must run with --expose-gc');
  }

  const input = scenario.createInput();
  let warmup = parseJsonSourceDocument(input, {
    dialect: scenario.dialect ?? 'JSON',
    retainSourceModel,
  });
  warmup = null;
  forceGc();

  const heapBefore = process.memoryUsage().heapUsed;
  const document = parseJsonSourceDocument(input, {
    dialect: scenario.dialect ?? 'JSON',
    retainSourceModel,
  });
  forceGc();
  if (!document.pointers['']) {
    throw new Error(`${scenario.id} produced incomplete open-document data`);
  }

  return {
    [retainSourceModel ? 'retainedMiB' : 'openDocumentRetainedMiB']: Math.max(
      0,
      process.memoryUsage().heapUsed - heapBefore,
    ) / MIB,
  };
}

function parseSourceDocument(input, dialect = 'JSON') {
  const sourceModel = parseJsonSourceModel(input, { dialect });
  return {
    sourceModel,
    pointers: buildJsonSourcePointers(sourceModel),
  };
}

function validateResult(parsed, scenario) {
  if (!parsed.sourceModel || !parsed.pointers['']) {
    throw new Error(`${scenario.id} produced an incomplete source document`);
  }
  if (scenario.id === 'depth-3000' && Object.keys(parsed.pointers).length !== 3001) {
    throw new Error('Deep nesting pointer count is incorrect');
  }
}

function applyLimitScale(limits) {
  const scale = parsePositiveNumber(process.env.SOURCE_MODEL_BENCH_LIMIT_SCALE, 1);
  return {
    medianMs: limits.medianMs * scale,
    openDocumentMiB: limits.openDocumentMiB * scale,
  };
}

function printReport(results, passed) {
  const rows = results.map((result) => ({
    scenario: result.name,
    input: formatBytes(result.inputBytes),
    median: formatGate(result.medianMs, result.limits.medianMs, 'ms', 0),
    memory: formatGate(
      result.openDocumentRetainedMiB,
      result.limits.openDocumentMiB,
      'MiB',
      1,
    ),
    result: result.passed ? 'PASS' : 'FAIL',
  }));

  console.log('Source Model Benchmark');
  console.log(
    `Node ${process.version} | ${process.platform}-${process.arch} | ` +
    `limits ${parsePositiveNumber(process.env.SOURCE_MODEL_BENCH_LIMIT_SCALE, 1)}x`,
  );
  console.log('');
  printTable(rows);

  const ratioResult = results.find((result) => result.parseRatio !== undefined);
  if (ratioResult) {
    console.log(
      `Trailing-comma parse ratio: ${ratioResult.parseRatio.toFixed(2)}x ` +
      `(limit ${ratioResult.maxParseRatio.toFixed(2)}x) ` +
      `${ratioResult.checks.parseRatio ? 'PASS' : 'FAIL'}`,
    );
  }

  const failures = results.flatMap((result) =>
    Object.entries(result.checks)
      .filter(([, checkPassed]) => !checkPassed)
      .map(([check]) => `${result.name}: ${check}`),
  );
  if (failures.length > 0) {
    console.log(`Failed checks: ${failures.join('; ')}`);
  }
  console.log(`Overall: ${passed ? 'PASS' : 'FAIL'}`);
}

function printTable(rows) {
  const columns = [
    ['scenario', 'Scenario'],
    ['input', 'Input'],
    ['median', 'Median / Limit'],
    ['memory', 'Heap / Limit'],
    ['result', 'Result'],
  ];
  const widths = columns.map(([key, label]) =>
    Math.max(label.length, ...rows.map((row) => String(row[key]).length)),
  );
  const line = widths.map((width) => '-'.repeat(width)).join('  ');

  console.log(columns.map(([, label], index) => pad(label, widths[index])).join('  '));
  console.log(line);
  for (const row of rows) {
    console.log(columns.map(([key], index) => pad(row[key], widths[index])).join('  '));
  }
  console.log('');
}

function createRecordArray(count) {
  return JSON.stringify(Array.from({ length: count }, (_, index) => ({
    id: index,
    name: `item-${index}`,
    enabled: (index & 1) === 0,
    value: index / 3,
  })));
}

function createJson5RecordArray(count) {
  const rows = Array.from(
    { length: count },
    (_, index) => `{id:${index},name:'item-${index}',enabled:${(index & 1) === 0},value:${index / 3}}`,
  );
  return `[${rows.join(',')},]`;
}

function addDocumentTrailingComma(json) {
  return `${json.slice(0, -1)},]`;
}

function forceGc() {
  global.gc();
  global.gc();
}

function percentile(values, ratio) {
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return values[index];
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function parsePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function formatBytes(bytes) {
  return bytes >= MIB ? `${(bytes / MIB).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatGate(actual, limit, unit, digits) {
  return `${actual.toFixed(digits)} / ${limit.toFixed(digits)} ${unit}`;
}

function pad(value, width) {
  const text = String(value);
  return text + ' '.repeat(Math.max(0, width - text.length));
}
