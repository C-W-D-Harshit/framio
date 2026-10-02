/** Reads pixel dimensions from PNG, JPEG, GIF, WebP and SVG headers without decoding the image. */
export function imageSize(
  buf: Uint8Array,
  ext: string,
): { width: number; height: number } | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  try {
    let size: { width: number; height: number } | null = null;
    const header = (start: number, end: number) =>
      String.fromCharCode(...buf.subarray(start, end));
    // Downloaded references can have a different encoding than their filename suggests.
    if (header(0, 8) === "\x89PNG\r\n\x1a\n")
      size = { width: view.getUint32(16), height: view.getUint32(20) };
    else if (/^GIF8[79]a$/.test(header(0, 6)))
      size = {
        width: view.getUint16(6, true),
        height: view.getUint16(8, true),
      };
    else if (header(0, 2) === "\xff\xd8") size = jpegSize(view);
    else if (header(0, 4) === "RIFF" && header(8, 12) === "WEBP")
      size = webpSize(view);
    else if (ext === "svg")
      size = svgSize(new TextDecoder().decode(buf.subarray(0, 4096)));
    if (
      size &&
      Number.isFinite(size.width) &&
      Number.isFinite(size.height) &&
      size.width > 0 &&
      size.height > 0
    )
      return size;
  } catch {}
  return null;
}

function jpegSize(view: DataView) {
  let offset = 2;
  while (offset < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;
    const marker = view.getUint8(offset + 1);
    const length = view.getUint16(offset + 2);
    // SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    )
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    offset += 2 + length;
  }
  return null;
}

function webpSize(view: DataView) {
  const chunk = String.fromCharCode(
    ...[12, 13, 14, 15].map((i) => view.getUint8(i)),
  );
  if (chunk === "VP8 ")
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    const w =
      view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16);
    const h =
      view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16);
    return { width: w + 1, height: h + 1 };
  }
  return null;
}

function svgSize(text: string) {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const attr = (name: string) =>
    new RegExp(`\\b${name}\\s*=\\s*["']([\\d.]+)(px)?["']`, "i").exec(tag)?.[1];
  const w = Number(attr("width"));
  const h = Number(attr("height"));
  if (w && h) return { width: w, height: h };
  const box = /\bviewBox\s*=\s*["']([^"']+)["']/i
    .exec(tag)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  return box?.length === 4 && box.every(Number.isFinite)
    ? { width: box[2]!, height: box[3]! }
    : null;
}
