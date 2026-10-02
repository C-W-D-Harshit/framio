#!/bin/sh
set -eu

# Bun/Puppeteer stack tracing becomes unreliable across browser test files in
# one process. Run every integration file in a fresh process, keeping all checks.
for test_file in tests/integration/*.test.ts; do
  bun test "$test_file"
done
