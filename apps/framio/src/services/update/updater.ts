import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { installationIdentity } from "../../platform/update-storage";
import {
  backupExecutable,
  executableVersion,
  hashFile,
  native,
  platform,
  replaceExecutable,
  writableTarget,
} from "../../platform/update-files";
import {
  emptyUpdate,
  UpdateFailure,
  UpdateRecord,
  type UpdateStatus,
} from "../../contracts/update";
import { GLOBAL_DIR } from "../../lib/paths";
import { makeUpdateStorage, io } from "./storage";
import { CHECK_INTERVAL_MS, makeDiscovery, newer } from "./discovery";
import { stageRelease } from "./staging";
import { recordIfAvailable } from "../analytics";
import { compiled, runningVersion } from "../../lib/version";
export { compiled, runningVersion } from "../../lib/version";
export const makeUpdater = Effect.fn("Updater.make")(function* (
  options: {
    directory?: string;
    target?: string;
    version?: string;
    platform?: string;
    development?: boolean;
    background?: boolean;
  } = {},
) {
  const directory = options.directory ?? join(GLOBAL_DIR, "updates");
  const development = options.development ?? !compiled();
  const version = options.version ?? runningVersion;
  const identity = yield* io(() =>
    installationIdentity(
      options.target ??
        process.env.FRAMIO_INSTALLATION_TARGET ??
        process.execPath,
    ),
  );
  const key = `installation:${identity.id}`;
  const files = join(directory, identity.id),
    staged = join(
      files,
      process.platform === "win32" ? "staged.exe" : "staged",
    ),
    backup = join(
      files,
      process.platform === "win32" ? "previous.exe" : "previous",
    );
  const store = yield* makeUpdateStorage(directory);
  const discovery = makeDiscovery(
    store,
    options.platform ?? (yield* platform()),
  );
  const read = store
    .read(key, UpdateRecord)
    .pipe(Effect.map((value) => value ?? emptyUpdate));
  const write = (value: UpdateRecord) => store.write(key, value);
  let installedCache: { identity: string; version: string } | null = null;
  const installed: Effect.Effect<string | null, UpdateFailure> = development
    ? Effect.succeed(null)
    : Effect.gen(function* () {
        const info = yield* native(async () => await stat(identity.target));
        const signature = `${info.ino}/${info.size}/${info.mtimeMs}/${info.ctimeMs}`;
        if (installedCache?.identity === signature)
          return installedCache.version;
        const version = yield* executableVersion(identity.target);
        installedCache = { identity: signature, version };
        return version;
      });
  let backupInspected = false;
  const reconcile = Effect.fn("Updater.reconcile")(function* () {
    const record = yield* read;
    if (record.phase !== "downloading" && record.phase !== "installing") {
      if (
        record.previousVersion &&
        !backupInspected &&
        !(yield* store.owned(key))
      ) {
        backupInspected = true;
        const previous = yield* executableVersion(backup).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        if (previous && previous !== record.previousVersion)
          return yield* store.lock(
            key,
            Effect.gen(function* () {
              const current = yield* read;
              if (
                current.previousVersion === record.previousVersion &&
                current.phase === record.phase
              ) {
                const next = { ...current, previousVersion: previous };
                yield* write(next);
                return next;
              }
              return current;
            }),
          );
      }
      return record;
    }
    if (yield* store.owned(key)) return record;
    return yield* store.lock(
      key,
      Effect.gen(function* () {
        const current = yield* read;
        if (current.phase === "downloading") {
          const next: UpdateRecord = {
            ...current,
            phase: "download-failed",
            error:
              "The download was interrupted. Retry download to verify a complete archive.",
            stagedHash: null,
            operation: null,
          };
          yield* write(next);
          return next;
        }
        if (current.phase === "installing") {
          const actual = yield* installed.pipe(
            Effect.catch(() => Effect.succeed(null)),
          );
          const expected =
            current.operation === "rollback"
              ? current.previousVersion
              : current.release?.version;
          const next: UpdateRecord =
            actual === expected
              ? { ...current, phase: "idle", error: null, operation: null }
              : {
                  ...current,
                  phase: "install-failed",
                  error: `Installation was interrupted. The executable reports ${actual ?? "an unreadable version"}. Retry installation or roll back.`,
                  operation: null,
                };
          yield* write(next);
          return next;
        }
        return current;
      }),
    );
  });
  const check = Effect.fn("Updater.check")(function* (force = false) {
    const cache = yield* discovery.check(force);
    if (force && cache.error)
      return yield* new UpdateFailure({ message: cache.error });
    if (!cache.release) return;
    const actual = yield* installed.pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (!newer(cache.release.version, actual ?? version)) return;
    yield* store.lock(
      key,
      Effect.gen(function* () {
        const current = yield* read;
        if (
          current.phase === "ready" ||
          current.phase === "downloading" ||
          current.phase === "installing" ||
          current.phase === "install-failed"
        )
          return;
        yield* write({
          ...emptyUpdate,
          phase: "available",
          release: cache.release,
          previousVersion: current.previousVersion,
        });
      }),
    );
  });
  const status = Effect.fn("Updater.status")(function* () {
    const record = yield* reconcile();
    const cache = yield* discovery.cachedStatus();
    const actual = yield* installed.pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    const permissions = development
      ? {
          _tag: "Failure" as const,
          failure: new UpdateFailure({
            message:
              "This source checkout updates through Git. Binary updates cannot replace Bun or this checkout.",
          }),
        }
      : yield* writableTarget(identity.target).pipe(Effect.result);
    const notice =
      permissions._tag === "Failure"
        ? `${permissions.failure.message}${development ? "" : ` The current user cannot update ${identity.target}. Ask its owner to install the update or use a user-owned installation. Framio will not request elevation.`}`
        : null;
    return {
      ...record,
      error: record.error ?? cache?.error ?? null,
      runningVersion: version,
      installedVersion: actual,
      canInstall: !notice,
      installationNotice: notice,
      restartNeeded: !!actual && actual !== version,
      restartPhase: "idle",
      restartError: null,
    } satisfies UpdateStatus;
  });
  const download = Effect.fn("Updater.download")(function* () {
    if (development)
      return yield* new UpdateFailure({
        message: "Source installations update through Git.",
      });
    yield* store.lock(
      key,
      Effect.gen(function* () {
        const current = yield* read;
        if (current.phase === "ready") return;
        if (
          !current.release ||
          !["available", "download-failed"].includes(current.phase)
        )
          return yield* new UpdateFailure({
            message: "Check for an update before downloading.",
          });
        const selected = current.release;
        const downloading: UpdateRecord = {
          ...current,
          phase: "downloading",
          bytes: 0,
          total: selected.assetSize,
          error: null,
          stagedHash: null,
          operation: "download",
        };
        yield* write(downloading);
        yield* stageRelease(selected, files, (bytes) =>
          write({ ...downloading, bytes }),
        ).pipe(
          Effect.flatMap((hash) =>
            write({
              ...downloading,
              phase: "ready",
              bytes: selected.assetSize,
              stagedHash: hash,
              operation: null,
            }),
          ),
          Effect.catch((error) =>
            write({
              ...downloading,
              phase: "download-failed",
              error: error.message,
              operation: null,
            }).pipe(Effect.andThen(Effect.fail(error))),
          ),
        );
      }),
    );
  });
  const install = Effect.fn("Updater.install")(function* (rollback = false) {
    if (development)
      return yield* new UpdateFailure({
        message: "Source installations update through Git.",
      });
    yield* store.lock(
      key,
      Effect.gen(function* () {
        const current = yield* read;
        const mode = yield* writableTarget(identity.target).pipe(
          Effect.mapError(
            (error) =>
              new UpdateFailure({
                message: `${error.message}. Ask the owner of ${identity.target} to update it, or use a user-owned installation. Framio will not request elevation.`,
              }),
          ),
        );
        if (
          !rollback &&
          (!current.stagedHash ||
            !current.release ||
            !["ready", "install-failed"].includes(current.phase))
        )
          return yield* new UpdateFailure({
            message:
              "No verified download is ready. Run framio update --download first.",
          });
        const source = rollback ? backup : staged;
        const expected = rollback
          ? current.previousVersion
          : current.release!.version;
        if (!expected)
          return yield* new UpdateFailure({
            message: "No previous executable is retained for rollback.",
          });
        yield* Effect.gen(function* () {
          if (!rollback && (yield* hashFile(source)) !== current.stagedHash)
            return yield* new UpdateFailure({
              message:
                "The staged executable changed. Retry download to verify the release again.",
            });
          if ((yield* executableVersion(source)) !== expected)
            return yield* new UpdateFailure({
              message:
                "Replacement executable version does not match its recorded version.",
            });
        }).pipe(
          Effect.catch((error) =>
            rollback
              ? Effect.fail(error)
              : write({
                  ...current,
                  phase: "download-failed",
                  stagedHash: null,
                  operation: null,
                  error: error.message,
                }).pipe(Effect.andThen(Effect.fail(error))),
          ),
        );
        const old = yield* installed.pipe(
          Effect.catch((error) =>
            rollback || current.previousVersion
              ? Effect.succeed(null)
              : Effect.fail(error),
          ),
        );
        if (old === expected) {
          yield* write({
            ...current,
            phase: "idle",
            error: null,
            operation: null,
          });
          return;
        }
        if (!rollback && old) yield* backupExecutable(identity.target, backup);
        const installing: UpdateRecord = {
          ...current,
          phase: "installing",
          previousVersion: rollback
            ? current.previousVersion
            : (old ?? current.previousVersion),
          error: null,
          operation: rollback ? "rollback" : "install",
        };
        yield* write(installing);
        yield* Effect.uninterruptible(
          replaceExecutable(source, identity.target, mode).pipe(
            Effect.andThen(executableVersion(identity.target)),
            Effect.flatMap((actual) =>
              actual !== expected
                ? Effect.fail(
                    new UpdateFailure({
                      message:
                        "Installed executable failed version verification. Roll back to recover.",
                    }),
                  )
                : write({ ...installing, phase: "idle", operation: null }),
            ),
            Effect.catch((error) =>
              write({
                ...installing,
                phase: "install-failed",
                operation: null,
                error: error.message,
              }).pipe(Effect.andThen(Effect.fail(error))),
            ),
          ),
        );
      }),
    );
  });
  if (options.background)
    yield* check().pipe(
      Effect.tap(() =>
        process.stdout.isTTY
          ? read.pipe(
              Effect.flatMap((state) =>
                state.release &&
                ["available", "ready", "download-failed"].includes(state.phase)
                  ? Console.log(
                      `Framio ${state.release.version}: ${state.phase === "ready" ? "ready to install" : "update available"}. Run framio update.`,
                    )
                  : Effect.void,
              ),
            )
          : Effect.void,
      ),
      Effect.catch(() => Effect.void),
      Effect.repeat(Schedule.spaced(CHECK_INTERVAL_MS)),
      Effect.forkScoped,
    );
  return {
    status,
    check,
    download: () =>
      download().pipe(
        Effect.onExit((exit) =>
          recordIfAvailable("update result", {
            action: "download",
            outcome: exit._tag === "Success" ? "success" : "failure",
          }),
        ),
      ),
    install: (rollback = false) =>
      install(rollback).pipe(
        Effect.onExit((exit) =>
          recordIfAvailable("update result", {
            action: rollback ? "rollback" : "install",
            outcome: exit._tag === "Success" ? "success" : "failure",
          }),
        ),
      ),
    target: identity.target,
    backup,
    store,
    key,
  };
});
export type Updater = Effect.Success<ReturnType<typeof makeUpdater>>;
