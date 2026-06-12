# Source Model Benchmark

Run the full performance and memory gate:

```sh
pnpm benchmark:source-model
```

Run a faster local smoke benchmark:

```sh
pnpm benchmark:source-model:quick
```

The default report is intentionally compact. It shows input size, total median
latency, long-lived open-document heap, the corresponding limits, and pass/fail
status.

Memory columns are measured in separate isolated workers:

- `Retained Heap`: `data`, pointers, and the complete source model
- `Open-Doc Heap`: the long-lived application state after releasing the source
  model for documents without duplicate keys

Documents with duplicate keys keep the source model because Tree and Grid views
need it to preserve distinct entries.

The default performance gate checks:

- total median latency
- long-lived open-document heap
- automatic JSON5 detection with only a document-level trailing comma stays
  within 1.30x of strict JSON parsing

The default limits are set close enough to catch meaningful regressions while
leaving headroom for normal machine load. `--json` retains detailed diagnostic
metrics such as parse time, pointer build time, throughput, pointer count, and
complete source-model heap. P95 remains diagnostic-only because the default
round count is too small for it to be a stable gate.

The trailing-comma ratio is measured against the equivalent standard JSON
inside the same worker process and compares parser time only. This avoids
process startup and pointer-construction noise.

Any failed limit makes the command exit with a non-zero status.

To loosen or tighten all limits for a specific machine:

```sh
SOURCE_MODEL_BENCH_LIMIT_SCALE=1.5 pnpm benchmark:source-model
```

Use `--json` when machine-readable output is needed:

```sh
node benchmarks/sourceModelBenchmark.js --json
```

## UI Performance Baseline

Run the large JSON UI performance gate:

```sh
pnpm test:e2e:performance
```

The UI gate runs each scenario three times by default. It records each round,
uses the median round result as the regression baseline, and still gates the
worst interaction latency and maximum UI event-loop gap where applicable.

The machine-readable baseline is written to:

```text
test-results/large-json-performance-baseline.json
```

Change the number of rounds or output path when needed:

```sh
JSON_STUDIO_E2E_ROUNDS=5 pnpm test:e2e:performance
JSON_STUDIO_E2E_BASELINE_OUTPUT=/tmp/jsonstudio-e2e-baseline.json pnpm test:e2e:performance
```
