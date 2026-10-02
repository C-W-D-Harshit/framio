# Framio search audit

Audited and deployed on 2 October 2026. Scope: the public landing page,
documentation, crawler files, metadata, structured data, and asset delivery.
Production deployment: `30fce6cd-2752-42de-a46e-68f31ea23db8`.

## Assessment

The site now serves indexable static HTML with clear product facts, installation
instructions, canonical URLs, and structured data. The highest-priority gaps were
missing JSON-LD, a missing sitemap, and the absence of first-party documentation.
Those are fixed. Rankings, indexing, AI citations, and real-user performance have
not been established by this audit.

## Findings and changes

| Finding                                | Impact / priority | Evidence before                                  | Implemented fix                                                                                                                           |
| -------------------------------------- | ----------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| No structured data                     | Medium / high     | Rendered homepage had zero JSON-LD scripts       | Static Person, WebSite, WebPage, SoftwareApplication, and FAQPage graph; TechArticle and BreadcrumbList on documentation                  |
| Missing sitemap                        | High / high       | `/sitemap.xml` returned 404                      | XML sitemap lists the canonical homepage and `/docs/`; robots.txt advertises it                                                           |
| No first-party usage reference         | High / high       | Documentation navigation sent visitors to GitHub | `/docs/` explains installation, agent setup, files, commands, feedback, responsive frames, and design comparison                          |
| Limited direct product answers         | Medium / high     | Homepage relied on brief marketing copy          | Explicit product definition and factual FAQ covering agents, platforms, accounts, app changes, components, and cost                       |
| Social preview metadata incomplete     | Medium / medium   | No dedicated social card                         | Shared Open Graph and Twitter metadata, image dimensions, and a 1200 by 630 branded product image                                         |
| Image delivery larger than necessary   | Medium / medium   | Seven used PNG screenshots totaled 741,734 bytes | Lossless WebP totals 256,988 bytes, a 65.4% reduction; one responsive hero picture, accurate dimensions, lazy below-fold images           |
| Remote fonts                           | Medium / medium   | Google font dependency                           | Self-hosted Geist and Geist Mono with font-display swap and a body-font preload                                                           |
| Stale release label                    | Low / medium      | Visible version was v0.0.5                       | Product schema and visible badge use v0.0.6, confirmed against the latest GitHub release                                                  |
| Missing machine-readable documentation | Low / low         | `/llms.txt` returned 404                         | Supplemental llms.txt, llms-full.txt, and docs.md reuse product facts and documentation; duplicate full-text formats have noindex headers |
| Unknown routes                         | Medium / medium   | Unknown URL already returned a real 404          | Branded 404 page includes noindex; production unknown-route status remains 404                                                            |
| www hostname unavailable               | Low / medium      | DNS has no records for www.framio.design         | Pending Cloudflare DNS and redirect configuration; current OAuth has zone read permission but lacks DNS and redirect editing scopes       |

FAQ answers and their schema share a single data source. The software graph contains
the real creator, free price, MIT license, supported operating systems, source and
download links, screenshot, and version. It does not invent reviews or ratings.

Google generally limits FAQ rich results to authoritative government and health
sites. Its SoftwareApplication rich-result requirements include review or rating
data that Framio does not currently have. This semantic markup does not promise
either rich-result format.

## Verification

Local validation passed with Bun 1.4.2:

- Astro typecheck: 30 files, zero errors, warnings, or hints.
- Static production build and Wrangler deployment dry run.
- `check:seo`: single H1, indexable metadata, canonical URLs, parsed JSON-LD,
  matching visible FAQ, internal page links, sitemap, robots, documentation formats,
  social image, and installer.
- React Doctor changed-file scan: 100/100, two files scanned. This is a scoped
  diagnostic, not a complete application audit.
- `git diff --check`.

Browser verification covered the homepage and documentation at 1440 and 390 CSS
pixels. The mobile documentation uses a compact section disclosure. No horizontal
page overflow or broken loaded images appeared in the inspected pages. JSON-LD
was parsed in the rendered browser as well as from the initial static HTML.
The production install button showed Copied, and keyboard FAQ toggling opened
the answer without selecting text.

Production HTTP checks confirmed:

- Homepage and documentation return 200 with their expected JSON-LD graphs.
- robots.txt and sitemap.xml return 200 with correct types and sitemap references.
- llms.txt, llms-full.txt, docs.md, and install.sh return 200.
- docs.md carries a canonical Link header to `/docs/`; duplicate full-text
  formats carry X-Robots-Tag noindex.
- HTTP apex redirects to HTTPS. HSTS is present.
- Unknown routes return 404.
- Requests using Googlebot, bingbot, OAI-SearchBot, ChatGPT-User, PerplexityBot,
  and GPTBot user-agent names return 200. These are simulated user agents,
  not verification of provider-owned crawler IPs or successful indexing.

PageSpeed Insights returned HTTP 429 because the unauthenticated API quota was
unavailable. No Lighthouse score, field Core Web Vitals result, search traffic,
ranking, or AI citation improvement is claimed. Google Rich Results Test was not
run; local and browser JSON parsing checks do not replace its eligibility checks.
No CLI binary, application service, or CI validation was needed or performed for
these website changes.

## Next actions

1. In the verified Google Search Console property, submit
   `https://framio.design/sitemap.xml`. Inspect the homepage and `/docs/`, run a
   live test, and request indexing. Property creation alone does not prove DNS
   verification or that Google has indexed the pages.
2. Import the verified Search Console property into Bing Webmaster Tools and
   submit the same sitemap.
3. Configure a proxied www DNS record and a permanent Cloudflare redirect to
   `https://framio.design`, preserving the path and query string. Verify HTTPS,
   the redirect, and the canonical destination afterward.
4. Review Search Console Pages, Crawl Stats, and Core Web Vitals after data
   arrives. Check genuine crawler access in Cloudflare logs if indexing stalls.
5. Run PageSpeed Insights on mobile and desktop when available. Measure LCP,
   INP, and CLS before making further performance claims or changes.
6. Use search queries and real support questions to guide future documentation.
   Add specific examples or comparisons only when they contain useful firsthand
   evidence. Keep product facts and release versions current.

## AI search approach and sources

The site supplies crawlable HTML, direct answers, first-party documentation, and
consistent entity information. llms.txt and Markdown are supplemental reading
formats. They do not guarantee discovery, citations, or ranking. Google states
that AI Overviews and AI Mode require no special schema or AI text file.

- [Google AI features and site guidance](https://developers.google.com/search/docs/appearance/ai-features)
- [Google software application structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [Google FAQ structured data](https://developers.google.com/search/docs/appearance/structured-data/faqpage)
- [OpenAI crawler documentation](https://platform.openai.com/docs/bots)
- [Framio source and releases](https://github.com/C-W-D-Harshit/framio)
