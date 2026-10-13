/** Regenerate PHASM's social preview and touch icon with `node scripts/generate-brand-assets.mjs`. */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const mark = await readFile(new URL("public/brand-mark.svg", root), "utf8");
const markBody = mark.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const gold = "#c2ad7c";
const embeddedMark = (x, y, size) =>
  `<g transform="translate(${x} ${y}) scale(${size / 64})" fill="none" stroke="${gold}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${markBody}</g>`;

// Only raster output is served. The serif is a standard, locally installed face;
// there are no remote image, font, or rendering requests in this generator.
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="atmosphere" cx="50%" cy="38%" r="70%">
      <stop stop-color="#23322b"/>
      <stop offset=".54" stop-color="#131d18"/>
      <stop offset="1" stop-color="#0b100e"/>
    </radialGradient>
    <linearGradient id="rules"><stop stop-color="${gold}" stop-opacity="0"/><stop offset=".5" stop-color="${gold}" stop-opacity=".58"/><stop offset="1" stop-color="${gold}" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#atmosphere)"/>
  <g fill="none" stroke="${gold}" opacity=".075" stroke-width="1">
    <circle cx="600" cy="271" r="347"/>
    <circle cx="600" cy="271" r="369"/>
    <circle cx="600" cy="271" r="460"/>
    <path d="M166 67C326 167 326 463 166 563M1034 67C874 167 874 463 1034 563"/>
    <path d="M90 315h200M910 315h200M600 16v42M600 568v46"/>
  </g>
  <rect x="24.5" y="24.5" width="1151" height="581" fill="none" stroke="${gold}" stroke-opacity=".25"/>
  <g stroke="${gold}" stroke-width="1" fill="none" opacity=".72">
    <path d="M24 64V24h40M1136 24h40v40M24 566v40h40M1136 606h40v-40"/>
    <path d="m80 305 6 10-6 10-6-10 6-10Zm1040 0 6 10-6 10-6-10 6-10Z"/>
  </g>
  <text x="600" y="76" text-anchor="middle" fill="#b1ad9c" font-family="sans-serif" font-size="15" letter-spacing="5">A FIELD GUIDE TO THE UNEXPLAINED</text>
  ${embeddedMark(507, 102, 186)}
  <text x="608" y="399" text-anchor="middle" fill="#eee8d8" font-family="Nimbus Roman, Georgia, serif" font-size="108" letter-spacing="14">PHASM</text>
  <text x="603" y="450" text-anchor="middle" fill="${gold}" font-family="sans-serif" font-size="23" letter-spacing="6">THE HAUNTED ATLAS</text>
  <path d="M220 489H980" stroke="url(#rules)"/>
  <text x="600" y="538" text-anchor="middle" fill="#c4c8bc" font-family="sans-serif" font-size="23" letter-spacing=".6">Haunted places. Histories. Ghost stories.</text>
</svg>`;

await sharp(Buffer.from(card))
  .png({ compressionLevel: 9 })
  .toFile(fileURLToPath(new URL("public/images/phasm-social.png", root)));

const touch = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="#101714"/>${embeddedMark(24, 24, 132)}</svg>`;
await sharp(Buffer.from(touch))
  .png({ compressionLevel: 9 })
  .toFile(fileURLToPath(new URL("public/apple-touch-icon.png", root)));
console.log(
  "Generated phasm-social.png (1200×630) and apple-touch-icon.png (180×180).",
);
