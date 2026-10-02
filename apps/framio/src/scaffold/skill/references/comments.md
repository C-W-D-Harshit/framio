# Addressing comments

When the user asks to address or fix comments, read `.framio/comments.json`. Work through open
comments for the requested page or frame. The `frame` is `<page>/<frame>`; `anchor.selector`
identifies an element, with `x` and `y` relative to it. Without a selector, coordinates are
relative to the frame.

Fix the frame in place for a requested correction. Use a variation for an exploratory change
and explain which frame contains it. Screenshot the edited frame at every responsive width,
inspect the PNGs, and fix any remaining problems.

Re-read comments.json before saving. Preserve all comments, replies, and unrelated fields.
Append an `author: "agent"` reply saying what changed, with an ISO `createdAt`, then set that
comment's `status` to `"resolved"`. Never delete user comments. If a comment needs clarification,
reply with the specific question and leave it open.

```json
{
  "comments": [{
    "id": "heading-feedback",
    "frame": "10-onboarding/welcome",
    "anchor": { "selector": "#root > main > h1", "x": 24, "y": 12 },
    "body": "Make the heading shorter",
    "author": "user",
    "status": "resolved",
    "createdAt": "2026-10-01T10:00:00Z",
    "replies": [{ "author": "agent", "body": "Shortened the heading and checked desktop and mobile.", "createdAt": "2026-10-01T10:15:00Z" }]
  }]
}
```

Use an atomic file replacement to save. The canvas reads changes live. If errors.json reports
broken comments.json, fix its syntax or invalid fields without discarding feedback.
