/*
 * Adapted from React Bits <CountUp /> (MIT, Copyright (c) David Haz), https://reactbits.dev.
 * Changes: the final value renders in the server HTML, so crawlers and no-JS readers see the
 * real number. The count only resets to `from` when the number starts below the fold and
 * motion is allowed, then springs up once it scrolls into view.
 */
import { useInView, useMotionValue, useSpring } from "motion/react";
import { useCallback, useEffect, useRef } from "react";

interface CountUpProps {
  to: number;
  from?: number;
  delay?: number;
  duration?: number;
  className?: string;
  animate?: boolean;
}

export default function CountUp({
  to,
  from = 0,
  delay = 0,
  duration = 1.2,
  className = "",
  animate = true,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(to);
  const springValue = useSpring(motionValue, {
    damping: 20 + 40 * (1 / duration),
    stiffness: 100 * (1 / duration),
  });
  const isInView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const armed = useRef(false);

  const decimals = Math.max(
    ...[from, to].map((n) => (n.toString().split(".")[1] ?? "").length),
  );
  const format = useCallback(
    (value: number) =>
      Intl.NumberFormat("en-US", {
        useGrouping: false,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value),
    [decimals],
  );

  // Arm the count only when the number starts off screen; on screen it stays put.
  useEffect(() => {
    const el = ref.current;
    if (!animate || !el) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    armed.current = true;
    motionValue.jump(from);
    el.textContent = format(from);
  }, [animate, from, format, motionValue]);

  useEffect(() => {
    if (!isInView || !armed.current) return;
    const id = setTimeout(() => motionValue.set(to), delay * 1000);
    return () => clearTimeout(id);
  }, [isInView, motionValue, to, delay]);

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current && armed.current)
          ref.current.textContent = format(latest);
      }),
    [springValue, format],
  );

  return (
    <span className={className} ref={ref}>
      {format(to)}
    </span>
  );
}
