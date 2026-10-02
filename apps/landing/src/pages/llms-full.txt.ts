import type { APIRoute } from "astro";
import markdown from "./docs/index.md?raw";
import { faqs, SITE_DESCRIPTION } from "../lib/site";
export const GET: APIRoute = () =>
  new Response(
    `# Framio\n\n${SITE_DESCRIPTION}\n\nSource: https://framio.design/\n\n## Frequently asked questions\n\n${faqs.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n")}\n\n${markdown.replace(/^---\n[\s\S]*?\n---\n/, "# Documentation\n")}`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
