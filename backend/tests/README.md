# HOW TO RUN TESTS

## Prerequisites

Start Firebase emulators first:
```bash
firebase emulators:start
```

## Test Types

### Unit & Integration Tests (Jest)

Run all Jest tests (products, orders, etc.):
```bash
cd backend
npm test
```

Run specific test file:
```bash
npm test -- tests/products/products.test.js
```

### Custom Test Runners (Node.js)

These tests are run directly with Node.js (not Jest):

**Setup test data:**
```bash
node backend/scripts/setupTestData.js
```

**Run custom tests:**
```bash
# Chat system tests
node backend/tests/chat/chats.test.js

# Authentication tests
node backend/tests/auth/auth-test.js
```

### End-to-End Tests

Run all E2E tests with result export:
```bash
node backend/tests/e2e/runEndToEndTests.js --export
```

Run without export:
```bash
node backend/tests/e2e/runEndToEndTests.js
```

### Performance Tests

Run all performance tests:
```bash
node backend/tests/performance/runPerformanceTests.js
```

## Test Organization

- `tests/auth/` - Authentication tests
- `tests/chat/` - Chat system tests
- `tests/orders/` - Order management tests
- `tests/products/` - Product management tests
- `tests/e2e/` - End-to-end flow tests
- `tests/performance/` - Performance and load tests