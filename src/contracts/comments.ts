import * as Schema from "effect/Schema";
const rest = [Schema.Record(Schema.String, Schema.Unknown)] as const;
export const Author = Schema.Literals(["user", "agent"]);
const Body = Schema.String.pipe(Schema.check(Schema.isPattern(/\S/)));
const Timestamp = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => Number.isFinite(Date.parse(value)), {
      message: "Expected an ISO timestamp",
    }),
  ),
);
export const CommentAnchor = Schema.StructWithRest(
  Schema.Struct({
    selector: Schema.optional(Schema.NonEmptyString),
    x: Schema.Finite,
    y: Schema.Finite,
  }),
  rest,
);
export const Reply = Schema.StructWithRest(
  Schema.Struct({ author: Author, body: Body, createdAt: Timestamp }),
  rest,
);
export const Comment = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.NonEmptyString,
    frame: Schema.NonEmptyString,
    anchor: CommentAnchor,
    body: Body,
    author: Author,
    status: Schema.Literals(["open", "resolved"]),
    createdAt: Timestamp,
    replies: Schema.Array(Reply),
  }),
  rest,
);
export type Comment = typeof Comment.Type;
export const CommentsFile = Schema.StructWithRest(
  Schema.Struct({
    comments: Schema.Array(Comment).pipe(
      Schema.check(
        Schema.makeFilter(
          (comments) =>
            new Set(comments.map((c) => c.id)).size === comments.length,
          { message: "Comment IDs must be unique" },
        ),
      ),
    ),
  }),
  rest,
);
export type CommentsFile = typeof CommentsFile.Type;
export const CommentOperation = Schema.Union([
  Schema.Struct({ type: Schema.Literal("create"), comment: Comment }),
  Schema.Struct({
    type: Schema.Literal("reply"),
    id: Schema.String,
    reply: Reply,
  }),
  Schema.Struct({
    type: Schema.Literal("status"),
    id: Schema.String,
    status: Schema.Literals(["open", "resolved"]),
    expected: Schema.Literals(["open", "resolved"]),
  }),
  Schema.Struct({
    type: Schema.Literal("delete"),
    id: Schema.String,
    expected: Comment,
  }),
]);
export type CommentOperation = typeof CommentOperation.Type;
export const CommentResponse = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
});
