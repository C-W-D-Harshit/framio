import { commentGeometry } from "./services/comment-geometry";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Atom, AsyncResult } from "effect/reactivity";
import type { Comment, CommentAnchor } from "../contracts/comments";
import type { SnapshotFrame } from "../contracts/snapshot";
import { saveCommentAtom } from "./state";

export function CommentPins({
  frame,
  comments,
  showResolved,
  zoom,
  onComment,
}: {
  frame: SnapshotFrame;
  comments: readonly Comment[];
  showResolved: boolean;
  zoom: number;
  onComment(id: string): void;
}) {
  const pins = useMemo(
    () =>
      comments.filter(
        (c) =>
          c.frame === (frame.frameId ?? frame.id) &&
          (showResolved || c.status === "open"),
      ),
    [comments, frame.frameId, frame.id, showResolved],
  );
  const lastPositions = useRef<Record<string, { x: number; y: number }>>({});
  const geometry = useMemo(
    () => Atom.make(commentGeometry(frame.id, pins, lastPositions.current)),
    [frame.id, pins, frame.version],
  );
  const value = useAtomValue(geometry);
  const positions = AsyncResult.isSuccess(value) ? value.value : {};
  return (
    <div
      className="pointer-events-none absolute top-0 left-0"
      style={{ width: frame.meta.width }}
    >
      {pins.map((pin) => {
        const at = positions[pin.id] ?? { x: pin.anchor.x, y: pin.anchor.y };
        return (
          <button
            key={pin.id}
            type="button"
            data-ui
            data-comment-pin={pin.id}
            aria-label={`Comment ${comments.indexOf(pin) + 1}: ${pin.body}`}
            onClick={() => onComment(pin.id)}
            className={`nodrag nopan pointer-events-auto absolute flex size-7 items-center justify-center rounded-full border-2 border-white text-xs font-semibold shadow-md ${pin.status === "open" ? "bg-accent text-white" : "bg-neutral-600 text-white"}`}
            style={{
              left: at.x,
              top: at.y,
              transform: `translate(-50%, -50%) scale(${1 / zoom})`,
            }}
          >
            {comments.indexOf(pin) + 1}
          </button>
        );
      })}
    </div>
  );
}

export type CommentDraft = { frame: string; anchor: typeof CommentAnchor.Type };
export function CommentsPanel({
  comments,
  active,
  draft,
  error,
  showResolved,
  onResolved,
  onSelect,
  onClose,
  onSaved,
}: {
  comments: readonly Comment[];
  active: string | null;
  draft: CommentDraft | null;
  error: string | null;
  showResolved: boolean;
  onResolved(value: boolean): void;
  onSelect(id: string): void;
  onClose(): void;
  onSaved(): void;
}) {
  const save = useAtomSet(saveCommentAtom, { mode: "promise" });
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    setBody("");
    setSaveError(null);
  }, [active, draft]);
  const current = comments.find((c) => c.id === active);
  const send = async (
    operation: import("../contracts/comments").CommentOperation,
  ) => {
    setBusy(true);
    try {
      const result = await save(operation);
      if (result.ok) {
        setBody("");
        onSaved();
      } else setSaveError(result.error ?? "Could not save comment");
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    if (!body.trim() || busy || error) return;
    const createdAt = new Date().toISOString();
    if (draft)
      void send({
        type: "create",
        comment: {
          id: crypto.randomUUID(),
          ...draft,
          body: body.trim(),
          author: "user",
          status: "open",
          createdAt,
          replies: [],
        },
      });
    else if (current)
      void send({
        type: "reply",
        id: current.id,
        reply: { body: body.trim(), author: "user", createdAt },
      });
  };
  return (
    <aside
      data-ui
      aria-label="Comments"
      className="absolute top-3 right-3 bottom-20 z-30 flex w-80 flex-col rounded-xl border border-chrome-line bg-chrome text-neutral-200 shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-chrome-line p-3">
        <h2 className="font-medium">Comments</h2>
        <button
          className="flex size-7 items-center justify-center rounded-md hover:bg-white/5"
          aria-label="Close comments"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <label className="flex items-center gap-2 p-3 text-xs text-neutral-400">
        <input
          type="checkbox"
          checked={showResolved}
          onChange={(e) => onResolved(e.target.checked)}
        />
        Show resolved
      </label>
      <div className="flex-1 overflow-auto px-3 pb-3">
        {(error || saveError) && (
          <p role="alert" className="mb-3 text-xs text-red-300">
            {error || saveError}
          </p>
        )}
        {draft ? (
          <p className="mb-3 text-sm">New comment on {draft.frame}</p>
        ) : current ? (
          <div className="mb-3">
            <button
              className="mb-3 text-xs text-neutral-400"
              onClick={() => onSelect("")}
            >
              ← All comments
            </button>
            <p className="mb-1 text-xs text-neutral-500">
              {current.author} · {current.status}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm">
              {current.body}
            </p>
            {current.replies.map((reply, i) => (
              <div
                key={`${reply.createdAt}-${i}`}
                className="mt-3 border-t border-chrome-line pt-3"
              >
                <p className="text-xs text-neutral-500">{reply.author}</p>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {reply.body}
                </p>
              </div>
            ))}
            <div className="mt-3 flex gap-3 text-xs">
              <button
                disabled={busy || !!error}
                onClick={() =>
                  void send({
                    type: "status",
                    id: current.id,
                    expected: current.status,
                    status: current.status === "open" ? "resolved" : "open",
                  })
                }
              >
                {current.status === "open" ? "Resolve" : "Reopen"}
              </button>
              <button
                disabled={busy || !!error}
                className="text-red-300"
                onClick={() =>
                  void send({
                    type: "delete",
                    id: current.id,
                    expected: current,
                  })
                }
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {comments
              .filter((c) => showResolved || c.status === "open")
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  className="block w-full rounded-lg border border-chrome-line p-3 text-left hover:bg-white/5"
                >
                  <span className="text-xs text-neutral-500">
                    {comments.indexOf(c) + 1} · {c.frame} · {c.status}
                  </span>
                  <p className="mt-1 line-clamp-3 break-words text-sm">
                    {c.body}
                  </p>
                </button>
              ))}
            {!comments.some((c) => showResolved || c.status === "open") && (
              <p className="text-sm text-neutral-500">
                No open comments. Use C and click a frame to leave feedback.
              </p>
            )}
          </div>
        )}
        {(draft || current) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="mt-4"
          >
            <textarea
              autoFocus
              aria-label={draft ? "New comment" : "Reply"}
              placeholder={draft ? "Leave feedback…" : "Reply…"}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  onSaved();
                } else if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              className="min-h-24 w-full resize-y rounded-lg border border-chrome-line bg-black/20 p-2 text-sm outline-none focus:border-accent"
            />
            <button
              disabled={busy || !!error || !body.trim()}
              className="mt-2 rounded-md bg-accent px-3 py-2 text-xs text-white disabled:opacity-50"
              type="submit"
            >
              {busy ? "Saving…" : draft ? "Save comment" : "Reply"}
            </button>
          </form>
        )}
      </div>
    </aside>
  );
}
