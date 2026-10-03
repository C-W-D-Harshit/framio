# Evidence

`.framio/evidence.json` is an optional record displayed in the canvas Evidence panel.
The initial document is `{"version": 1, "reviews": []}`. It has no required usage cadence.

| Field | Shape and meaning |
| --- | --- |
| `version` | Required literal `1` |
| `brief` | Optional object with `audience`, `difference`, `conversion`, `facts: [{text, source}]`, `assumptions: string[]`, and optional `constraints: string[]` |
| `direction` | Optional object with `frame`, `composition`, `why`, and `alternatives: [{frame, reason}]` |
| `reviews` | Required array of `{id, frame, captureId, kind, verdict, findings, changes, createdAt}` |
| Review values | Unique `id`; `frame` is `<page>/<frame>`; `captureId` links a screenshot; `kind` is `technical` or `composition`; `verdict` is `pass` or `revise`; `findings` and `changes` are string arrays; `createdAt` is an ISO UTC timestamp |

Text fields are nonblank. Unknown fields at the document root and in `direction` can hold project notes.

`framio evidence` returns `evidence`, `revision`, `contextRevision`, `captures`, `error`, and
computed `reviews` with `status` and `reason`. `revision` is null only when the record is missing.
Captures have `id`, `frame`, `path` in `history/`, optional frame `revision` and build `generation`,
`contextRevision`, `viewportWidth`, pixel `width` and `height`, optional `layer`, and UTC `capturedAt`.
Capture history is managed in `.state/`, separately from the editable evidence document.

Review status is `current` when frame and context revisions match the capture, `outdated` after
frame/theme/asset or brief/direction changes, and `unavailable` for missing captures, frames,
revisions, or a capture belonging to another frame. Status describes that capture's scope.

## Write contract

`framio evidence --write <file> --expect <revision>` accepts an evidence document, not the read
response wrapper. The current revision is required for an existing record. `--expect new` applies
only when the file is missing; initialized projects already contain an empty record.
Writes validate the schema and atomically replace the whole document. Missing or stale expected
revisions reject replacement of an existing record. A replacement preserves existing entries,
unrelated data, and unknown root and direction fields. Successful writes print the saved path.
