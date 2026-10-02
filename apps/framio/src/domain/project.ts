import * as Schema from "effect/Schema";

export const PositiveNumber = Schema.Finite.pipe(
  Schema.check(Schema.isGreaterThan(0)),
);
export const ViewportDimension = PositiveNumber.pipe(
  Schema.check(Schema.isInt()),
);
export const Widths = Schema.Array(ViewportDimension).pipe(
  Schema.check(Schema.isMinLength(1), Schema.isUnique()),
);
export const Position = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });
export const Positions = Schema.Record(Schema.String, Position);
const ResponsiveHeights = Schema.makeFilter(
  (value: {
    readonly widths?: readonly number[];
    readonly heights?: readonly number[];
  }) =>
    !value.heights ||
    (!!value.widths && value.heights.length === value.widths.length),
  { message: "meta.heights must have the same length as meta.widths" },
);
export const FrameMeta = Schema.Struct({
  name: Schema.String,
  width: PositiveNumber,
  height: PositiveNumber,
  widths: Schema.optional(Widths),
  heights: Schema.optional(Schema.Array(ViewportDimension)),
  variationOf: Schema.optional(Schema.String),
  theme: Schema.optional(Schema.Literals(["light", "dark"])),
}).pipe(Schema.check(ResponsiveHeights));
export type FrameMeta = typeof FrameMeta.Type;
export const FrameMetaInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  height: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  widths: Schema.optional(Widths),
  heights: Schema.optional(Schema.Array(ViewportDimension)),
  variationOf: Schema.optional(Schema.String),
  theme: Schema.optional(Schema.Literals(["light", "dark"])),
}).pipe(Schema.check(ResponsiveHeights));

export const ImageSidecar = Schema.Struct({
  name: Schema.optional(Schema.String),
  width: Schema.optional(PositiveNumber),
  note: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  variationOf: Schema.optional(Schema.String),
});

export const Frame = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["tsx", "image"]),
  page: Schema.String,
  slug: Schema.String,
  note: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  file: Schema.String,
  relFile: Schema.String,
  meta: FrameMeta,
  parent: Schema.NullOr(Schema.String),
  metaError: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  imageContent: Schema.optional(Schema.Uint8Array),
});
export type Frame = typeof Frame.Type;
export const Page = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  frames: Schema.Array(Frame),
  positions: Positions,
});
export type Page = typeof Page.Type;
export const CanvasFile = Schema.StructWithRest(
  Schema.Struct({ positions: Schema.optional(Positions) }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "svg"];
