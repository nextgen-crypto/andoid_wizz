import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import archiver from "archiver";

/**
 * Publish the Capacitor web bundle as a self-hosted live update.
 *
 * The bundle and a small manifest are uploaded to the existing Supabase
 * Storage project. Installed APKs poll the manifest and switch to the new web
 * bundle on their next launch; native code changes still require a store
 * release.
 */

const BUCKET = "app-bundles";
const WEB_DIR = resolve("app-dist");

function required(name, value) {
  if (!value) throw new Error(`Missing ${name} (check .env)`);
  return value;
}

const supabaseUrl = required(
  "SUPABASE_URL",
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
).replace(/\/$/, "");
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!existsSync(join(WEB_DIR, "index.html"))) {
  throw new Error(`No app bundle found at ${WEB_DIR}. Run npm run build:app first.`);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
};

async function ensureBucket() {
  const body = JSON.stringify({
    id: BUCKET,
    name: BUCKET,
    public: true,
    file_size_limit: 52_428_800,
    allowed_mime_types: ["application/zip", "application/json"],
  });
  const create = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body,
  });
  if (create.ok) return;
  if (create.status !== 409) {
    throw new Error(`Could not create ${BUCKET} bucket: ${await create.text()}`);
  }
  // Bucket already exists — make sure it stayed public.
  const update = await fetch(`${supabaseUrl}/storage/v1/bucket/${BUCKET}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      public: true,
      file_size_limit: 52_428_800,
      allowed_mime_types: ["application/zip", "application/json"],
    }),
  });
  if (!update.ok) {
    throw new Error(`Could not update ${BUCKET} bucket: ${await update.text()}`);
  }
}

async function uploadObject(path, body, contentType, cacheControl) {
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        "x-upsert": "true",
      },
      body,
    },
  );
  if (!response.ok) {
    throw new Error(`Upload failed for ${path}: ${await response.text()}`);
  }
}

function bundleId() {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
  let dirty = false;
  try {
    execFileSync("git", ["diff", "--quiet"], { stdio: "ignore" });
  } catch {
    dirty = true;
  }
  return `${sha}${dirty ? "-dirty" : ""}`;
}

function minNativeVersionCode() {
  if (process.env.LIVE_UPDATE_MIN_NATIVE_VERSION_CODE) {
    return Number(process.env.LIVE_UPDATE_MIN_NATIVE_VERSION_CODE);
  }
  try {
    const gradle = readFileSync(resolve("android/app/build.gradle"), "utf8");
    const match = gradle.match(/versionCode\s+(\d+)/);
    if (match) return Number(match[1]);
  } catch {
    // The script can run outside a full Android checkout.
  }
  return 1;
}

async function zipAppBundle(id) {
  const zipPath = join(tmpdir(), `wizz-live-${id}.zip`);
  await new Promise((resolvePromise, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolvePromise);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(WEB_DIR, false);
    void archive.finalize();
  });
  const zip = readFileSync(zipPath);
  return {
    zip,
    checksum: createHash("sha256").update(zip).digest("hex"),
  };
}

const id = bundleId();
const { zip, checksum } = await zipAppBundle(id);
const zipName = `wizz-${id}.zip`;
const downloadUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${zipName}`;
const manifest = {
  bundleId: id,
  url: downloadUrl,
  checksum,
  minNativeVersionCode: minNativeVersionCode(),
  releasedAt: new Date().toISOString(),
};

await ensureBucket();
await uploadObject(
  zipName,
  zip,
  "application/zip",
  "public, max-age=31536000, immutable",
);
await uploadObject(
  "manifest.json",
  JSON.stringify(manifest, null, 2),
  "application/json",
  "no-cache",
);

console.log(`Published live update ${id}`);
console.log(`Manifest: ${supabaseUrl}/storage/v1/object/public/${BUCKET}/manifest.json`);
console.log(`Bundle:   ${downloadUrl}`);
