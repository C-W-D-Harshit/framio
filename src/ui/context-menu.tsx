import { useEffect, useRef } from "react";

export type MenuItem = { label: string; hint?: string; onSelect(): void };

/** Minimal right-click menu. Closes on outside click, Escape, scroll, or after picking an item. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) =>
      !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onClose, { passive: true });
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      data-ui
      role="menu"
      className="fixed z-30 min-w-52 rounded-lg border border-chrome-line bg-chrome p-1 text-xs shadow-xl shadow-black/40"
      style={{
        left: Math.min(x, window.innerWidth - 220),
        top: Math.min(y, window.innerHeight - 40 * items.length),
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          className="flex w-full items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-left text-neutral-200 hover:bg-accent hover:text-white"
        >
          {item.label}
          {item.hint && <span className="text-neutral-500">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
