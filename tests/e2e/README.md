# E2E Tests

End-to-end tests for the Twitter Clone application using Playwright.

## Prerequisites

- Docker and Docker Compose (for test database/redis/minio)
- Node.js 22+
- All dependencies installed (`npm install`)

## Running E2E Tests

### 1. Start test infrastructure

```bash
docker compose -f docker-compose.test.yml up -d
```

This starts ephemeral PostgreSQL, Redis, and MinIO containers on different ports:
- PostgreSQL: localhost:5433
- Redis: localhost:6380
- MinIO: localhost:9002

### 2. Run migrations and seed data

The global setup script automatically runs migrations and seeds the database before tests.

### 3. Run tests

```bash
# Run all E2E tests
npm run test:e2e

# Run specific test file
npx playwright test tests/e2e/specs/auth.spec.ts

# Run in UI mode (interactive)
npx playwright test --ui

# Run in headed mode (see browser)
npx playwright test --headed

# Debug mode
npx playwright test --debug
```

### 4. View test results

```bash
# Open HTML report
npx playwright show-report
```

### 5. Cleanup

```bash
docker compose -f docker-compose.test.yml down
```

## Test Structure

```
tests/e2e/
├── specs/              # Test specifications
│   ├── auth.spec.ts    # Authentication tests
│   ├── tweet.spec.ts   # Tweet management tests
│   ├── feed.spec.ts    # Feed tests
│   └── social.spec.ts  # Social graph tests
├── page-objects/       # Page object models
│   ├── auth.page.ts
│   ├── composer.page.ts
│   ├── feed.page.ts
│   └── social.page.ts
├── fixtures.ts         # Playwright fixtures with page objects
├── global-setup.ts     # Global setup (migrations, seed data)
└── README.md
```

## Test Data

Tests use deterministic fixture data from `scripts/seed.ts`:
- 5 users (user1@test.com - user5@test.com, password: password123)
- 20 tweets (standalone, replies, quote tweets)
- Follow relationships
- Likes and retweets

## Debugging

- Console logs and page errors are captured during test execution
- Failed tests automatically capture:
  - Screenshot
  - Video recording
  - Trace (view with `npx playwright show-trace trace.zip`)

## CI/CD

In CI environments:
- Tests retry twice on failure
- Run with 1 worker (sequential)
- Use isolated test database

## Environment Variables

Test environment uses `.env.test` which points to test infrastructure:
- `DATABASE_URL`: Test PostgreSQL (port 5433)
- `REDIS_URL`: Test Redis (port 6380)
- `S3_ENDPOINT`: Test MinIO (port 9002)
