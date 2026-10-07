import { describe, it, expect } from "@effect/vitest";
import { Effect } from "effect";
import { posix, win32 } from "node:path";
import {
  isWithinSourceDirectory,
  sourcePathSegments,
} from "../../src/lib/source-paths";

describe("source path containment", () => {
  for (const [paths, root] of [
    [posix, "/project/.framio"],
    [win32, "D:\\Runner Name\\project\\.framio"],
    [win32, "\\\\server\\share\\project\\.framio"],
  ] as const) {
    it.effect(`validates segments under ${root}`, () =>
      Effect.sync(() => {
        expect(sourcePathSegments(root, "pages/home/frame.tsx", paths)).toEqual(
          [
            paths.resolve(root, "pages"),
            paths.resolve(root, "pages/home"),
            paths.resolve(root, "pages/home/frame.tsx"),
          ],
        );
        for (const file of [
          "../frame.tsx",
          "pages/../frame.tsx",
          "pages//frame.tsx",
          "pages/./frame.tsx",
          "pages\\frame.tsx",
          "components/Button.tsx",
          "pages/frame.ts",
          "D:/frame.tsx",
        ])
          expect(sourcePathSegments(root, file, paths)).toBeNull();
        const pages = paths.resolve(root, "pages");
        for (const file of [
          pages,
          paths.resolve(root, "pages-other/frame.tsx"),
          paths.resolve(root, "frame.tsx"),
          paths.resolve(root, "../frame.tsx"),
        ])
          expect(isWithinSourceDirectory(pages, file, paths)).toBe(false);
      }),
    );
  }
  it.effect(
    "handles Windows drive case, separators, and different volumes",
    () =>
      Effect.sync(() => {
        expect(
          isWithinSourceDirectory(
            "d:\\project\\.framio\\pages",
            "D:/PROJECT/.framio/pages/home/frame.tsx",
            win32,
          ),
        ).toBe(true);
        expect(
          isWithinSourceDirectory(
            "D:\\project\\.framio\\pages",
            "E:\\project\\.framio\\pages\\frame.tsx",
            win32,
          ),
        ).toBe(false);
        expect(
          sourcePathSegments(
            "D:\\project\\.framio",
            "pages/E:/frame.tsx",
            win32,
          ),
        ).toBeNull();
      }),
  );
});
