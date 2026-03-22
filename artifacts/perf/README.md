# Performance Smoke Tests

This directory contains performance smoke tests that verify the application meets the latency targets defined in `plans/twitter-clone.md` §9.

## What is Tested

The smoke suite measures endpoint latencies against development environment baselines:

| Endpoint | p50 | p99 | Bottleneck |
|----------|-----|-----|------------|
| `feed.home` (cache hit) | <50ms | <150ms | Redis GET + deserialize |
| `feed.home` (cache miss) | <200ms | <500ms | UNION query + hydrate + engagement batch |
| `search.tweets` | <150ms | <400ms | GIN index FTS |
| `search.users` | <100ms | <300ms | pg_trgm GIN index |
| `auth.register` | <400ms | <800ms | bcrypt(12) ≈ 250ms |
| SSE first event | <2s | <5s | Redis SUBSCRIBE + auth |
| Page load (LCP) | <1.5s | <3s | Next.js RSC streaming |

## Running the Tests

### Prerequisites

1. Start the development infrastructure:
   ```bash
   docker compose up -d
   ```

2. Run database migrations:
   ```bash
   npx prisma migrate deploy
   ```

3. Start the Next.js dev server (for SSE and page load tests):
   ```bash
   npm run dev
   ```

### API Performance Tests

The `scripts/perf-smoke.ts` script measures tRPC endpoint latencies:

```bash
# Run with console output
npx tsx scripts/perf-smoke.ts

# Generate JSON report
npx tsx scripts/perf-smoke.ts --json > artifacts/perf/report.json
```

**What it does:**
1. Creates fixture data (users, follows, tweets)
2. Measures feed.home with cache hit/miss scenarios (10 samples each)
3. Measures search.tweets and search.users (15 samples each)
4. Measures auth.register (10 samples)
5. Measures SSE first-event handshake (5 samples)
6. Calculates p50/p95/p99 percentiles
7. Reports pass/fail against §9 thresholds
8. Cleans up all fixture data

**Exit codes:**
- `0`: All tests passed
- `1`: One or more tests failed or error occurred

### Browser Performance Tests

The Playwright spec `tests/perf/page-load.spec.ts` measures browser-level metrics:

```bash
# Run page load tests
npx playwright test tests/perf/page-load.spec.ts

# Run with UI
npx playwright test tests/perf/page-load.spec.ts --ui

# Debug mode
npx playwright test tests/perf/page-load.spec.ts --debug
```

**What it measures:**
- LCP (Largest Contentful Paint)
- TTFB (Time to First Byte)
- DOM Content Loaded
- Load Complete
- Consistency across repeated loads

**Prerequisites:**
- Seed data must be present (`npx tsx scripts/seed.ts`)
- Test uses fixture user `alice@example.com` / `password123`

## Understanding the Results

### Console Output

The script produces a table like this:

```
================================================================================
PERFORMANCE SMOKE TEST RESULTS
================================================================================
Timestamp: 2026-03-23T12:34:56.789Z
Total Samples: 75

✅ PASS feed.home.cacheHit
  p50: 23.4ms (threshold: 50ms)
  p95: 42.1ms (threshold: 100ms)
  p99: 48.7ms (threshold: 150ms)

❌ FAIL feed.home.cacheMiss
  p50: 156.2ms (threshold: 200ms)
  p95: 387.9ms (threshold: 350ms)
  p99: 523.1ms (threshold: 500ms)
  Violations:
    - p95 387.9ms > 350ms
    - p99 523.1ms > 500ms

...

================================================================================
SUMMARY
================================================================================
Total: 6
Passed: 5
Failed: 1
================================================================================
```

### JSON Report

Use `--json` to generate machine-readable output:

```json
{
  "timestamp": "2026-03-23T12:34:56.789Z",
  "samples": [
    {
      "endpoint": "feed.home.cacheHit",
      "latencyMs": 23.4,
      "metadata": { "cacheHit": true }
    },
    ...
  ],
  "results": [
    {
      "endpoint": "feed.home.cacheHit",
      "p50": 23.4,
      "p95": 42.1,
      "p99": 48.7,
      "thresholds": { "p50": 50, "p95": 100, "p99": 150 },
      "pass": true,
      "violations": []
    },
    ...
  ],
  "summary": {
    "total": 6,
    "passed": 5,
    "failed": 1
  }
}
```

## Inspecting Regressions

When a test fails, follow this checklist:

### 1. Check the violations

The report shows which percentile(s) exceeded thresholds:
```
Violations:
  - p95 387.9ms > 350ms
  - p99 523.1ms > 500ms
```

### 2. Review recent changes

Run `git log --oneline -10` to see recent commits. Performance regressions often come from:
- Missing indexes (check Prisma schema)
- N+1 queries (check tRPC router for missing `include` clauses)
- Inefficient feed deduplication
- Redis cache misses (check cache key patterns)
- Missing `select` clauses loading unnecessary fields

### 3. Enable query logging

Add to `.env.local`:
```
DATABASE_URL="postgresql://...?connect_timeout=10&pool_timeout=10&statement_timeout=30000"
DEBUG="prisma:query"
```

Run the script again and review SQL queries in the output.

### 4. Check Redis

```bash
# Monitor Redis commands in real-time
docker exec -it twitter-redis redis-cli MONITOR

# Check cache hit rate
docker exec -it twitter-redis redis-cli INFO stats | grep keyspace
```

### 5. Inspect feed caching

The `feed.home` cache keys follow this pattern:
```
feed:home:{userId}:{limit}
```

TTL is 60 seconds. Check if cache is populating:
```bash
docker exec -it twitter-redis redis-cli KEYS "feed:home:*"
docker exec -it twitter-redis redis-cli TTL "feed:home:<userId>:20"
```

### 6. Profile with Chrome DevTools

For page load regressions, use Playwright trace:
```bash
npx playwright test tests/perf/page-load.spec.ts --trace on
npx playwright show-trace test-results/.../trace.zip
```

Inspect:
- Network waterfall (slow API calls)
- Main thread blocking (large JS bundles)
- LCP element (images not optimized?)

### 7. Compare against baseline

Store a passing report as a baseline:
```bash
npx tsx scripts/perf-smoke.ts --json > artifacts/perf/baseline.json
```

After changes, compare:
```bash
npx tsx scripts/perf-smoke.ts --json > artifacts/perf/current.json
jq -s '.[0].results as $baseline | .[1].results as $current |
  [$baseline, $current] | transpose |
  map({endpoint: .[0].endpoint, baseline_p99: .[0].p99, current_p99: .[1].p99, delta: (.[1].p99 - .[0].p99)})' \
  artifacts/perf/baseline.json artifacts/perf/current.json
```

### 8. Known variance

bcrypt-bound operations (`auth.register`) have inherent variance based on CPU load. If p50 stays within threshold but p99 occasionally spikes, this is expected on shared development machines.

SSE first-event timing includes Redis connection setup and may vary based on whether connections are pooled.

## When to Update Thresholds

These are **development environment** baselines, not production SLOs.

Only update thresholds if:
1. A legitimate optimization improves performance (tighten the threshold)
2. A necessary feature requires more work (e.g., adding an expensive join) and the new latency is still acceptable for the product (loosen the threshold with team approval)

**Never** relax thresholds just to make a failing test pass. Investigate the regression first.

## CI Integration

To run in CI:

```yaml
- name: Performance Smoke Tests
  run: |
    docker compose up -d
    npx prisma migrate deploy
    npm run dev &
    sleep 5
    npx tsx scripts/perf-smoke.ts --json > perf-report.json
    cat perf-report.json
```

Store the JSON report as a build artifact for historical comparison.

## Troubleshooting

### "SSE benchmark skipped"

The SSE endpoint requires the Next.js server to be running. Start it with `npm run dev` before running the script.

### "Redis cleanup warning"

Non-fatal. The script continues if Redis is unavailable. Check `docker compose ps` to verify Redis is running.

### "Prisma Client not generated"

Run `npx prisma generate` before executing the script.

### All tests fail with high latencies

Check system load with `top` or `htop`. Running multiple build agents, Docker containers, or other CPU-intensive tasks will skew results.

## Related Documentation

- `plans/twitter-clone.md` §9: Full performance targets and observability requirements
- `plans/twitter-clone.md` §1.9: Feed assembly strategy and caching
- `src/server/trpc/middleware.ts`: tRPC response logging (captures `latencyMs` for all requests)
- `src/server/services/feed.ts`: Feed caching implementation
