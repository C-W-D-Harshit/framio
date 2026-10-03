import * as Effect from "effect/Effect";
import { UpdateFailure, type UpdateStatus } from "../../contracts/update";
import type { TerminalTasks } from "../terminal-ui";
import type { Updater } from "./updater";

export const updateToLatest = Effect.fn("UpdateWorkflow.latest")(function* (
  updater: Pick<Updater, "check" | "download" | "install"> & {
    readonly status: () => Effect.Effect<UpdateStatus, UpdateFailure>;
  },
  tasks: TerminalTasks = { run: (_label, work) => work },
) {
  const before = yield* updater.status();
  const requireAvailableInstallation = (state: UpdateStatus) =>
    !state.canInstall
      ? Effect.fail(
          new UpdateFailure({
            message:
              state.installationNotice ??
              "This installation cannot be updated.",
          }),
        )
      : state.phase === "downloading" || state.phase === "installing"
        ? Effect.fail(
            new UpdateFailure({
              message:
                "Another update is in progress. Run framio update --status to check progress, then retry.",
            }),
          )
        : Effect.void;
  yield* requireAvailableInstallation(before);
  let state = before;
  // A verified staged update can finish even when release discovery is offline.
  if (state.phase !== "ready" && state.phase !== "install-failed") {
    yield* tasks.run("Checking for updates", updater.check(true));
    state = yield* updater.status();
    yield* requireAvailableInstallation(state);
    if (state.phase === "available" || state.phase === "download-failed") {
      yield* tasks.run("Downloading and verifying update", updater.download());
      state = yield* updater.status();
    }
  }
  if (state.phase === "ready" || state.phase === "install-failed") {
    yield* tasks.run("Installing update", updater.install());
    return { before, after: yield* updater.status(), installed: true };
  }
  yield* requireAvailableInstallation(state);
  if (state.phase !== "idle")
    return yield* new UpdateFailure({
      message:
        state.error ??
        "The update did not complete. Run framio update --status, then retry.",
    });
  return { before, after: state, installed: false };
});
