/*
 * Textures for the landing page.
 * - Grain: the per-pixel noise from React Bits <Noise /> (components/Noise.tsx), drawn once into
 *   a small tile and repeated, so it covers a long page without an animation loop.
 * - CanvasDots: React Bits <DotGrid /> styled as the Studio canvas grid; dots near the pointer
 *   turn corner blue.
 * - PanelDots: the same canvas grid as a static pattern for cards and panels.
 */
import { useEffect, useState, type CSSProperties } from "react";
import DotGrid from "@/components/DotGrid";
import { cn } from "@/lib/utils";

function grainTile(size: number, alpha: number) {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = Math.random() * 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = alpha;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Static film grain. `alpha` is 0 to 255 per pixel, like React Bits Noise's patternAlpha. */
export function Grain({
  alpha = 14,
  blend = "normal",
  className,
}: {
  alpha?: number;
  blend?: CSSProperties["mixBlendMode"];
  className?: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl(grainTile(256, alpha));
  }, [alpha]);
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{
        backgroundImage: url ? `url(${url})` : undefined,
        backgroundSize: "256px 256px",
        mixBlendMode: blend,
      }}
    />
  );
}

export function CanvasDots({
  className,
  animated = true,
}: {
  className?: string;
  animated?: boolean;
}) {
  if (!animated) return <PanelDots className={className} color="#3F3F46" />;
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
    >
      <DotGrid
        className="!p-0"
        dotSize={2.5}
        gap={17.5}
        baseColor="#3F3F46"
        activeColor="#0C64FF"
        proximity={140}
        shockRadius={200}
        shockStrength={3}
      />
    </div>
  );
}

export function PanelDots({
  className,
  color = "rgb(255 255 255 / 0.06)",
}: {
  className?: string;
  color?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{
        backgroundImage: `radial-gradient(${color} 1px, transparent 1px)`,
        backgroundSize: "20px 20px",
      }}
    />
  );
}
