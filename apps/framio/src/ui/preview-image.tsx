import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { Atom, AsyncResult } from "effect/reactivity";

const requests = Semaphore.makeUnsafe(4);

export function PreviewImage({
  src,
  alt,
  onHeight,
  fallbackSrc,
}: {
  src: string;
  alt: string;
  onHeight?: (height: number) => void;
  fallbackSrc?: string;
}) {
  const image = useMemo(
    () =>
      Atom.make(
        Effect.gen(function* () {
          const response = yield* Effect.tryPromise((signal) =>
            fetch(src, { signal }),
          );
          if (!response.ok)
            return yield* Effect.fail(
              new Error(`Preview returned HTTP ${response.status}`),
            );
          const blob = yield* Effect.tryPromise(() => response.blob());
          const url = yield* Effect.acquireRelease(
            Effect.sync(() => URL.createObjectURL(blob)),
            (url) => Effect.sync(() => URL.revokeObjectURL(url)),
          );
          return {
            url,
            height: Number(response.headers.get("x-framio-height")),
          };
        }).pipe(Semaphore.withPermits(requests, 1)),
      ).pipe(Atom.setIdleTTL(0)),
    [src],
  );
  const result = useAtomValue(image);
  const [retained, retain] = useState(image);
  const previous = useAtomValue(retained);
  const value = AsyncResult.isSuccess(result) ? result.value : undefined;
  const displayed =
    value ?? (AsyncResult.isSuccess(previous) ? previous.value : undefined);
  const displayedUrl =
    displayed?.url ?? (AsyncResult.isFailure(result) ? fallbackSrc : undefined);
  useEffect(() => {
    if (value) retain(image);
  }, [value, image]);
  useEffect(() => {
    if (value?.height && Number.isFinite(value.height))
      onHeight?.(value.height);
  }, [value, onHeight]);
  return displayedUrl ? (
    <img
      data-preview-src={src}
      src={displayedUrl}
      alt={alt}
      draggable={false}
      className="absolute inset-0 block w-full object-contain"
    />
  ) : AsyncResult.isFailure(result) ? (
    <div
      role="status"
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground"
    >
      <span>Preview unavailable</span>
      <span>Select this frame to view it live.</span>
    </div>
  ) : null;
}
