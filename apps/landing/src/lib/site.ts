export const SITE_URL = "https://framio.design";
export const RELEASE_VERSION = "v0.0.8";
export const REPO_URL = "https://github.com/C-W-D-Harshit/framio";
export const SITE_TITLE = "Design canvas for Claude Code and Codex · Framio";
export const SITE_DESCRIPTION =
  "Framio is a free, open-source design canvas for Claude Code and Codex. Design new screens or redesign existing ones from your repo, then point at what to fix.";
export const INSTALL_COMMAND =
  "curl -fsSL https://framio.design/install.sh | sh";

// The visible FAQ and its structured data share the same answers.
export const faqs = [
  {
    q: "What is Framio?",
    a: "Framio is a free, open-source design canvas for coding agents. Your agent writes screens as React and Tailwind files in .framio/, and Framio renders them on a canvas where you select elements and pin comments for the agent to fix.",
  },
  {
    q: "How do I design UI with Claude Code?",
    a: 'Install Framio, run framio init in your project, and ask Claude Code to "use Framio to design the onboarding for my invoicing app." It asks about the product, writes each screen as a .tsx file, and you review the screens on the canvas. Codex works the same way.',
  },
  {
    q: "Can Framio redesign my existing app?",
    a: 'Yes. Ask your agent to "use Framio to redesign our pricing page." It screenshots the running page onto a moodboard, writes DESIGN.md from your current colors and fonts, and changes what you asked for. When you pick a design, it builds it in your app and compares the two at every width.',
  },
  {
    q: "Will new designs match my current design system?",
    a: "Your agent reads your code, theme, and copy before it designs, and records your colors, fonts, and radii in DESIGN.md. Every frame uses those tokens. Frames are built with shadcn/ui instead of importing your app's components, and your agent moves the design into your components when you ship it.",
  },
  {
    q: "Which agents does Framio work with?",
    a: "framio init installs the skill in .claude/skills for Claude Code and .agents/skills for Codex. Other agents that read either folder, such as OpenCode, Cursor, Grok CLI, and Antigravity, can use it too.",
  },
  {
    q: "How fast is Framio?",
    a: "Measured with v0.0.7 on an Apple M4, framio start serves the canvas in about 0.6 seconds, and a saved frame rebuilds in about 100 milliseconds. The first framio init takes about 6 seconds while it downloads packages, and under half a second after that. The macOS download is 33 MB.",
  },
  {
    q: "Is Framio a Figma alternative?",
    a: "For developers who design with a coding agent, often yes. Framio has no drawing tools. Your agent writes the design as code, and you review it by clicking and commenting. If your team draws designs by hand, keep Figma for that.",
  },
  {
    q: "Is Framio related to Frame.io?",
    a: "No. Framio is an independent, open-source design canvas for coding agents. Frame.io is Adobe's video review platform.",
  },
  {
    q: "Does Framio change my app's code?",
    a: "Not while you design. Designs live in .framio/. When you pick one, ask your agent to build it in your app. It checks the result against the design with framio screenshot --url <app-url> --compare <page>/<frame>.",
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
    q: "How do I update Framio?",
    a: "Use the update control in the canvas or run framio upgrade. The canvas and CLI share downloads and progress. Download first, then install when you are ready and restart the project to use the new binary. Rollback is available with framio upgrade --rollback. Binary updates do not change your project's skills, dependencies, themes, or designs.",
  },
  {
    q: "Is Framio free?",
    a: "Yes. Framio is free and open source under the MIT license. It is one binary with no account or subscription, and you run the canvas on your own computer.",
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
    "Shared canvas and CLI updates with rollback",
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
