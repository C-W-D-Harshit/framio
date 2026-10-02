import { afterEach, expect, it, vi } from "vitest";
import { readGeometry, writeGeometry } from "../../src/ui/frame-geometry";
import type { SnapshotFrame } from "../../src/contracts/snapshot";
const frame: SnapshotFrame = {
  id: "page/frame",
  kind: "tsx",
  page: "page",
  slug: "frame",
  relFile: "frame.tsx",
  meta: { name: "Frame", width: 390, height: 844 },
  parent: null,
  version: 1,
  geometryVersion: "content-theme",
  error: null,
};
afterEach(() => vi.unstubAllGlobals());
it("restores measured heights across restarts but invalidates content, theme and width changes", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  writeGeometry("project", "page", [frame], 1, { [frame.id]: 949 });
  expect(
    readGeometry("project", "page", [{ ...frame, version: 42 }], 12),
  ).toEqual({ [frame.id]: 949 });
  expect(
    readGeometry(
      "project",
      "page",
      [{ ...frame, geometryVersion: "new-content" }],
      1,
    ),
  ).toEqual({});
  expect(
    readGeometry(
      "project",
      "page",
      [{ ...frame, meta: { ...frame.meta, width: 768 } }],
      1,
    ),
  ).toEqual({});
});
it("ignores malformed storage and unavailable storage", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => '{"page/frame":{"height":-1,"fingerprint":"x"}}',
  });
  expect(readGeometry("project", "page", [frame], 1)).toEqual({});
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw Error("denied");
    },
    setItem: () => {
      throw Error("quota");
    },
  });
  expect(readGeometry("project", "page", [frame], 1)).toEqual({});
  expect(() =>
    writeGeometry("project", "page", [frame], 1, { [frame.id]: 949 }),
  ).not.toThrow();
});
