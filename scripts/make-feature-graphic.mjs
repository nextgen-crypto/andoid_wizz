/**
 * Play feature graphic — 1024×500, generated from the icon's own sources.
 *
 *   npm run feature-graphic
 *
 * Output:
 *   assets/play/feature-graphic.png   Google Play "Feature graphic" asset
 *
 * The composition reuses the master launcher SVG as a rounded app tile and
 * echoes its chromatic violet/cyan split inside the wordmark, so the store
 * page and the home-screen icon read as one brand.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const W = 1024;
const H = 500;
const root = process.cwd();

// Same palette as assets/icons/wizz-icon.svg — deep violet-black gradient
// with the violet aura pulled left, behind the tile.
const backdrop = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#210D3C"/>
      <stop offset="0.55" stop-color="#130A22"/>
      <stop offset="1" stop-color="#0A0A0D"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#8B5CF6" stop-opacity="0.5"/>
      <stop offset="0.55" stop-color="#7C3AED" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#7C3AED" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <ellipse cx="330" cy="250" rx="430" ry="340" fill="url(#glow)"/>
</svg>`;

const TILE = 340;
const TILE_X = 150;
const TILE_Y = Math.round((H - TILE) / 2); // 80
const TILE_RADIUS = 76;

// Wordmark: one white word with violet/cyan copies nudged apart — the same
// chromatic split the W mark uses. Baseline-free (central) placement keeps
// it optically centered next to the tile.
const wordmark = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="128"
     font-weight="700" letter-spacing="14" dominant-baseline="central">
    <text x="561" y="253" fill="#8B5CF6" opacity="0.9">WIZZ</text>
    <text x="567" y="247" fill="#22D3EE" opacity="0.9">WIZZ</text>
    <text x="564" y="250" fill="#FFFFFF">WIZZ</text>
  </g>
</svg>`;

// Rasterize the master icon large, downsample, then round it into a tile.
const master = await readFile(join(root, "assets/icons/wizz-icon.svg"));
const iconBuf = await sharp(master, { density: 144 }).png().toBuffer();
const tile = await sharp(iconBuf)
  .resize(TILE, TILE, { kernel: "lanczos3" })
  .composite([
    {
      input: Buffer.from(
        `<svg width="${TILE}" height="${TILE}"><rect width="${TILE}" height="${TILE}" rx="${TILE_RADIUS}" fill="#fff"/></svg>`,
      ),
      blend: "dest-in",
    },
  ])
  .png()
  .toBuffer();

const outDir = join(root, "assets/play");
await mkdir(outDir, { recursive: true });

await sharp(Buffer.from(backdrop))
  .composite([
    { input: tile, top: TILE_Y, left: TILE_X },
    { input: Buffer.from(wordmark), top: 0, left: 0 },
  ])
  .png()
  .toFile(join(outDir, "feature-graphic.png"));

console.log("assets/play/feature-graphic.png (1024x500)");
