import * as Effect from "effect/Effect";
import type { DesignReference } from "../contracts/references";
import { InvalidInput } from "./errors";

const checkedAt = "2026-10-02";

export const designReferences: readonly DesignReference[] = [
  {
    id: "axis",
    name: "Axis",
    provider: "StyleUI",
    kind: "page",
    description: "CRM landing page for consultants and small teams.",
    sourceUrl: "https://www.styleui.dev/template/axis",
    previewUrl: "https://www.styleui.dev/templates/axis",
    registryItem: "https://styleui.dev/r/axis.json",
    registryUrl: "https://www.styleui.dev/r/axis.json",
    tags: ["crm", "erp", "business", "saas", "product", "light", "landing"],
    borrow:
      "Compare the split headline and supporting copy above a large product screenshot. Use that hierarchy when a working product view explains the offer.",
    avoid:
      "Replace customer logos, claims, pricing and CRM imagery with material supported by the brief. Adapt its Next.js imports and bundled assets for a Framio frame.",
    registryStatus: "verified",
    registryCheckedAt: checkedAt,
    previewCheckedAt: checkedAt,
  },
  {
    id: "notio",
    name: "Notio",
    provider: "StyleUI",
    kind: "page",
    description: "Call recording and transcription landing page.",
    sourceUrl: "https://www.styleui.dev/template/notio",
    previewUrl: "https://www.styleui.dev/templates/notio",
    registryItem: "https://styleui.dev/r/notio.json",
    registryUrl: "https://www.styleui.dev/r/notio.json",
    tags: ["saas", "productivity", "audio", "mobile", "product", "landing"],
    borrow:
      "Study how a short promise sits beside a recognizable recording interaction. Pair a product task with the headline when that task is the reason to try it.",
    avoid:
      "The phone treatment and warm background suit this example, not every product. Replace its claims and assets, and adapt Next.js imports before reuse.",
    registryStatus: "verified",
    registryCheckedAt: checkedAt,
    previewCheckedAt: checkedAt,
  },
  {
    id: "dusk-landing-1",
    name: "Tailark Dusk landing 1",
    provider: "Tailark",
    kind: "page",
    description:
      "Dark landing page with a centered promise and large application preview.",
    sourceUrl:
      "https://github.com/tailark/blocks/tree/main/registry/bases/base/dusk/pages/landing/one",
    previewUrl: "https://oss.tailark.com/view/dusk-landing-1",
    registryItem: "@tailark-oss/dusk-landing-1",
    registryUrl: "https://oss.tailark.com/r/dusk-landing-1",
    tags: ["crm", "erp", "saas", "dark", "product", "pricing", "landing"],
    borrow:
      "Compare the scale of the product screenshot against the short centered headline, then the shift to left-aligned feature explanations and open pricing columns.",
    avoid:
      "Keep only sections that serve the product story. Replace sample statistics and endorsements, and adapt the imported page into a static frame.",
    registryStatus: "verified",
    registryCheckedAt: checkedAt,
    previewCheckedAt: checkedAt,
  },
  {
    id: "dusk-landing-5",
    name: "Tailark Dusk landing 5",
    provider: "Tailark",
    kind: "page",
    description:
      "Dark landing page with a large media hero and detailed feature sections.",
    sourceUrl:
      "https://github.com/tailark/blocks/tree/main/registry/bases/base/dusk/pages/landing/five",
    previewUrl: "https://oss.tailark.com/view/dusk-landing-5",
    registryItem: "@tailark-oss/dusk-landing-5",
    registryUrl: "https://oss.tailark.com/r/dusk-landing-5",
    tags: ["saas", "dark", "media", "video", "features", "landing"],
    borrow:
      "Study the media-led first viewport and the alternating product details below it. Use the contrast in scale when a strong visual asset carries the opening story.",
    avoid:
      "Do not keep the large media area without a useful asset. Check its resting state and reduce the long feature sequence to what the brief needs.",
    registryStatus: "verified",
    registryCheckedAt: checkedAt,
    previewCheckedAt: checkedAt,
  },
  {
    id: "mist-hero-section-1",
    name: "Tailark Mist hero 1",
    provider: "Tailark",
    kind: "hero",
    description: "Light payments hero with copy beside a product interface.",
    sourceUrl:
      "https://github.com/tailark/blocks/tree/main/registry/bases/base/mist/blocks/hero-section/one",
    previewUrl: "https://oss.tailark.com/view/mist-hero-section-1",
    registryItem: "@tailark-oss/mist-hero-section-1",
    registryUrl: "https://oss.tailark.com/r/mist-hero-section-1",
    tags: ["finance", "payments", "saas", "light", "split", "hero", "product"],
    borrow:
      "Compare the compact left-hand promise and actions with the larger product view on the right. Keep the demonstrated task readable at the chosen viewport.",
    avoid:
      "A single hero does not supply the rest of the page story. Replace example product screens and logos before presenting it as the user's product.",
    registryStatus: "verified",
    registryCheckedAt: checkedAt,
    previewCheckedAt: checkedAt,
  },
];

export function searchReferences(query = ""): readonly DesignReference[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return designReferences.filter((reference) => {
    const text = [
      reference.id,
      reference.name,
      reference.provider,
      reference.kind,
      reference.description,
      ...reference.tags,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export const referenceById = Effect.fn("referenceById")(function* (id: string) {
  const reference = designReferences.find((item) => item.id === id);
  if (!reference)
    return yield* new InvalidInput({
      message: `Unknown reference "${id}". Available IDs: ${designReferences.map((item) => item.id).join(", ")}`,
    });
  return reference;
});
