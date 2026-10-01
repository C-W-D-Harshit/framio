import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Equal from "effect/Equal";
import * as PlatformError from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { HttpClient, HttpClientResponse } from "effect/http";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { GLOBAL_DIR, projectPaths, type ProjectPaths } from "../lib/paths";
import { Health, RegisteredServer, ServerInfo } from "../contracts/server-info";
import { ServerIdentityMismatch, ServerStartupFailed } from "../domain/errors";

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return Predicate.hasProperty(cause, "code") && cause.code === "EPERM";
  }
};

const directory = join(GLOBAL_DIR, "servers");
const registryFile = (root: string) =>
  join(directory, `${createHash("sha256").update(root).digest("hex")}.json`);
type Error = PlatformError.PlatformError;
export class ServerRegistry extends Context.Service<
  ServerRegistry,
  {
    read: (p: ProjectPaths) => Effect.Effect<ServerInfo | null, Error>;
    running: (
      p: ProjectPaths,
    ) => Effect.Effect<ServerInfo | null, Error | ServerStartupFailed>;
    lock: (p: ProjectPaths) => Effect.Effect<boolean, Error, Scope.Scope>;
    register: (
      p: ProjectPaths,
      info: ServerInfo,
    ) => Effect.Effect<void, Error, Scope.Scope>;
    list: Effect.Effect<RegisteredServer[], Error>;
    stop: (
      info: ServerInfo,
      root: string,
    ) => Effect.Effect<
      void,
      Error | ServerIdentityMismatch | ServerStartupFailed
    >;
  }
>()("framio/services/ServerRegistry") {
  static readonly layer = Layer.effect(
    ServerRegistry,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
      );
      const readJson = <S extends Schema.Constraint>(schema: S, file: string) =>
        fs.readFileString(file).pipe(
          Effect.flatMap((text) =>
            Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(
              text,
            ).pipe(Effect.catch(() => Effect.succeed(null))),
          ),
          Effect.catchReason("PlatformError", "NotFound", () =>
            Effect.succeed(null),
          ),
        );
      const read = (p: ProjectPaths) => readJson(ServerInfo, p.serverFile);
      const healthy = Effect.fn("ServerRegistry.healthy")(
        (info: ServerInfo, root: string) =>
          client.get(`${info.url}/api/health`).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Health)),
            Effect.map((body) => ({
              healthy: body.ok && body.root === root && body.pid === info.pid,
              compatible: body.protocol === "framio-v4-1",
            })),
            Effect.timeout("1 second"),
            Effect.catch(() =>
              Effect.succeed({ healthy: false, compatible: false }),
            ),
          ),
      );
      const removeOwned = Effect.fn("ServerRegistry.removeOwned")(function* (
        file: string,
        pid: number,
      ) {
        const entry = yield* readJson(ServerInfo, file);
        if (entry?.pid === pid) yield* fs.remove(file, { force: true });
      });
      const running = Effect.fn("ServerRegistry.running")(function* (
        p: ProjectPaths,
      ) {
        const info = yield* read(p);
        if (!info) return null;
        if (isAlive(info.pid)) {
          const check = yield* healthy(info, p.root);
          if (check.healthy && !check.compatible)
            return yield* new ServerStartupFailed({
              message:
                "A running Framio server uses an older internal protocol. Run `framio stop`, then `framio start` to restart it.",
            });
          return check.healthy ? info : null;
        }
        yield* removeOwned(p.serverFile, info.pid);
        return null;
      });
      const lock = Effect.fn("ServerRegistry.lock")(function* (
        p: ProjectPaths,
      ) {
        yield* fs.makeDirectory(p.state, { recursive: true });
        const file = join(p.state, "server.lock");
        for (let attempt = 0; attempt < 2; attempt++) {
          const acquired = yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const written = yield* fs
                .writeFileString(file, String(process.pid), { flag: "wx" })
                .pipe(Effect.result);
              if (written._tag === "Failure") {
                if (written.failure.reason._tag === "AlreadyExists")
                  return false;
                return yield* Effect.fail(written.failure);
              }
              const identity = yield* fs.stat(file);
              yield* Effect.addFinalizer(() =>
                Effect.gen(function* () {
                  const current = yield* fs.stat(file);
                  if (
                    Equal.equals(current.ino, identity.ino) &&
                    (yield* fs.readFileString(file)) === String(process.pid)
                  )
                    yield* fs.remove(file, { force: true });
                }).pipe(
                  Effect.catchReason(
                    "PlatformError",
                    "NotFound",
                    () => Effect.void,
                  ),
                  Effect.catch((error) =>
                    Effect.logWarning("Lock cleanup failed", error.message),
                  ),
                ),
              );
              return true;
            }),
          );
          if (acquired) return true;
          const pid = yield* fs.readFileString(file).pipe(
            Effect.map(Number),
            Effect.catchReason("PlatformError", "NotFound", () =>
              Effect.succeed(0),
            ),
          );
          if (!Number.isInteger(pid) || pid <= 0 || isAlive(pid)) return false;
          const recovered = yield* Effect.scoped(
            Effect.gen(function* () {
              const recovery = `${file}.recovery`;
              const created = yield* fs
                .writeFileString(recovery, String(process.pid), { flag: "wx" })
                .pipe(Effect.result);
              if (created._tag === "Failure") {
                if (created.failure.reason._tag === "AlreadyExists")
                  return false;
                return yield* Effect.fail(created.failure);
              }
              yield* Effect.addFinalizer(() =>
                fs
                  .remove(recovery, { force: true })
                  .pipe(
                    Effect.catch((error) =>
                      Effect.logWarning(
                        "Recovery lock cleanup failed",
                        error.message,
                      ),
                    ),
                  ),
              );
              const current = yield* fs.readFileString(file).pipe(
                Effect.map(Number),
                Effect.catchReason("PlatformError", "NotFound", () =>
                  Effect.succeed(0),
                ),
              );
              if (Number.isInteger(current) && current > 0 && !isAlive(current))
                yield* fs.remove(file, { force: true });
              return true;
            }).pipe(Effect.uninterruptible),
          );
          if (!recovered) return false;
        }
        return false;
      });
      const register = Effect.fn("ServerRegistry.register")(function* (
        p: ProjectPaths,
        info: ServerInfo,
      ) {
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* Effect.addFinalizer(() =>
          Effect.forEach(
            [p.serverFile, registryFile(p.root)],
            (file) =>
              removeOwned(file, info.pid).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("Registry cleanup failed", error.message),
                ),
              ),
            { discard: true },
          ),
        );
        yield* fs.writeFileString(
          p.serverFile,
          JSON.stringify(info, null, 2) + "\n",
        );
        yield* fs.writeFileString(
          registryFile(p.root),
          JSON.stringify({ ...info, root: p.root }),
        );
      });
      const list = Effect.gen(function* () {
        if (!(yield* fs.exists(directory))) return [];
        const files = yield* fs.readDirectory(directory);
        const entries = yield* Effect.forEach(
          files.filter((file) => file.endsWith(".json")),
          (file) =>
            Effect.gen(function* () {
              const path = join(directory, file);
              const entry = yield* readJson(RegisteredServer, path);
              if (!entry) return null;
              if (!isAlive(entry.pid)) {
                yield* removeOwned(path, entry.pid);
                return null;
              }
              return (yield* healthy(entry, entry.root)).healthy ? entry : null;
            }),
          { concurrency: 8 },
        );
        return entries.filter((entry) => entry !== null);
      });
      const stop = Effect.fn("ServerRegistry.stop")(function* (
        info: ServerInfo,
        root: string,
      ) {
        if (!isAlive(info.pid)) return;
        if (!(yield* healthy(info, root)).healthy)
          return yield* new ServerIdentityMismatch({
            message: `Cannot verify Framio pid ${info.pid} for ${root}; refusing to stop it.`,
          });
        yield* Effect.try({
          try: () => process.kill(info.pid, "SIGTERM"),
          catch: (cause) => new ServerStartupFailed({ message: String(cause) }),
        });
        const stopped = yield* Effect.gen(function* () {
          while (isAlive(info.pid)) yield* Effect.sleep("50 millis");
        }).pipe(Effect.timeoutOption("10 seconds"));
        if (stopped._tag === "None")
          return yield* new ServerStartupFailed({
            message: `Framio pid ${info.pid} did not stop within 10 seconds.`,
          });
      });
      return ServerRegistry.of({ read, running, lock, register, list, stop });
    }),
  );
}
