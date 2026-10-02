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
  `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="630" fill="#0A0A0B"/><rect x="50" y="125" width="1100" height="455" rx="22" fill="#0C64FF"/></svg>`,
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
