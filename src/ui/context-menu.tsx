import { useEffect, useEffectEvent, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
} from "./components/ui/dropdown-menu";
export type MenuItem = { label: string; hint?: string; onSelect(): void };

/** Base UI handles menu focus, arrow keys, Escape, outside clicks and screen edges. */
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
  const anchor = useMemo(
    () => ({ getBoundingClientRect: () => new DOMRect(x, y, 0, 0) }),
    [x, y],
  );
  const close = useEffectEvent(onClose);
  useEffect(() => {
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("wheel", close);
      window.removeEventListener("blur", close);
    };
  }, []);
  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DropdownMenuContent
        anchor={anchor}
        sideOffset={0}
        data-ui
        aria-label="Frame actions"
        className="w-[248px] rounded-lg border shadow-xl"
      >
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            className="h-8 px-2.5 text-[13px] focus:bg-primary focus:text-primary-foreground data-highlighted:bg-primary data-highlighted:text-primary-foreground"
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.label}
            {item.hint && (
              <DropdownMenuShortcut className="font-sans tracking-normal group-data-highlighted/dropdown-menu-item:text-primary-foreground/75">
                {item.hint}
              </DropdownMenuShortcut>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
