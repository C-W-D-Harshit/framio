import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Deferred, Effect, Fiber, FileSystem } from "effect";
import { runServer } from "../../src/server/server";

test("selection readers see complete JSON while a replacement is being written", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-selection-publication-"));
  mkdirSync(join(root, ".framio/pages"), { recursive: true });
  mkdirSync(join(root, ".framio/.state"), { recursive: true });
  writeFileSync(join(root, ".framio/theme.css"), "");
  const selection = join(root, ".framio/.state/selection.json");
  const previous = JSON.stringify({
    frames: [],
    element: null,
    selectedAt: "before",
  });
  writeFileSync(selection, previous);
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const writing = yield* Deferred.make<void>();
          const complete = yield* Deferred.make<void>();
          const writeFileString: typeof fs.writeFileString = (
            path,
            data,
            options,
          ) =>
            path.startsWith(selection)
              ? Effect.gen(function* () {
                  yield* fs.writeFileString(
                    path,
                    data.slice(0, Math.floor(data.length / 2)),
                    options,
                  );
                  yield* Deferred.succeed(writing, undefined);
                  yield* Deferred.await(complete);
                  yield* fs.writeFileString(path, data, options);
                })
              : fs.writeFileString(path, data, options);
          const { info } = yield* runServer(root).pipe(
            Effect.provideService(FileSystem.FileSystem, {
              ...fs,
              writeFileString,
            }),
          );
          const save = yield* Effect.promise(async () => {
            const response = await fetch(info.url + "/api/selection", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ frames: [], element: null }),
            });
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ ok: true });
          }).pipe(Effect.forkScoped);
          yield* Deferred.await(writing);
          try {
            expect(readFileSync(selection, "utf8")).toBe(previous);
          } finally {
            yield* Deferred.succeed(complete, undefined);
          }
          yield* Fiber.join(save);
          const published = JSON.parse(readFileSync(selection, "utf8"));
          expect(published.frames).toEqual([]);
          expect(published.selectedAt).not.toBe("before");
          expect(
            readdirSync(join(root, ".framio/.state")).filter((name) =>
              name.startsWith("selection.json"),
            ),
          ).toEqual(["selection.json"]);
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
