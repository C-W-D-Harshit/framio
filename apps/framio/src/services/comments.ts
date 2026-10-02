import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { CommentsFile, type CommentOperation } from "../contracts/comments";
import { InvalidInput } from "../domain/errors";

export const readComments = (text: string | null) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(CommentsFile))(
    text ?? '{"comments":[]}',
  ).pipe(
    Effect.mapError(
      (error) =>
        new InvalidInput({
          message: `comments.json: ${error.message}. Fix the file before saving comments; its contents have been preserved.`,
        }),
    ),
  );
export const mergeComment = Effect.fn("Comments.merge")(function* (
  file: CommentsFile,
  operation: CommentOperation,
) {
  const comments = [...file.comments];
  const index =
    operation.type === "create"
      ? comments.findIndex((c) => c.id === operation.comment.id)
      : comments.findIndex((c) => c.id === operation.id);
  if (operation.type === "create") {
    if (index >= 0) {
      if (JSON.stringify(comments[index]) === JSON.stringify(operation.comment))
        return file;
      return yield* new InvalidInput({
        message: "Comment ID already exists. Refresh and try again.",
      });
    }
    comments.push(operation.comment);
  } else {
    if (index < 0)
      return yield* new InvalidInput({
        message:
          "This comment was deleted. Refresh to see the latest comments.",
      });
    const comment = comments[index]!;
    if (operation.type === "reply") {
      if (
        !comment.replies.some(
          (reply) => JSON.stringify(reply) === JSON.stringify(operation.reply),
        )
      )
        comments[index] = {
          ...comment,
          replies: [...comment.replies, operation.reply],
        };
    } else if (operation.type === "status") {
      if (
        comment.status !== operation.expected &&
        comment.status !== operation.status
      )
        return yield* new InvalidInput({
          message: "The comment status changed. Refresh and try again.",
        });
      comments[index] = { ...comment, status: operation.status };
    } else {
      if (JSON.stringify(comment) !== JSON.stringify(operation.expected))
        return yield* new InvalidInput({
          message:
            "This comment changed since you opened it. Refresh before deleting.",
        });
      comments.splice(index, 1);
    }
  }
  return { ...file, comments };
});
/** Operation-based writes retry if an external editor changed the file during persistence. */
export const makeComments = <E>(adapter: {
  read: Effect.Effect<string | null, E>;
  commit: (expected: string | null, next: string) => Effect.Effect<boolean, E>;
}) =>
  Effect.gen(function* () {
    const mutex = yield* Semaphore.make(1);
    const apply = Effect.fn("Comments.apply")(function* (
      operation: CommentOperation,
    ) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const previous = yield* adapter.read;
        const current = yield* readComments(previous);
        const next = yield* mergeComment(current, operation);
        if (
          yield* adapter.commit(previous, JSON.stringify(next, null, 2) + "\n")
        )
          return;
      }
      return yield* new InvalidInput({
        message:
          "comments.json keeps changing. Your comment was not saved; try again.",
      });
    }, mutex.withPermit);
    return { apply };
  });
