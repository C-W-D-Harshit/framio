import { ArrowUpRight, BookOpen, Camera, Check, X } from "lucide-react";
import type { ReactNode } from "react";
import {
  emptyEvidence,
  type CaptureEvidence,
  type EvidenceFile,
} from "../contracts/evidence";
import type { Snapshot, SnapshotFrame } from "../contracts/snapshot";
import { reviewStatus } from "../domain/evidence";
import { Button } from "./components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "./components/ui/sidebar";
import { imageUrl } from "./frame-node";

function identified<T>(values: readonly T[], identity: (value: T) => string) {
  const counts = new Map<string, number>();
  return values.map((value) => {
    const id = identity(value);
    const occurrence = counts.get(id) ?? 0;
    counts.set(id, occurrence + 1);
    return { value, key: `${id}/${occurrence}` };
  });
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b px-4 py-5 last:border-b-0">
      <h3 className="mb-3 text-xs font-medium">{title}</h3>
      {children}
    </section>
  );
}

function FrameLink({
  frame,
  frames,
  onFrame,
}: {
  frame: string;
  frames: ReadonlyMap<string, SnapshotFrame>;
  onFrame(frame: SnapshotFrame): void;
}) {
  const found = frames.get(frame);
  if (!found)
    return (
      <p className="text-xs text-muted-foreground">
        Frame unavailable: {frame}
      </p>
    );
  return (
    <button
      className="flex w-full items-center justify-between gap-2 rounded-md border p-2.5 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onFrame(found)}
    >
      <span className="truncate">{found.meta.name}</span>
      <ArrowUpRight className="size-3.5 shrink-0" />
    </button>
  );
}

function Capture({
  capture,
  current,
}: {
  capture: CaptureEvidence;
  current: boolean;
}) {
  return (
    <a
      href={`/shots/${capture.path}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-md border hover:border-signal focus-visible:ring-2 focus-visible:ring-ring"
    >
      <img
        src={`/shots/${capture.path}`}
        alt={`Captured ${capture.frame}${capture.layer ? `, ${capture.layer}` : ""} at ${capture.viewportWidth}px`}
        loading="lazy"
        className="h-24 w-full bg-card object-cover object-top"
      />
      <div className="flex items-center justify-between gap-2 px-2 py-2 text-[11px]">
        <span className="truncate">
          {capture.viewportWidth}px
          {capture.layer ? ` · ${capture.layer}` : " · Full frame"}
        </span>
        <span className={current ? "text-live" : "text-muted-foreground"}>
          {capture.revision ? (current ? "Current" : "Outdated") : "External"}
        </span>
      </div>
    </a>
  );
}

type EvidenceContext = {
  evidence: EvidenceFile;
  frames: readonly SnapshotFrame[];
  frameById: ReadonlyMap<string, SnapshotFrame>;
  captures: readonly CaptureEvidence[];
  captureById: ReadonlyMap<string, CaptureEvidence>;
  contextRevision: string;
  cssVersion: number;
  onFrame(frame: SnapshotFrame): void;
};

function BriefSection({ evidence }: EvidenceContext) {
  return (
    <Section title="Product brief">
      {evidence.brief ? (
        <>
          <dl className="space-y-3 text-xs leading-5">
            {[
              ["Audience", evidence.brief.audience],
              ["Product difference", evidence.brief.difference],
              ["Primary action", evidence.brief.conversion],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
          {evidence.brief.facts.length > 0 && (
            <details className="mt-4 text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Confirmed facts · {evidence.brief.facts.length}
              </summary>
              <ul className="mt-2 space-y-2">
                {identified(evidence.brief.facts, (fact) =>
                  JSON.stringify([fact.text, fact.source]),
                ).map(({ value: fact, key }) => (
                  <li key={key} className="leading-5">
                    {fact.text}
                    <span className="block break-words text-[11px] text-muted-foreground">
                      Source: {fact.source}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {evidence.brief.assumptions.length > 0 && (
            <div className="mt-4 text-xs">
              <p className="text-muted-foreground">Assumptions to confirm</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 leading-5">
                {identified(evidence.brief.assumptions, (value) => value).map(
                  ({ value, key }) => (
                    <li key={key}>{value}</li>
                  ),
                )}
              </ul>
            </div>
          )}
          {!!evidence.brief.constraints?.length && (
            <div className="mt-4 text-xs">
              <p className="text-muted-foreground">Design constraints</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 leading-5">
                {identified(evidence.brief.constraints, (value) => value).map(
                  ({ value, key }) => (
                    <li key={key}>{value}</li>
                  ),
                )}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">
          Ask your agent to record the audience, product difference, primary
          action, and confirmed product facts.
        </p>
      )}
    </Section>
  );
}

function ReferencesSection({
  evidence,
  frameById,
  onFrame,
  cssVersion,
}: EvidenceContext) {
  const selectedIds = new Set(evidence.direction?.referenceIds ?? []);
  return (
    <Section title="Rendered references">
      {evidence.references.length ? (
        <div className="space-y-4">
          {evidence.references.map((reference) => {
            const frame = reference.previewFrame
              ? frameById.get(reference.previewFrame)
              : undefined;
            const selected = selectedIds.has(reference.id);
            return (
              <article
                key={reference.id}
                className="space-y-2 text-xs leading-5"
              >
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={reference.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 items-center gap-1 text-signal underline underline-offset-4"
                  >
                    <span className="truncate">{reference.name}</span>
                    <ArrowUpRight className="size-3 shrink-0" />
                  </a>
                  {selected && (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-live">
                      <Check className="size-3" />
                      Selected
                    </span>
                  )}
                </div>
                {frame && (
                  <button
                    onClick={() => onFrame(frame)}
                    aria-label={`View reference ${reference.name}`}
                    className="block w-full overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <img
                      src={
                        frame.kind === "image"
                          ? imageUrl(frame)
                          : `/thumb/${encodeURIComponent(frame.page)}/${encodeURIComponent(frame.slug)}.png?v=${frame.version}-${cssVersion}&width=${frame.meta.width}`
                      }
                      alt={`Rendered ${reference.name} reference`}
                      className="h-24 w-full bg-card object-cover object-top"
                      loading="lazy"
                    />
                  </button>
                )}
                {!frame && (
                  <p className="text-[11px] text-muted-foreground">
                    Rendered preview has not been saved to the canvas.
                  </p>
                )}
                <p>{reference.borrow}</p>
                {reference.avoid && (
                  <p className="text-muted-foreground">
                    Adapt: {reference.avoid}
                  </p>
                )}
                {reference.registryItem && (
                  <p className="font-mono text-[10px] break-all text-muted-foreground">
                    {reference.registryItem}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">
          Compare a few rendered references. Record which composition details
          fit this product.
        </p>
      )}
    </Section>
  );
}

function DirectionSection({ evidence, frameById, onFrame }: EvidenceContext) {
  return (
    <Section title="Selected composition">
      {evidence.direction ? (
        <div className="space-y-3 text-xs leading-5">
          <FrameLink
            frame={evidence.direction.frame}
            frames={frameById}
            onFrame={onFrame}
          />
          <p>{evidence.direction.composition}</p>
          <p className="text-muted-foreground">{evidence.direction.why}</p>
          {evidence.direction.alternatives.length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted-foreground">
                Compared alternatives · {evidence.direction.alternatives.length}
              </summary>
              <div className="mt-3 space-y-3">
                {evidence.direction.alternatives.map((alternative) => (
                  <div key={alternative.frame}>
                    <FrameLink
                      frame={alternative.frame}
                      frames={frameById}
                      onFrame={onFrame}
                    />
                    <p className="mt-1 text-muted-foreground">
                      {alternative.reason}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">
          Build the actual hero or key screen before selecting a direction. The
          choice should cover layout and product demonstration.
        </p>
      )}
    </Section>
  );
}

function ReviewSection({
  evidence,
  frames,
  frameById,
  captures,
  captureById,
  contextRevision,
  kind,
}: EvidenceContext & { kind: "technical" | "composition" }) {
  return (
    <Section
      title={
        kind === "technical" ? "Technical inspection" : "Composition review"
      }
    >
      <p className="mb-3 text-[11px] leading-5 text-muted-foreground">
        {kind === "technical"
          ? "Geometry, clipping, contrast, and build findings."
          : "Hierarchy, product clarity, reference comparison, and copy."}
      </p>
      {evidence.reviews.some((review) => review.kind === kind) ? (
        <div className="space-y-4">
          {evidence.reviews
            .filter((review) => review.kind === kind)
            .toReversed()
            .map((review) => {
              const status = reviewStatus(
                review,
                captures,
                frames,
                contextRevision,
              );
              const capture = captureById.get(review.captureId);
              return (
                <article
                  key={review.id}
                  className="rounded-md border p-3 text-xs leading-5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {frameById.get(review.frame)?.meta.name ?? review.frame}
                    </span>
                    <span
                      className={
                        status.status === "current"
                          ? review.verdict === "pass"
                            ? "text-live"
                            : "text-signal"
                          : "text-muted-foreground"
                      }
                    >
                      {status.status === "current"
                        ? review.verdict === "pass"
                          ? "Pass"
                          : "Revise"
                        : status.status === "outdated"
                          ? "Outdated"
                          : "Unavailable"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {status.reason}
                  </p>
                  {capture && (
                    <a
                      href={`/shots/${capture.path}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-signal underline underline-offset-4"
                    >
                      Reviewed screenshot · {capture.viewportWidth}px
                      {capture.layer ? ` · ${capture.layer}` : ""}
                      <ArrowUpRight className="size-3" />
                    </a>
                  )}
                  {review.findings.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {identified(review.findings, (value) => value).map(
                        ({ value, key }) => (
                          <li key={key}>{value}</li>
                        ),
                      )}
                    </ul>
                  )}
                  {review.changes.length > 0 && (
                    <div className="mt-3">
                      <p className="text-muted-foreground">Review changes</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {identified(review.changes, (value) => value).map(
                          ({ value, key }) => (
                            <li key={key}>{value}</li>
                          ),
                        )}
                      </ul>
                    </div>
                  )}
                </article>
              );
            })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No {kind} review recorded.
        </p>
      )}
    </Section>
  );
}

export function EvidencePanel({
  snapshot,
  onClose,
  onFrame,
}: {
  snapshot: Snapshot;
  onClose(): void;
  onFrame(frame: SnapshotFrame): void;
}) {
  const evidence = snapshot.evidence ?? emptyEvidence;
  const frames = snapshot.pages.flatMap((page) => page.frames);
  const frameById = new Map(frames.map((frame) => [frame.id, frame]));
  const captures = snapshot.captures ?? [];
  const captureById = new Map(captures.map((capture) => [capture.id, capture]));
  const contextRevision = snapshot.evidenceContextRevision ?? "";
  const isCurrent = (capture: CaptureEvidence) =>
    !!capture.revision &&
    frameById.get(capture.frame)?.revision === capture.revision &&
    capture.contextRevision === contextRevision;
  const recent = captures
    .filter((capture) => frameById.has(capture.frame))
    .slice(0, 8);
  const context: EvidenceContext = {
    evidence,
    frames,
    frameById,
    captures,
    captureById,
    contextRevision,
    cssVersion: snapshot.cssVersion,
    onFrame,
  };
  return (
    <Sidebar
      collapsible="none"
      side="right"
      className="w-[360px]! max-w-[calc(100vw-24px)]! shrink-0 border-l"
      aria-label="Design evidence"
    >
      <SidebarHeader className="h-14 flex-row items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-signal" />
          <h2 className="font-medium">Design evidence</h2>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close design evidence"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {snapshot.evidenceError && (
          <p
            role="alert"
            className="m-4 rounded-md bg-destructive/10 p-3 text-xs break-words text-destructive"
          >
            {snapshot.evidenceError}
          </p>
        )}
        <BriefSection {...context} />
        <ReferencesSection {...context} />
        <DirectionSection {...context} />
        <Section title="Recent screenshots">
          {recent.length ? (
            <div className="grid grid-cols-2 gap-2">
              {recent.map((capture) => (
                <Capture
                  key={capture.id}
                  capture={capture}
                  current={isCurrent(capture)}
                />
              ))}
            </div>
          ) : (
            <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <Camera className="mt-0.5 size-4 shrink-0" />
              Screenshots appear here when your agent captures a frame. Each
              review points to a saved image and viewport.
            </p>
          )}
        </Section>
        <ReviewSection {...context} kind="technical" />
        <ReviewSection {...context} kind="composition" />
      </SidebarContent>
    </Sidebar>
  );
}
