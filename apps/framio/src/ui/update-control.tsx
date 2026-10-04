import { useEffect, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { ArrowDownToLine, RotateCw, LoaderCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import { Button } from "./components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { updateActionAtom, updateAtom } from "./state";
import { reportError, track } from "./services/analytics";
import type { UpdateAction, UpdateStatus } from "../contracts/update";
export function updatePresentation(state: UpdateStatus) {
  if (state.restartPhase === "restarting")
    return { label: "Reconnecting…", action: null };
  if (state.phase === "installing")
    return { label: "Installing…", action: null };
  if (state.restartPhase === "failed" || state.restartPhase === "recovered")
    return { label: "Retry restart", action: "restart" as const };
  if (state.restartNeeded && state.phase !== "ready")
    return { label: "Restart to update", action: "restart" as const };
  if (state.phase === "downloading")
    return { label: "Downloading…", action: null };
  if (state.phase === "ready")
    return { label: "Install update", action: "install" as const };
  if (state.phase === "install-failed")
    return { label: "Retry installation", action: "install" as const };
  if (state.phase === "download-failed")
    return { label: "Retry download", action: "download" as const };
  if (state.phase === "available")
    return { label: "Update available", action: "download" as const };
  return { label: "Check for updates", action: "check" as const };
}
export function UpdateControl() {
  const result = useAtomValue(updateAtom);
  const invoke = useAtomSet(updateActionAtom, { mode: "promise" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stateError = AsyncResult.isSuccess(result) ? result.value?.error : null;
  useEffect(() => {
    if (stateError) reportError("update_state");
  }, [stateError]);
  if (!AsyncResult.isSuccess(result) || !result.value) return null;
  const state = result.value;
  const presentation = updatePresentation(state);
  const { action } = presentation;
  const release = state.release;
  const perform = async (next: (typeof UpdateAction.Type)["action"]) => {
    if (busy) return;
    setError(null);
    setBusy(next);
    track("update action", {
      action: next,
      to: state.release?.version ?? null,
    });
    try {
      await invoke(next);
    } catch (cause) {
      reportError("update_action", { action: next });
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };
  const restarting = busy === "install" || busy === "restart";
  const loading = !!busy || !action;
  const description =
    action === "check"
      ? "Check GitHub for the latest Framio release."
      : (release?.description ??
        "Restart this project to run the installed version of Framio.");
  const version =
    state.phase === "ready" || state.phase === "downloading"
      ? release?.version
      : state.restartNeeded
        ? state.installedVersion
        : action === "check"
          ? state.runningVersion
          : release?.version;
  return (
    <div className="space-y-2 text-xs" aria-busy={loading}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              className="h-auto min-h-10 w-full justify-start gap-2 px-3 py-2 text-xs"
              disabled={loading || (action !== "check" && !state.canInstall)}
              aria-describedby="framio-update-description"
              onClick={() => action && void perform(action)}
            />
          }
        >
          {loading ? (
            <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
          ) : action === "download" ? (
            <ArrowDownToLine className="size-3.5" />
          ) : (
            <RotateCw className="size-3.5" />
          )}
          <span>
            {busy === "check"
              ? "Checking…"
              : busy === "install" && !state.restartNeeded
                ? "Installing…"
                : restarting
                  ? "Reconnecting…"
                  : presentation.label}
          </span>
          {version && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {version}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent
          side="right"
          className="max-w-64 flex-col items-start motion-reduce:animate-none"
        >
          <strong>Framio Alpha {version}</strong>
          <span>{description}</span>
        </TooltipContent>
      </Tooltip>
      <span id="framio-update-description" className="sr-only">
        Framio Alpha {version}. {description}
      </span>
      <span role="status" className="sr-only">
        {restarting ? "Reconnecting to your project" : presentation.label}
      </span>
      {state.phase === "downloading" && (
        <div>
          <progress
            className="h-1 w-full accent-foreground"
            aria-label="Update download"
            {...(state.total && state.total > 0
              ? { value: state.bytes, max: state.total }
              : {})}
          />
          <p className="mt-1 text-muted-foreground tabular-nums">
            {(state.bytes / 1048576).toFixed(1)} MB
            {state.total ? ` of ${(state.total / 1048576).toFixed(1)} MB` : ""}
          </p>
        </div>
      )}
      {(state.phase === "ready" || action === "install") && (
        <p className="text-muted-foreground">
          Ready whenever you are. Installing restarts this project. Other
          projects keep running.
        </p>
      )}
      {action === "restart" && (
        <p className="text-muted-foreground">
          Restarts this project at the same URL.
        </p>
      )}
      {release && (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
            About this update
          </summary>
          <p className="mt-2 break-words">{description}</p>
          <a
            href={release.notesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block underline underline-offset-2"
          >
            Complete release notes
          </a>
        </details>
      )}
      {release?.requiresProjectUpdate && (
        <p className="text-muted-foreground">
          This release requires a separate project update. Read the release
          notes for instructions. Binary installation does not change your
          project.
        </p>
      )}
      {[error, state.error, state.restartError, state.installationNotice]
        .filter(Boolean)
        .map((message) => (
          <p
            key={message}
            role="alert"
            className="break-words text-destructive"
          >
            {message}
          </p>
        ))}
      {state.phase === "install-failed" && state.previousVersion && (
        <Button
          size="xs"
          variant="ghost"
          disabled={!!busy}
          onClick={() => void perform("rollback")}
        >
          Roll back executable
        </Button>
      )}
      <Dialog open={restarting}>
        <DialogContent
          showCloseButton={false}
          className="motion-reduce:animate-none"
        >
          <DialogTitle>
            {busy === "install" && !state.restartNeeded
              ? "Installing update"
              : "Restarting project"}
          </DialogTitle>
          <DialogDescription>
            {busy === "install" && !state.restartNeeded
              ? "Saving work and installing the verified update. This project will restart."
              : "Reconnecting to your project…"}
          </DialogDescription>
        </DialogContent>
      </Dialog>
    </div>
  );
}
