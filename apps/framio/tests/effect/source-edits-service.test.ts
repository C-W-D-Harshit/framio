import { describe, it, expect } from "@effect/vitest";
import { vi } from "vitest";
import { Deferred, Effect, Fiber, FileSystem } from "effect";
import { makeSourceEdits } from "../../src/services/source-edits";
import { parseSource, sourceRevision } from "../../src/server/source-edits";
import { formatSourceRef, type EditOperation } from "../../src/contracts/edits";

const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  published: [] as string[],
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
const root = "/workspace/.framio";
const file = "pages/home/frame.tsx";
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
  state.files.set(`${root}/${file}`, original);
  return FileSystem.makeNoop({
    realPath: (path) =>
      state.files.has(path)
        ? Effect.succeed(path)
        : FileSystem.makeNoop({}).realPath(path),
    readFileString: (path) => Effect.sync(() => state.files.get(path)!),
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
    "writes edits and supports exact undo and redo with full revision checks",
    () => {
      const fs = fixture();
      return Effect.gen(function* () {
        const service = yield* makeSourceEdits(root);
        const result = yield* service.edit(op());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const edited = state.files.get(`${root}/${file}`);
        expect(edited).toBe("<div><p>Hello</p><p>Anchor</p></div>");
        const undo = yield* service.patch(result.undo);
        expect(undo.ok).toBe(true);
        expect(state.files.get(`${root}/${file}`)).toBe(original);
        expect(yield* service.patch(result.undo)).toMatchObject({
          ok: false,
          reason: "conflict",
          message:
            "The file changed since this edit, so it can't be undone here.",
        });
        if (undo.ok) expect((yield* service.patch(undo.inverse)).ok).toBe(true);
        expect(state.files.get(`${root}/${file}`)).toBe(edited);
        expect(state.published).toHaveLength(3);
        expect([...state.files.keys()]).toEqual([`${root}/${file}`]);
      }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
    },
  );
  it.effect(
    "rejects traversal, absolute paths, components, other extensions, and symlinks",
    () => {
      const fs = fixture({
        realPath: (path) =>
          Effect.succeed(
            path.endsWith("/link.tsx") ? "/outside/frame.tsx" : path,
          ),
      });
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
            state.files.set(`${root}/${file}`, original + "\n// Agent edit");
          }),
      });
      return Effect.gen(function* () {
        const service = yield* makeSourceEdits(root);
        expect(yield* service.edit(op())).toMatchObject({
          ok: false,
          reason: "conflict",
        });
        expect(state.files.get(`${root}/${file}`)).toBe(
          original + "\n// Agent edit",
        );
        expect([...state.files.keys()]).toEqual([`${root}/${file}`]);
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
              if (path.startsWith(`${root}/${file}.`)) {
                writes++;
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
              }
              state.files.set(path, text);
            }),
        });
        state.files.set(`${root}/pages/other.jsx`, original);
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
