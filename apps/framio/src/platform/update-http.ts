import * as Effect from "effect/Effect";
import { UpdateFailure } from "../contracts/update";
export function boundedFetch(
  url: string,
  etag?: string,
  accept = "application/vnd.github+json",
) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        signal,
        headers: {
          Accept: accept,
          "User-Agent": "Framio updater",
          ...(etag ? { "If-None-Match": etag } : {}),
        },
      });
      const final = new URL(response.url);
      if (
        final.protocol !== "https:" ||
        ![
          "api.github.com",
          "github.com",
          "release-assets.githubusercontent.com",
          "objects.githubusercontent.com",
        ].includes(final.hostname)
      )
        throw new Error("Unsafe release metadata redirect");
      let size = 0;
      const chunks: Uint8Array[] = [];
      if (response.body)
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.length;
          if (size > 1024 * 1024)
            throw new Error("Release metadata exceeds 1 MiB");
          chunks.push(chunk);
        }
      return {
        status: response.status,
        etag: response.headers.get("etag"),
        retryAfter: response.headers.get("retry-after"),
        reset: response.headers.get("x-ratelimit-reset"),
        text: Buffer.concat(chunks).toString("utf8"),
      };
    },
    catch: (cause) =>
      new UpdateFailure({
        message: `Release discovery failed: ${String(cause)}`,
      }),
  }).pipe(
    Effect.timeout("15 seconds"),
    Effect.mapError((error) => new UpdateFailure({ message: error.message })),
  );
}
