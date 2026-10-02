import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { faqs, SITE_URL } from "../src/lib/site";
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const read = (path: string) => readFileSync(join(dist, path), "utf8");
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
for (const [path, canonical, types] of [
  [
    "index.html",
    `${SITE_URL}/`,
    ["SoftwareApplication", "WebSite", "WebPage", "FAQPage"],
  ],
  ["docs/index.html", `${SITE_URL}/docs/`, ["TechArticle", "BreadcrumbList"]],
] as const) {
  const html = read(path);
  assert.equal([...html.matchAll(/<h1(?:\s|>)/g)].length, 1, `${path}: one H1`);
  assert(
    html.includes(`rel="canonical" href="${canonical}"`),
    `${path}: canonical`,
  );
  assert(
    html.includes('name="robots" content="index, follow'),
    `${path}: indexable`,
  );
  const schemaMatch = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );
  assert(schemaMatch, `${path}: JSON-LD in initial HTML`);
  const schema = JSON.parse(schemaMatch[1]);
  for (const type of types)
    assert(
      schema["@graph"].some(
        (item: Record<string, unknown>) => item["@type"] === type,
      ),
      `${path}: ${type}`,
    );
  if (path === "index.html") {
    const faq = schema["@graph"].find(
      (item: Record<string, unknown>) => item["@type"] === "FAQPage",
    );
    assert.deepEqual(
      faq.mainEntity.map(
        (q: { name: string; acceptedAnswer: { text: string } }) => ({
          q: q.name,
          a: q.acceptedAnswer.text,
        }),
      ),
      faqs,
      "Schema matches source FAQ, including escaped characters",
    );
    const rendered = [...html.matchAll(/<details[^>]*>([\s\S]*?)<\/details>/g)];
    assert.equal(rendered.length, faqs.length);
    rendered.forEach((match, index) => {
      assert.equal(
        text(match[1].match(/<summary[^>]*>([\s\S]*?)<\/summary>/)![1]),
        faqs[index].q,
      );
      assert.equal(
        text(match[1].match(/<p[^>]*>([\s\S]*?)<\/p>/)![1]),
        faqs[index].a,
      );
    });
    assert(!html.includes("fonts.googleapis.com"), "Fonts are self-hosted");
  }
  for (const match of html.matchAll(/href="(\/[^"#?]*)(?:#[^"]*)?"/g)) {
    const path = match[1];
    const filename = path.endsWith("/") ? `${path}index.html` : path;
    assert(
      existsSync(join(dist, filename.slice(1))),
      `Internal link exists: ${path}`,
    );
  }
}
const sitemap = read("sitemap.xml");
assert.deepEqual(
  [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]),
  [`${SITE_URL}/`, `${SITE_URL}/docs/`],
);
assert(read("robots.txt").includes(`Sitemap: ${SITE_URL}/sitemap.xml`));
assert(!read("robots.txt").includes("Disallow: /"));
assert(read("404.html").includes('name="robots" content="noindex, follow"'));
assert(read("docs.md").startsWith("# Framio quick start"));
assert(read("llms-full.txt").includes(faqs[0].a));
for (const file of [
  "assets/brand/framio-social.png",
  "assets/landing/hero-thread.webp",
  "install.sh",
])
  assert(existsSync(join(dist, file)));
console.log(
  "SEO checks passed: indexable HTML, canonical URLs, structured data, matching FAQ, internal links, sitemap, robots, Markdown, social image, and installer.",
);
