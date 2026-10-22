/**
 * Regenerate every raster icon from the master SVGs in assets/icons/.
 *
 *   npm run icons
 *
 * Sources of truth:
 *   assets/icons/wizz-icon.svg            full-bleed square (legacy launchers
 *                                         apply their own mask, and the Play
 *                                         Console listing icon is this file)
 *   assets/icons/wizz-icon-foreground.svg transparent adaptive layer, mark
 *                                         scaled into the 66/108dp safe zone
 *
 * Outputs:
 *   android/.../mipmap-[density]/ic_launcher.png        legacy square  (48dp * scale)
 *   android/.../mipmap-[density]/ic_launcher_round.png  legacy circle  (48dp * scale)
 *   android/.../mipmap-[density]/ic_launcher_foreground.png  adaptive fg (108dp * scale)
 *   public/icon-512.png, public/icon-192.png      web / Play listing assets
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const master = await readFile(join(root, "assets/icons/wizz-icon.svg"));
const foreground = await readFile(join(root, "assets/icons/wizz-icon-foreground.svg"));

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const LAUNCHER_DP = 48;
const FOREGROUND_DP = 108;
// Rasterize at 1024px regardless of target, then downsample: lanczos keeps
// the mitred W tips sharp instead of letting them alias at small sizes.
const RENDER_DENSITY = 144;

async function rasterize(svg, px) {
  const buf = await sharp(svg, { density: RENDER_DENSITY }).png().toBuffer();
  return sharp(buf).resize(px, px, { kernel: "lanczos3" }).png().toBuffer();
}

async function circleMask(buf, px) {
  const circle = Buffer.from(
    `<svg width="${px}" height="${px}"><circle cx="${px / 2}" cy="${px / 2}" r="${px / 2}" fill="#fff"/></svg>`,
  );
  return sharp(buf)
    .composite([{ input: circle, blend: "dest-in" }])
    .png()
    .toBuffer();
}

for (const [name, scale] of Object.entries(DENSITIES)) {
  const dir = join(root, "android/app/src/main/res", `mipmap-${name}`);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const launcherPx = Math.round(LAUNCHER_DP * scale);
  const foregroundPx = Math.round(FOREGROUND_DP * scale);

  const square = await rasterize(master, launcherPx);
  await writeFile(join(dir, "ic_launcher.png"), square);
  await writeFile(join(dir, "ic_launcher_round.png"), await circleMask(square, launcherPx));
  await writeFile(
    join(dir, "ic_launcher_foreground.png"),
    await rasterize(foreground, foregroundPx),
  );
  console.log(`mipmap-${name}: ${launcherPx}px launcher, ${foregroundPx}px foreground`);
}

await writeFile(join(root, "public/icon-512.png"), await rasterize(master, 512));
await writeFile(join(root, "public/icon-192.png"), await rasterize(master, 192));
console.log("public/icon-512.png, public/icon-192.png");

// android/ is gitignored (the native shell is rebuilt locally), so the icon
// wiring lives here too: `npx cap add android && npm run icons` must restore
// a complete, correctly-wired launcher — not Capacitor's template art.
const resDir = join(root, "android/app/src/main/res");
if (existsSync(resDir)) {
  // Both mask shapes share one foreground layer; only the legacy PNGs differ.
  const adaptiveIcon = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  const backgroundShape = `<?xml version="1.0" encoding="utf-8"?>
<!-- Adaptive-icon background: the same deep violet-to-black ramp the icon
     artwork is baked with, so legacy and adaptive render identically. -->
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <gradient
        android:angle="45"
        android:centerColor="#130A22"
        android:endColor="#0A0A0D"
        android:startColor="#210D3C" />
</shape>
`;
  const backgroundColor = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Flat stand-in for the gradient drawable; matches its mid stop. -->
    <color name="ic_launcher_background">#130A22</color>
</resources>
`;
  // Vector twin of the adaptive foreground (scaled into the 66/108dp safe
  // zone) for tools that reference the drawable form instead of the PNGs.
  const points = "M32.13,38.35 L43.37,67.21 L54,43.52 L64.63,67.21 L75.26,38.35";
  const stroke = (color, extra = "") => `    <path
        android:pathData="${points}"
        android:strokeColor="${color}"
        android:strokeLineJoin="miter"
        android:strokeMiterLimit="12"
        android:strokeWidth="11.24"${extra} />
`;
  const foregroundVector = `<?xml version="1.0" encoding="utf-8"?>
<!-- Fallback foreground (pre-API-26 tools reference the vector form).
     Same crown-cut W as assets/icons/wizz-icon-foreground.svg, scaled into
     the 66/108dp safe zone; chromatic violet/cyan split around a white core. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group android:translateX="-1.06" android:translateY="1.06">
${stroke(
  "#8B5CF6",
  `
        android:strokeAlpha="0.9"`,
)}
    </group>
    <group android:translateX="1.06" android:translateY="-1.06">
${stroke(
  "#22D3EE",
  `
        android:strokeAlpha="0.9"`,
)}
    </group>
${stroke("#FFFFFF")}</vector>
`;

  const files = new Map([
    [join(resDir, "mipmap-anydpi-v26/ic_launcher.xml"), adaptiveIcon],
    [join(resDir, "mipmap-anydpi-v26/ic_launcher_round.xml"), adaptiveIcon],
    [join(resDir, "drawable/ic_launcher_background.xml"), backgroundShape],
    [join(resDir, "values/ic_launcher_background.xml"), backgroundColor],
    [join(resDir, "drawable-v24/ic_launcher_foreground.xml"), foregroundVector],
  ]);
  for (const [path, content] of files) {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
  console.log("adaptive icon XML wiring (android res)");
}
