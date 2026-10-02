import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { createInterface } from "node:readline/promises";
import { makeUpdater } from "../services/update/updater";
import { ServerRegistry } from "../services/server-registry";
import { UpdateFailure } from "../contracts/update";
export const upgrade = Effect.fn("upgrade")(function* (flags: {
  check: boolean;
  download: boolean;
  install: boolean;
  rollback: boolean;
}) {
  if (Object.values(flags).filter(Boolean).length > 1)
    return yield* new UpdateFailure({
      message: "Choose one upgrade action at a time.",
    });
  const updater = yield* makeUpdater();
  if (flags.check) yield* updater.check(true);
  if (flags.download) {
    yield* updater.check();
    yield* updater.download();
  }
  if (flags.install || flags.rollback) yield* updater.install(flags.rollback);
  const state = yield* updater.status();
  yield* Console.log(
    `Running ${state.runningVersion}. Installed ${state.installedVersion ?? "from source"}.`,
  );
  if (state.release)
    yield* Console.log(
      `${state.phase}: Framio ${state.release.version}. ${state.release.description}\n${state.release.notesUrl}`,
    );
  if (state.phase === "downloading")
    yield* Console.log(
      `Downloaded ${state.bytes}${state.total ? ` of ${state.total}` : ""} bytes.`,
    );
  if (state.error) yield* Console.log(state.error);
  if (state.installationNotice) yield* Console.log(state.installationNotice);
  const next =
    state.phase === "ready"
      ? "install"
      : ["available", "download-failed"].includes(state.phase)
        ? "download"
        : "check";
  if (
    !Object.values(flags).some(Boolean) &&
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    state.canInstall
  ) {
    const answer = yield* Effect.acquireUseRelease(
      Effect.sync(() =>
        createInterface({ input: process.stdin, output: process.stdout }),
      ),
      (input) =>
        Effect.tryPromise({
          try: () =>
            input.question(
              `${next === "install" ? "Install the verified update? Running projects will keep their current version." : next === "download" ? "Download and verify this release? Install it later." : "Check for an update?"} [y/N] `,
            ),
          catch: (cause) => new UpdateFailure({ message: String(cause) }),
        }),
      (input) => Effect.sync(() => input.close()),
    );
    if (/^y(es)?$/i.test(answer.trim())) {
      if (next === "check") yield* updater.check(true);
      else if (next === "download") yield* updater.download();
      else yield* updater.install();
      yield* Console.log(`Update state: ${(yield* updater.status()).phase}.`);
    }
  } else yield* Console.log(`Next action: framio upgrade --${next}`);
  if (flags.install || flags.rollback || next === "install") {
    const sessions = yield* (yield* ServerRegistry).list;
    const installed = (yield* updater.status()).installedVersion;
    for (const session of sessions.filter(
      (session) =>
        session.installationId === updater.key && session.version !== installed,
    ))
      yield* Console.log(
        `Restart needed: ${session.root} (${session.url}). Save work, then framio stop and framio start in that project.`,
      );
  }
});
