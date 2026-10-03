import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  emptyUpdate,
  UpdateFailure,
  type UpdateStatus,
} from "../../src/contracts/update";
import { updateToLatest } from "../../src/services/update/workflow";

function fixture(phase: UpdateStatus["phase"] = "idle", failure?: string) {
  let state: UpdateStatus = {
    ...emptyUpdate,
    phase,
    runningVersion: "1.0.0",
    installedVersion: "1.0.0",
    canInstall: true,
    installationNotice: null,
    restartNeeded: false,
    restartPhase: "idle",
    restartError: null,
  };
  const calls: string[] = [];
  const operation = (name: string, next: Partial<UpdateStatus>) =>
    Effect.gen(function* () {
      calls.push(name);
      if (failure === name)
        return yield* new UpdateFailure({ message: `${name} failed` });
      state = { ...state, ...next };
    });
  return {
    calls,
    set: (next: Partial<UpdateStatus>) => {
      state = { ...state, ...next };
    },
    updater: {
      status: () => Effect.sync(() => ({ ...state })),
      check: (force = false) => {
        assert.isTrue(force);
        return operation("check", {
          phase: failure === "latest" ? "idle" : "available",
        });
      },
      download: () => operation("download", { phase: "ready" }),
      install: () =>
        operation("install", {
          phase: "idle",
          installedVersion: "2.0.0",
          restartNeeded: true,
        }),
    },
  };
}

describe("one-command update", () => {
  it.effect(
    "checks, downloads and installs in order and reports the installed version",
    () =>
      Effect.gen(function* () {
        const f = fixture();
        const result = yield* updateToLatest(f.updater);
        assert.deepEqual(f.calls, ["check", "download", "install"]);
        assert.isTrue(result.installed);
        assert.strictEqual(result.before.installedVersion, "1.0.0");
        assert.strictEqual(result.after.installedVersion, "2.0.0");
      }),
  );
  it.effect(
    "does not download or install when fresh discovery finds no update",
    () =>
      Effect.gen(function* () {
        const f = fixture("idle", "latest");
        assert.isFalse((yield* updateToLatest(f.updater)).installed);
        assert.deepEqual(f.calls, ["check"]);
      }),
  );
  for (const phase of ["ready", "install-failed"] as const) {
    it.effect(
      `resumes ${phase} without network discovery or another download`,
      () =>
        Effect.gen(function* () {
          const f = fixture(phase, "check");
          assert.isTrue((yield* updateToLatest(f.updater)).installed);
          assert.deepEqual(f.calls, ["install"]);
        }),
    );
  }
  for (const phase of ["available", "download-failed"] as const) {
    it.effect(`refreshes discovery before resuming ${phase}`, () =>
      Effect.gen(function* () {
        const f = fixture(phase);
        yield* updateToLatest(f.updater);
        assert.deepEqual(f.calls, ["check", "download", "install"]);
      }),
    );
  }
  for (const failure of ["check", "download", "install"] as const) {
    it.effect(`propagates ${failure} failure and never runs later phases`, () =>
      Effect.gen(function* () {
        const f = fixture("idle", failure);
        const result = yield* updateToLatest(f.updater).pipe(Effect.result);
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure")
          assert.strictEqual(result.failure.message, `${failure} failed`);
        assert.deepEqual(
          f.calls,
          ["check", "download", "install"].slice(
            0,
            ["check", "download", "install"].indexOf(failure) + 1,
          ),
        );
      }),
    );
  }
  for (const phase of ["downloading", "installing"] as const) {
    it.effect(`refuses an active ${phase} operation`, () =>
      Effect.gen(function* () {
        const f = fixture(phase);
        const result = yield* updateToLatest(f.updater).pipe(Effect.result);
        assert.strictEqual(result._tag, "Failure");
        assert.deepEqual(f.calls, []);
      }),
    );
  }
  it.effect(
    "refuses source and unwritable installations before discovery",
    () =>
      Effect.gen(function* () {
        const f = fixture();
        f.set({
          canInstall: false,
          installationNotice: "Source checkout updates through Git.",
        });
        const result = yield* updateToLatest(f.updater).pipe(Effect.result);
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure")
          assert.strictEqual(
            result.failure.message,
            "Source checkout updates through Git.",
          );
        assert.deepEqual(f.calls, []);
      }),
  );
});
