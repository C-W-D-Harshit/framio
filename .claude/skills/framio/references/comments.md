# Comments

`.framio/comments.json` contains a `comments` array. `frame` identifies `<page>/<frame>`.
`anchor.selector` identifies an element; `x` and `y` are relative to that element, or to the frame
when no selector is present. Replies use `author`, `body`, and an ISO `createdAt` timestamp.
`status` is `open` or `resolved`; an agent reply describes the change or unresolved question.

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
    "replies": [{ "author": "agent", "body": "Shortened the heading.", "createdAt": "2026-10-01T10:15:00Z" }]
  }]
}
```

The canvas reads changes live. Saves use atomic replacement of the latest document, retaining
all comments, replies, and unrelated fields. User comments are never deleted.
Malformed JSON or invalid fields appear in `.framio/.state/errors.json`.
