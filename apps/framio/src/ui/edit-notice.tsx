import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { editNoticesAtom } from "./state";

export function EditNotice() {
  const result = useAtomValue(editNoticesAtom);
  const notice = AsyncResult.isSuccess(result) ? result.value : null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed bottom-20 left-1/2 z-50 max-w-[min(420px,calc(100vw-32px))] -translate-x-1/2"
    >
      {notice && (
        <p
          key={notice.id}
          className="rounded-lg border bg-card px-4 py-3 text-xs leading-5 shadow-xl"
        >
          {notice.message}
        </p>
      )}
    </div>
  );
}
