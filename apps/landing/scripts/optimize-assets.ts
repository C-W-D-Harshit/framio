import sharp from "sharp";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const assets = fileURLToPath(new URL("../public/assets/", import.meta.url));
for (const name of [
  "hero-thread",
  "hero-thread-mobile",
  "crop-line-items",
  "step3-field",
  "step3-thread",
  "feat-responsive",
  "feat-layers",
]) {
  await sharp(join(assets, "landing", `${name}.png`))
    .webp({ lossless: true })
    .toFile(join(assets, "landing", `${name}.webp`));
}
const background = Buffer.from(
  `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="630" fill="#0A0A0B"/><rect x="248" y="50" width="80" height="30" rx="6" fill="#18181B" stroke="#3F3F46"/><text x="288" y="71" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#A1A1AA">Alpha</text><rect x="50" y="125" width="1100" height="455" rx="22" fill="#0C64FF"/></svg>`,
);
const wordmark = await sharp(
  join(assets, "brand", "framio-wordmark-on-dark.png"),
)
  .resize({ width: 180 })
  .toBuffer();
const studio = await sharp(join(assets, "landing", "hero-thread.png"))
  .resize({ width: 940, height: 411, fit: "cover", position: "top" })
  .toBuffer();
await sharp(background)
  .composite([
    { input: wordmark, left: 50, top: 38 },
    { input: studio, left: 130, top: 147 },
  ])
  .png()
  .toFile(join(assets, "brand", "framio-social.png"));

const githubAssets = fileURLToPath(
  new URL("../../../.github/assets/", import.meta.url),
);
const githubBackground = Buffer.from(
  `<svg width="1280" height="640" xmlns="http://www.w3.org/2000/svg"><rect width="1280" height="640" fill="#141416"/><rect x="575" y="444" width="130" height="44" rx="8" fill="#18181B" stroke="#3F3F46"/><text x="640" y="473" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#A1A1AA">Alpha</text></svg>`,
);
const githubWordmark = await sharp(
  join(githubAssets, "framio-wordmark-on-dark.png"),
)
  .resize({ width: 600 })
  .toBuffer();
await sharp(githubBackground)
  .composite([{ input: githubWordmark, left: 340, top: 228 }])
  .png()
  .toFile(join(githubAssets, "social-preview.png"));
