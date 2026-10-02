import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ScreenshotRequest } from "../contracts/requests";
import { InvalidInput } from "./errors";

const HttpUrl = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) => {
        try {
          return ["http:", "https:"].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      },
      { message: "Expected an absolute http:// or https:// URL" },
    ),
  ),
);
export const validateScreenshot = Effect.fn("validateScreenshot")(function* (
  input: typeof ScreenshotRequest.Type,
  all = false,
) {
  const request = yield* Schema.decodeUnknownEffect(ScreenshotRequest)(
    input,
  ).pipe(
    Effect.mapError((error) => new InvalidInput({ message: error.message })),
  );
  if (
    request.layers?.length &&
    (request.url !== undefined || request.page || all)
  )
    return yield* new InvalidInput({
      message:
        "--layer requires frame arguments and cannot be combined with --url, --page, or --all",
    });
  if (request.url !== undefined) {
    yield* Schema.decodeUnknownEffect(HttpUrl)(request.url).pipe(
      Effect.mapError((error) => new InvalidInput({ message: error.message })),
    );
    if (request.frames?.length || request.page || all)
      return yield* new InvalidInput({
        message:
          "--url cannot be combined with frame arguments, --page, or --all",
      });
  } else {
    if (
      request.compare ||
      request.into ||
      request.height ||
      request.viewportOnly !== undefined
    )
      return yield* new InvalidInput({
        message: "--compare, --into, --height, and viewportOnly require --url",
      });
    if (!request.frames?.length && !request.page && !all)
      return yield* new InvalidInput({
        message:
          "Usage: framio screenshot <frame>... [--width <n>] | --page <page> | --all | --url <url> [--compare <page/frame>] [--into <page>]",
      });
  }
  if (request.into !== undefined)
    yield* Schema.decodeUnknownEffect(
      Schema.String.pipe(Schema.check(Schema.isPattern(/^[^./\\][^/\\]*$/))),
    )(request.into).pipe(
      Effect.mapError(
        () =>
          new InvalidInput({ message: "--into must be a page folder name" }),
      ),
    );
  return request;
});
