import { expect, test } from "bun:test";
import {
  getSourcePuppeteerURLIfAvailable,
  withSourcePuppeteerURLIfNone,
} from "puppeteer-core/internal/common/util.js";

test("Puppeteer evaluation tolerates a missing runtime call site", () => {
  const previous = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = 1;
    const evaluate = () => 42;
    expect(withSourcePuppeteerURLIfNone("evaluate", evaluate)).toBe(evaluate);
    expect(evaluate()).toBe(42);
    expect(getSourcePuppeteerURLIfAvailable(evaluate)?.toString()).toBe(
      "pptr:evaluate;unknown",
    );
  } finally {
    Error.stackTraceLimit = previous;
  }
});
