export default function Brand() {
  return (
    <span className="inline-flex shrink-0 items-center gap-2.5">
      <img
        src="/assets/brand/framio-wordmark-on-dark.png"
        alt="Framio"
        width={797}
        height={244}
        className="h-5 w-auto md:h-[22px]"
      />
      <span className="rounded border border-landing-line bg-landing-raised px-1.5 py-0.5 font-mono text-[10px] leading-none text-landing-muted">
        Alpha
      </span>
    </span>
  );
}
