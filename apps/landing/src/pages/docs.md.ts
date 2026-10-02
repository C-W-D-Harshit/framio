import type { APIRoute } from "astro";
import markdown from "./docs/index.md?raw";
export const GET: APIRoute = () =>
  new Response(
    markdown.replace(
      /^---\n[\s\S]*?\n---\n/,
      "# Framio quick start: design with Claude Code and Codex\n",
    ),
    { headers: { "Content-Type": "text/markdown; charset=utf-8" } },
  );
