import { describe, it, expect } from "@effect/vitest";
import { vi } from "vitest";
import { Deferred, Effect, Fiber, FileSystem } from "effect";
import { makeSourceEdits } from "../../src/services/source-edits";
import { parseSource, sourceRevision } from "../../src/server/source-edits";
import { formatSourceRef, type EditOperation } from "../../src/contracts/edits";
import { basename, resolve, win32 } from "node:path";

const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  published: [] as string[],
  symlinks: new Set<string>(),
}));
vi.mock("../../src/platform/source-file", () => ({
  isSourceSymlink: (path: string) => Effect.succeed(state.symlinks.has(path)),
}));
vi.mock("../../src/platform/atomic-file", () => ({
  publishIfUnchanged: (file: string, temporary: string, expected: string) =>
    Effect.sync(() => {
      if (state.files.get(file) !== expected) {
        state.files.delete(temporary);
        return false;
      }
      state.files.set(file, state.files.get(temporary)!);
      state.files.delete(temporary);
      state.published.push(file);
      return true;
    }),
}));
const root = resolve("/workspace/.framio");
const file = "pages/home/frame.tsx";
const absolute = resolve(root, file);
const original = "<div><p>Hi 🌏</p><p>Anchor</p></div>";
const op = (type: EditOperation["type"] = "text"): EditOperation => {
  const node = parseSource(original, file).elements[1]!;
  const ref = formatSourceRef({
    file,
    start: node.getStart(),
    end: node.end,
    rev: sourceRevision(original),
  });
  return type === "text"
    ? { type, ref, text: "Hello" }
    : { type: "remove", ref };
};
function fixture(overrides: Partial<FileSystem.FileSystem> = {}) {
  state.files.clear();
  state.published.length = 0;
  state.symlinks.clear();
  state.files.set(absolute, original);
  return FileSystem.makeNoop({
    realPath: (path) =>
      state.files.has(path) || path === root || path === resolve(root, "pages")
        ? Effect.succeed(path)
        : FileSystem.makeNoop({}).realPath(path),
    readFileString: (path) => {
      const text = state.files.get(path);
      return text === undefined
        ? FileSystem.makeNoop({}).readFileString(path)
        : Effect.succeed(text);
    },
    writeFileString: (path, text) =>
      Effect.sync(() => {
        state.files.set(path, text);
      }),
    remove: (path) =>
      Effect.sync(() => {
        state.files.delete(path);
      }),
    ...overrides,
  });
}
describe("source edit writes", () => {
  it.effect(
    "uses canonical Windows paths through edits, undo, and redo",
    () => {
      const alias = "D:\\RUNNER~1\\project\\.framio";
      const canonical = "d:\\Runner Name\\project\\.framio";
      const target = win32.resolve(canonical, file);
      const fs = fixture({
        realPath: (path) =>
          Effect.succeed(
            path === alias
              ? canonical
              : path.replace(/^d:/, "D:").replace(/\\/g, "/"),
          ),
        writeFileString: (path, text) =>
          Effect.sync(() => {
            state.files.set(path, text);
          }),
      });
      state.files.clear();
      // The native adapter returns the canonical filename used for publication.
      const nativeTarget = target.replace(/^d:/, "D:").replace(/\\/g, "/");
      state.files.set(nativeTarget, original);
      return Effect.gen(function* () {
        const service = yield* makeSourceEdits(alias, win32);
        const result = yield* service.edit(op());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const undo = yield* service.patch(result.undo);
        expect(undo.ok).toBe(true);
        if (undo.ok) expect((yield* service.patch(undo.inverse)).ok).toBe(true);
        expect(state.published).toEqual([
          nativeTarget,
          nativeTarget,
          nativeTarget,
        ]);
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          readFileString: (path) => {
            const text = state.files.get(path);
            return text === undefined
              ? FileSystem.makeNoop({}).readFileString(path)
              : Effect.succeed(text);
          },
        }),
      );
    },
  );
  it.effect(
    "rejects canonical paths that escape pages even without a reported link",
    () => {
      const fs = fixture({
        realPath: (path) =>
          Effect.succeed(
            path === absolute ? resolve(root, "pages-other/frame.tsx") : path,
          ),
      });
      return Effect.gen(function* () {
        const service = yield* makeSourceEdits(root);
        expect(yield* service.edit(op())).toMatchObject({
          ok: false,
          reason: "invalid",
        });
        expect(state.published).toEqual([]);
      }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
    },
  );
  it.effect(
    "rejects links at pages, parent, and target, including in-tree links",
    () => {
      const fs = fixture();
      return Effect.gen(function* () {
        const service = yield* makeSourceEdits(root);
        for (const link of [
          resolve(root, "pages"),
          resolve(root, "pages/home"),
          absolute,
        ]) {
          state.symlinks.add(link);
          expect(yield* service.edit(op())).toMatchObject({
            ok: false,
            reason: "invalid",
          });
          state.symlinks.delete(link);
        }
        expect(state.published).toEqual([]);
      }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
    },
  );
  it.effect("rechecks parent links after preparing the temporary file", () => {
    const fs = fixture({
      writeFileString: (path, text) =>
        Effect.sync(() => {
          state.files.set(path, text);
          state.symlinks.add(resolve(root, "pages/home"));
        }),
    });
    return Effect.gen(function* () {
      const service = yield* makeSourceEdits(root);
      expect(yield* service.edit(op())).toMatchObject({
        ok: false,
        reason: "invalid",
      });
      expect([...state.files.keys()]).toEqual([absolute]);
      expect(state.files.get(absolute)).toBe(original);
      expect(state.published).toEqual([]);
    }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
  });
  it.effect(
    "writes edits and supports exact undo and redo with full revision checks",
    () => {
      const fs = fixture();
      return Effect.gen(function* () {
        const service = yield* makeSourceEdits(root);
        const result = yield* service.edit(op());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const edited = state.files.get(absolute);
        expect(edited).toBe("<div><p>Hello</p><p>Anchor</p></div>");
        const undo = yield* service.patch(result.undo);
        expect(undo.ok).toBe(true);
        expect(state.files.get(absolute)).toBe(original);
        expect(yield* service.patch(result.undo)).toMatchObject({
          ok: false,
          reason: "conflict",
          message:
            "The file changed since this edit, so it can't be undone here.",
        });
        if (undo.ok) expect((yield* service.patch(undo.inverse)).ok).toBe(true);
        expect(state.files.get(absolute)).toBe(edited);
        expect(state.published).toHaveLength(3);
        expect([...state.files.keys()]).toEqual([absolute]);
      }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
    },
  );
  it.effect(
    "rejects traversal, absolute paths, components, other extensions, and symlinks",
    () => {
      const fs = fixture({
        realPath: (path) =>
          Effect.succeed(
            basename(path) === "link.tsx"
              ? resolve("/outside/frame.tsx")
              : path,
          ),
      });
      state.symlinks.add(resolve(root, "pages/link.tsx"));
      return Effect.gen(function* () {
        const service = yield* makeSourceEdits(root);
        for (const unsafe of [
          "../frame.tsx",
          "pages/../../frame.tsx",
          "/workspace/.framio/pages/frame.tsx",
          "components/Button.tsx",
          "pages/frame.ts",
          "pages\\frame.tsx",
          "pages/./frame.tsx",
          "pages//frame.tsx",
          "pages/link.tsx",
        ]) {
          const patch = {
            file: unsafe,
            revision: sourceRevision(original),
            start: 0,
            end: 0,
            text: "",
          };
          expect(yield* service.patch(patch)).toMatchObject({
            ok: false,
            reason: "invalid",
          });
          const ref = `${unsafe}:0:5:${sourceRevision(original).slice(0, 12)}`;
          expect(yield* service.edit({ type: "remove", ref })).toMatchObject({
            ok: false,
            reason: "invalid",
          });
        }
        expect(state.published).toEqual([]);
      }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
    },
  );
  it.effect(
    "refuses missing files and checks patch bounds before publication",
    () => {
      const fs = fixture();
      return Effect.gen(function* () {
        const service = yield* makeSourceEdits(root);
        expect(
          yield* service.patch({
            file: "pages/missing.jsx",
            revision: "",
            start: 0,
            end: 0,
            text: "",
          }),
        ).toMatchObject({ ok: false, reason: "not-found" });
        expect(
          yield* service.patch({
            file,
            revision: sourceRevision(original),
            start: 0,
            end: 1000,
            text: "",
          }),
        ).toMatchObject({ ok: false, reason: "invalid" });
        expect(state.published).toEqual([]);
      }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
    },
  );
  it.effect(
    "conflicts when agent bytes change between reading and publication and cleans temporary files",
    () => {
      const fs = fixture({
        writeFileString: (path, text) =>
          Effect.sync(() => {
            state.files.set(path, text);
            state.files.set(absolute, original + "\n// Agent edit");
          }),
      });
      return Effect.gen(function* () {
        const service = yield* makeSourceEdits(root);
        expect(yield* service.edit(op())).toMatchObject({
          ok: false,
          reason: "conflict",
        });
        expect(state.files.get(absolute)).toBe(original + "\n// Agent edit");
        expect([...state.files.keys()]).toEqual([absolute]);
        expect(state.published).toEqual([]);
      }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
    },
  );
  it.effect(
    "serializes same-file writes but permits different files while a write is paused",
    () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let writes = 0;
        const fs = fixture({
          writeFileString: (path, text) =>
            Effect.gen(function* () {
              if (path.startsWith(`${absolute}.`)) {
                writes++;
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
              }
              state.files.set(path, text);
            }),
        });
        state.files.set(resolve(root, "pages/other.jsx"), original);
        yield* Effect.gen(function* () {
          const service = yield* makeSourceEdits(root);
          const first = yield* service.edit(op()).pipe(Effect.forkScoped);
          yield* Deferred.await(entered);
          const second = yield* service
            .edit(op("remove"))
            .pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          expect(writes).toBe(1);
          const other = yield* service.patch({
            file: "pages/other.jsx",
            revision: sourceRevision(original),
            start: 0,
            end: 0,
            text: "// Independent\n",
          });
          expect(other.ok).toBe(true);
          yield* Deferred.succeed(release, undefined);
          expect((yield* Fiber.join(first)).ok).toBe(true);
          expect(yield* Fiber.join(second)).toMatchObject({
            ok: false,
            reason: "conflict",
          });
          expect(writes).toBe(1);
        }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
      }),
  );
});
