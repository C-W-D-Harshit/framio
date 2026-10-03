import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { makeUpdater } from "../services/update/updater";
import { updateToLatest } from "../services/update/workflow";
import { TerminalUI } from "../services/terminal-ui";
import { ServerRegistry } from "../services/server-registry";
import { UpdateFailure } from "../contracts/update";

export const update = Effect.fn("update")(function* (flags: {
  check: boolean;
  download: boolean;
  install: boolean;
  rollback: boolean;
  status: boolean;
}) {
  if (Object.values(flags).filter(Boolean).length > 1)
    return yield* new UpdateFailure({
      message: "Choose one update action at a time.",
    });
  const updater = yield* makeUpdater();
  let installed = flags.install || flags.rollback;
  if (!Object.values(flags).some(Boolean)) {
    const ui = yield* TerminalUI;
    const result = yield* ui.tasks((tasks) => updateToLatest(updater, tasks));
    installed = result.installed;
    yield* ui.message(
      "success",
      result.installed
        ? `Installed Framio ${result.after.installedVersion}.`
        : `Framio ${result.after.installedVersion} is up to date.`,
    );
  } else {
    if (flags.check) yield* updater.check(true);
    if (flags.download) {
      yield* updater.check(true);
      const state = yield* updater.status();
      if (
        state.phase === "available" ||
        state.phase === "download-failed" ||
        state.phase === "ready"
      )
        yield* updater.download();
    }
    if (installed) yield* updater.install(flags.rollback);
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
      state.phase === "ready" || state.phase === "install-failed"
        ? "install"
        : ["available", "download-failed"].includes(state.phase)
          ? "download"
          : "check";
    yield* Console.log(`Next action: framio update --${next}`);
  }
  if (installed) {
    const sessions = yield* (yield* ServerRegistry).list;
    const version = (yield* updater.status()).installedVersion;
    for (const session of sessions.filter(
      (session) =>
        session.installationId === updater.key && session.version !== version,
    ))
      yield* Console.log(
        `Restart needed: ${session.root} (${session.url}). Save work, then framio stop and framio start in that project.`,
      );
  }
});
