# Design evidence

`.framio/evidence.json` stores the brief, reference shortlist, selected composition, and
reviews. The canvas Evidence panel displays it. This record links decisions to source
material and actual captures. It does not grade taste or turn a written 'pass' into proof.

## Read and update

Run `framio evidence` before an update. Its response contains the current `evidence`, captured
screenshots, and revision information. Copy the `evidence` document into a temporary JSON file,
preserve existing entries, and edit the relevant fields. Keep the response's top-level
`revision` for the write, so Framio can reject stale updates. Then run:

```sh
framio evidence --write /tmp/framio-evidence.next.json --expect <revision-from-read>
framio evidence
```

Replace `<revision-from-read>` with the actual revision from the read response. The revision
is required when evidence.json exists. Use `--expect new` only if it is missing. New projects
already include evidence.json, so read its revision even when its arrays are still empty.

The write replaces the whole evidence document after schema validation. It uses that expected
revision and an atomic write. If another edit causes a conflict, reread and incorporate that
edit rather than replacing it with your older document. Unknown document fields can carry
project-specific notes at the document root; preserve them. Do not edit capture history in `.state/`.

The initial document is:

```json
{
  "version": 1,
  "references": [],
  "reviews": []
}
```

## Brief and reference fields

`brief`, when present, contains these fields:

| Field | Record |
| --- | --- |
| `audience` | The actual reader or operator and their relevant context |
| `difference` | The confirmed product difference, or a clearly labeled proposed positioning |
| `conversion` | The intended next action |
| `facts` | Objects with `text` and `source`; name the user answer, local file, or published URL supporting each fact |
| `assumptions` | Unconfirmed positioning, capabilities, proposed copy, or demo-scenario notes |
| `constraints` | Optional list of agreed tone, format, accessibility, and scope constraints |

Do not put an unconfirmed assertion in `facts`. Demo ledger amounts can be synthetic, with a
note in `assumptions`. Marketing results, customer names, prices, certifications, and offers
need actual sources before appearing as factual copy. The UI frame can omit missing proof.

Each `references` entry has a unique `id`, `name`, public `url`, and `borrow` note. Add
`registryItem` for the exact Tailark ID or template registry URL, `previewFrame` for the saved
rendered frame such as `01-moodboard/<slug>`, and an optional `avoid` note. Name a concrete
decision and its relevance. 'Premium' or 'looks good' is not a borrowing reason. A missing
`previewFrame` means the reference has not been linked to a rendered artifact in the canvas.

See [libraries.md](libraries.md) for reference discovery and capture. Imported copy and a
template's proof claims still need factual review. A source can be useful for composition
without being a source of truth about your product.

## Direction fields

`direction`, when present, contains `frame`, `referenceIds`, `composition`, `why`, and
`alternatives`. Use the actual chosen frame path and IDs from the reference shortlist.
Describe where the promise, CTA, and product artifact sit and how that helps the audience.
Each alternative has its actual `frame` and a `reason` explaining the fit decision.

Do not invent alternatives that were never built or reviewed. An empty alternatives array
is honest when the user already supplied a direction or the task is a narrow edit. Record
the existing choice in `why`. Keep requested constraints rather than changing the brief to
make one alternative easier to reject.

## Capture-linked reviews

`framio screenshot` returns `captureId` and `archivePath` for successful full-frame and layer
captures. Open the returned `archivePath` and use its corresponding capture ID in a review.
Run `framio evidence` to find the capture, viewport, layer, source revision, and time. Inspect
returns geometry and checks; it does not create capture IDs. Do not attach a review to an
older unsuffixed screenshot after responsive widths change the output paths.

Each `reviews` entry contains:

| Field | Record |
| --- | --- |
| `id` | Unique review ID; retain earlier reviews as history |
| `frame` | Reviewed frame path |
| `captureId` | The real capture ID for the image you opened |
| `kind` | `technical` for implementation findings, `composition` for visual and product comparison |
| `verdict` | `pass` when that review's known issues are resolved, otherwise `revise` |
| `findings` | Specific observations, including the outcome when no defect was found |
| `changes` | Actual changes made from those observations, or an empty array when none were needed |
| `createdAt` | Current UTC ISO timestamp, for example `2026-10-02T14:35:00Z` |

A technical review can address clipping, contrast, geometry, font loading, or diagnostics.
A composition review explains what the product view demonstrates, how its hierarchy compares
with the rendered references, and whether the copy has support. Record both before treating
a new landing hero as ready for expansion. Do not write a composition pass based only on
`framio inspect`, or a technical pass for an image you did not inspect.

When a correction changes the frame, capture and review the result with a new ID. Reviews
can become stale when source, theme, assets, viewport metadata, brief, references, or direction
change. The Evidence panel shows that state. Recheck the affected decision against a current
capture. Preserve old reviews instead of rewriting them to claim they saw the latest frame.
