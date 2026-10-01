import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Option, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { LiveRpc } from "../../src/contracts/live";
import { runServer } from "../../src/server/server";

test("RPC publishes watched generations, stale reports are ignored and canvas fields survive saves", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-project-server-"));
  const dir = join(root, ".framio/pages/01-test");
  mkdirSync(dir, { recursive: true });
  symlinkSync(
    resolve(import.meta.dir, "../../node_modules"),
    join(root, ".framio/node_modules"),
  );
  writeFileSync(join(root, ".framio/theme.css"), "body { margin: 0; }");
  const source = (label: string) =>
    `export const meta={name:"${label}",width:390,height:844};export default function Frame(){return <h1>${label}</h1>}`;
  writeFileSync(join(dir, "one.tsx"), source("Before"));
  writeFileSync(
    join(dir, "canvas.json"),
    JSON.stringify({
      positions: { one: { x: 1, y: 2 } },
      custom: { keep: true },
    }),
  );
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { info } = yield* runServer(root);
          const protocol = RpcClient.layerProtocolSocket({
            retryTransientErrors: false,
          }).pipe(
            Layer.provide(
              Socket.layerWebSocket(
                info.url.replace("http", "ws") + "/ws",
              ).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
            ),
            Layer.provide(RpcSerialization.layerJson),
          );
          yield* Effect.scoped(
            Effect.gen(function* () {
              const rpc = yield* RpcClient.make(LiveRpc);
              const first = yield* rpc.snapshotsV1().pipe(Stream.runHead);
              expect(Option.isSome(first)).toBe(true);
              if (Option.isNone(first))
                return yield* Effect.die("No initial snapshot");
              const before = first.value.pages[0]!.frames[0]!;
              expect(before.meta.name).toBe("Before");
              yield* Effect.sync(() =>
                writeFileSync(join(dir, "one.tsx"), source("After")),
              );
              const changed = yield* rpc.snapshotsV1().pipe(
                Stream.filter(
                  (snapshot) =>
                    snapshot.pages[0]?.frames[0]?.meta.name === "After",
                ),
                Stream.runHead,
                Effect.timeout("5 seconds"),
              );
              if (Option.isNone(changed))
                return yield* Effect.die("No watched generation");
              const after = changed.value.pages[0]!.frames[0]!;
              expect(after.version).toBeGreaterThan(before.version);
              const oldEntry = yield* Effect.promise(() =>
                fetch(`${info.url}/js/01-test/one.js?v=${before.version}`, {
                  headers: { connection: "close" },
                }).then((response) => response.text()),
              );
              expect(oldEntry.includes('children: "Before"')).toBe(true);
              expect(oldEntry.includes('children: "After"')).toBe(false);
              const status = yield* Effect.promise(() =>
                fetch(`${info.url}/api/frame-status`, {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    connection: "close",
                  },
                  body: JSON.stringify({
                    id: before.id,
                    version: before.version,
                    error: "stale failure",
                  }),
                }),
              );
              expect(status.status).toBe(200);
              yield* Effect.promise(() => status.text());
              const current = yield* rpc.snapshotsV1().pipe(Stream.runHead);
              if (Option.isNone(current))
                return yield* Effect.die("No current snapshot");
              expect(current.value.pages[0]!.frames[0]!.error).toBeNull();
              const save = yield* Effect.promise(() =>
                fetch(`${info.url}/api/canvas`, {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    connection: "close",
                  },
                  body: JSON.stringify({
                    page: "01-test",
                    positions: { two: { x: 3.4, y: 4.6 } },
                  }),
                }),
              );
              expect(save.status).toBe(200);
              yield* Effect.promise(() => save.text());
              expect(
                JSON.parse(readFileSync(join(dir, "canvas.json"), "utf8")),
              ).toEqual({
                positions: { one: { x: 1, y: 2 }, two: { x: 3, y: 5 } },
                custom: { keep: true },
              });
              const invalid = yield* Effect.promise(() =>
                fetch(`${info.url}/api/screenshot`, {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    connection: "close",
                  },
                  body: JSON.stringify({ scale: -1 }),
                }),
              );
              expect(invalid.status).toBe(400);
              yield* Effect.promise(() => invalid.text());
            }).pipe(Effect.provide(protocol)),
          );
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
