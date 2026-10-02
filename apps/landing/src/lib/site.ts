export const SITE_URL = "https://framio.design";
export const RELEASE_VERSION = "v0.0.6";
export const REPO_URL = "https://github.com/C-W-D-Harshit/framio";
export const SITE_TITLE = "Design canvas for Claude Code and Codex · Framio";
export const SITE_DESCRIPTION =
  "Framio is a free, open-source design canvas for Claude Code and Codex. Review React and Tailwind designs, pin feedback, and compare them with your running app.";
export const INSTALL_COMMAND =
  "curl -fsSL https://framio.design/install.sh | sh";

// The visible FAQ and its structured data share the same answers.
export const faqs = [
  {
    q: "Which agents does Framio work with?",
    a: "Framio works with Claude Code and Codex. framio init installs the skill in .claude/skills and .agents/skills, so any coding agent that reads either folder can use it.",
  },
  {
    q: "Do I need a design tool or an account?",
    a: "No. Framio is one binary. The canvas runs on localhost and the designs are files in your project.",
  },
  {
    q: "Does Framio change my app's code?",
    a: "No. Designs live in .framio/. When you pick a design, ask your agent to build it in your app. Use framio screenshot --url <app-url> --compare <page>/<frame> to compare the implementation with the design.",
  },
  {
    q: "What operating systems does Framio support?",
    a: "Framio runs on macOS on Apple Silicon and Linux on x64 or arm64. Intel Macs and Windows are not supported. framio add also needs Node.js.",
  },
  {
    q: "Can my agent use existing components?",
    a: "Frames start with React, Tailwind, and shadcn/ui. framio add pulls components from shadcn registries, and framio install adds npm packages to the design project.",
  },
  {
    q: "Is Framio free?",
    a: "Yes. Framio is free and open source under the MIT license. There is no subscription or account requirement.",
  },
];

export const productSchema = {
  "@type": "SoftwareApplication",
  "@id": `${SITE_URL}/#software`,
  name: "Framio",
  softwareVersion: RELEASE_VERSION.slice(1),
  url: `${SITE_URL}/`,
  description: SITE_DESCRIPTION,
  applicationCategory: "DeveloperApplication",
  operatingSystem: ["macOS on Apple Silicon", "Linux x64", "Linux arm64"],
  isAccessibleForFree: true,
  license: `${REPO_URL}/blob/main/LICENSE`,
  downloadUrl: `${REPO_URL}/releases`,
  installUrl: `${SITE_URL}/docs/#install`,
  screenshot: `${SITE_URL}/assets/landing/hero-thread.webp`,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  creator: { "@id": `${SITE_URL}/#creator` },
  sameAs: [REPO_URL],
  featureList: [
    "Live React and Tailwind design canvas",
    "Coding agent skills for Claude Code and Codex",
    "Pinned comments and agent replies",
    "Responsive desktop and mobile frames",
    "Shared DESIGN.md tokens",
    "Design and implementation screenshot comparison",
  ],
};

export function homeSchema() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        "@id": `${SITE_URL}/#creator`,
        name: "Harshit",
        url: "https://github.com/C-W-D-Harshit",
        sameAs: ["https://github.com/C-W-D-Harshit"],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: "Framio",
        url: `${SITE_URL}/`,
        inLanguage: "en",
      },
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/#webpage`,
        url: `${SITE_URL}/`,
        name: SITE_TITLE,
        description: SITE_DESCRIPTION,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        mainEntity: { "@id": `${SITE_URL}/#software` },
        inLanguage: "en",
      },
      productSchema,
      {
        "@type": "FAQPage",
        "@id": `${SITE_URL}/#faq`,
        url: `${SITE_URL}/#faq`,
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };
}
