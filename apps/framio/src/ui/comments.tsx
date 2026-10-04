import { projectSession } from "./project-session";
import { reportError, track } from "./services/analytics";
import { Kbd } from "./components/ui/kbd";
import { Avatar, AvatarFallback } from "./components/ui/avatar";
import { Badge } from "./components/ui/badge";
import { Card } from "./components/ui/card";
import { Textarea } from "./components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
} from "./components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
} from "./components/ui/sidebar";
import {
  X,
  MessageCircle,
  ChevronDown,
  Check,
  FileCode2,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "./components/ui/button";
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
  onComment,
}: {
  frame: SnapshotFrame;
  comments: readonly Comment[];
  showResolved: boolean;
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
          <Button
            variant="ghost"
            key={pin.id}
            type="button"
            data-ui
            data-comment-pin={pin.id}
            aria-label={`Comment ${comments.indexOf(pin) + 1}: ${pin.body}`}
            onClick={() => onComment(pin.id)}
            className={`nodrag nopan pointer-events-auto absolute flex size-7 items-center justify-center rounded-full border-2 border-frame-surface text-xs font-semibold shadow-md ${pin.status === "open" ? "bg-primary text-primary-foreground" : "bg-faint text-primary-foreground"}`}
            style={{
              left: at.x,
              top: at.y,
              transform: `translate(-50%, -50%) scale(calc(1 / var(--zoom, 1)))`,
            }}
          >
            {comments.indexOf(pin) + 1}
          </Button>
        );
      })}
    </div>
  );
}

export type CommentDraft = { frame: string; anchor: typeof CommentAnchor.Type };
export function CommentsPanel({
  comments,
  frames,
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
  frames: readonly SnapshotFrame[];
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
  const visible = comments.filter((comment) =>
    showResolved ? comment.status === "resolved" : comment.status === "open",
  );
  const current = draft
    ? undefined
    : (visible.find((comment) => comment.id === active) ?? visible[0]);
  const draftKey = draft
    ? `comment-body:${draft.frame}`
    : `reply-body:${current?.id ?? ""}`;
  const [body, setBody] = useState(
    () => projectSession.getItem(draftKey) ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    setBody(projectSession.getItem(draftKey) ?? "");
    setSaveError(null);
  }, [draftKey]);
  const send = async (
    operation: import("../contracts/comments").CommentOperation,
  ) => {
    setBusy(true);
    try {
      const result = await save(operation);
      if (result.ok) {
        track("comment saved", {
          operation: operation.type,
          ...(operation.type === "status" ? { status: operation.status } : {}),
        });
        projectSession.removeItem(draftKey);
        setBody("");
        onSaved();
        if (operation.type === "status" && operation.status === "open")
          onResolved(false);
      } else {
        reportError("comment_save", { operation: operation.type });
        setSaveError(result.error ?? "Could not save comment");
      }
    } catch {
      reportError("comment_save", { operation: operation.type });
      setSaveError("Could not save comment. Try again.");
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
  const composer = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="mt-3"
    >
      <Textarea
        autoFocus={!!draft}
        aria-label={draft ? "New comment" : "Reply"}
        placeholder={draft ? "Leave feedback…" : "Reply to this thread..."}
        value={body}
        onChange={(event) => {
          projectSession.setItem(draftKey, event.target.value);
          setBody(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            projectSession.removeItem(draftKey);
            setBody("");
            onSaved();
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        className="min-h-8 resize-y rounded-md border bg-sidebar px-2.5 py-2 text-xs shadow-none"
      />
      {body.trim() && (
        <Button
          type="submit"
          size="xs"
          className="mt-2"
          disabled={busy || !!error}
        >
          {busy ? "Saving…" : draft ? "Post comment" : "Reply"}
        </Button>
      )}
    </form>
  );
  return (
    <Sidebar
      collapsible="none"
      side="right"
      data-ui
      aria-label="Comments"
      className="absolute inset-y-0 right-0 z-30 h-full! w-[296px]! border-l bg-sidebar text-foreground"
    >
      <SidebarHeader className="h-14 flex-row items-center justify-between border-b px-4">
        <h2 className="font-medium">
          Comments{" "}
          <span className="ml-1 font-mono text-[11px] text-muted-foreground">
            {visible.length}
          </span>
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close comments"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </SidebarHeader>
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4 text-xs">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                aria-label="Comment filter"
                className="h-auto gap-1.5 p-0 text-xs font-normal"
              />
            }
          >
            {showResolved ? "Resolved comments" : "Open comments"}
            <ChevronDown className="size-3 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup
              value={showResolved ? "resolved" : "open"}
              onValueChange={(value) => onResolved(value === "resolved")}
            >
              <DropdownMenuRadioItem value="open" aria-label="Open comments">
                Open comments
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="resolved"
                aria-label="Resolved comments"
              >
                Resolved comments
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-muted-foreground">This page</span>
      </div>
      <SidebarContent className="gap-3 p-3">
        {(error || saveError) && (
          <p role="alert" className="text-xs text-destructive">
            {error || saveError}
          </p>
        )}
        {draft && (
          <Card className="gap-0 rounded-lg border border-signal/35 bg-card p-3">
            <div className="flex items-center gap-2 text-[11px]">
              <MessageCircle className="size-3.5 text-signal" />
              <span>New comment</span>
              <span className="ml-auto truncate text-muted-foreground">
                {frames.find((frame) => frame.id === draft.frame)?.meta.name ??
                  draft.frame.split("/").pop()}
              </span>
            </div>
            {composer}
          </Card>
        )}
        {visible.map((comment) => {
          const expanded = comment.id === current?.id;
          const name =
            frames.find((frame) => frame.id === comment.frame)?.meta.name ??
            comment.frame.split("/").pop();
          return expanded ? (
            <Card
              key={comment.id}
              className="gap-0 rounded-lg border border-signal/35 bg-card p-3"
            >
              <div className="mb-3 flex items-center justify-between text-[11px]">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge className="size-5 shrink-0 justify-center rounded-full border-0 p-0">
                    {comments.indexOf(comment) + 1}
                  </Badge>
                  <span className="truncate">{name}</span>
                  <span className="font-mono text-muted-foreground">
                    {
                      frames.find((frame) => frame.id === comment.frame)?.meta
                        .width
                    }
                  </span>
                </div>
                {comment.status === "resolved" ? (
                  <Check className="size-3.5 text-muted-foreground" />
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Comment actions"
                        />
                      }
                    >
                      <MoreHorizontal className="size-4 text-muted-foreground" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={busy || !!error}
                        onClick={() =>
                          void send({
                            type: "delete",
                            id: comment.id,
                            expected: comment,
                          })
                        }
                      >
                        Delete comment
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <CommentAuthor
                author={comment.author}
                createdAt={comment.createdAt}
              />
              <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">
                {comment.body}
              </p>
              {comment.replies.map((reply) => (
                <div
                  key={`${reply.createdAt}/${reply.body}`}
                  className="mt-3 border-t pt-3"
                >
                  <CommentAuthor
                    author={reply.author}
                    createdAt={reply.createdAt}
                  />
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                    {reply.body}
                  </p>
                </div>
              ))}
              <div className="mt-3 flex items-center justify-between border-t pt-3">
                <span className="text-[11px] text-muted-foreground">
                  {comment.status === "resolved"
                    ? "Resolved"
                    : `${comment.replies.length} ${comment.replies.length === 1 ? "reply" : "replies"}`}
                </span>
                <Button
                  variant="secondary"
                  size="xs"
                  disabled={busy || !!error}
                  onClick={() =>
                    void send({
                      type: "status",
                      id: comment.id,
                      expected: comment.status,
                      status: comment.status === "open" ? "resolved" : "open",
                    })
                  }
                >
                  {comment.status === "open" ? "Resolve" : "Reopen"}
                </Button>
              </div>
              {comment.status === "open" && composer}
            </Card>
          ) : (
            <Button
              key={comment.id}
              variant="ghost"
              onClick={() => onSelect(comment.id)}
              className="block h-auto w-full whitespace-normal rounded-lg border border-border p-3 text-left font-normal hover:bg-card"
            >
              <div className="flex items-center gap-2 text-[11px]">
                <span className="flex size-5 items-center justify-center rounded-full border text-muted-foreground">
                  {comments.indexOf(comment) + 1}
                </span>
                <span className="truncate">{name}</span>
                <span className="ml-auto text-muted-foreground">
                  {commentAge(comment.createdAt)}
                </span>
              </div>
              <p className="mt-3 line-clamp-3 break-words text-xs leading-5 text-muted-foreground">
                {comment.body}
              </p>
              <span className="mt-2 block text-[11px] text-muted-foreground">
                {comment.replies.length
                  ? `${comment.replies.length} replies`
                  : "No replies yet"}
              </span>
            </Button>
          );
        })}
        {!visible.length && !draft && (
          <div className="py-6 text-center text-xs leading-5 text-muted-foreground">
            <MessageCircle className="mx-auto mb-3 size-5 text-faint" />
            {showResolved
              ? "No resolved comments yet."
              : "No open comments. Press C and click a frame to leave feedback."}
          </div>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t p-4 text-[11px] leading-5 text-muted-foreground">
        <span className="mb-1 flex items-center gap-2">
          <MessageCircle className="size-3.5" />
          Pin feedback to a frame or element
        </span>
        <span>
          Press <Kbd>C</Kbd> and click on the canvas.
        </span>
      </SidebarFooter>
    </Sidebar>
  );
}

function commentAge(createdAt: string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000),
  );
  return seconds < 60
    ? "now"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h`
        : `${Math.floor(seconds / 86400)}d`;
}
function CommentAuthor({
  author,
  createdAt,
}: {
  author: string;
  createdAt: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Avatar className="size-6">
        <AvatarFallback
          className={
            author === "agent"
              ? "bg-primary/15 text-signal"
              : "bg-accent text-[10px]"
          }
        >
          {author === "agent" ? <FileCode2 className="size-3" /> : "U"}
        </AvatarFallback>
      </Avatar>
      <span className="text-xs font-medium">
        {author === "agent" ? "Agent" : "You"}
      </span>
      <span
        className="ml-auto text-[11px] text-muted-foreground"
        title={createdAt}
      >
        {commentAge(createdAt)}
      </span>
    </div>
  );
}
