/**
 * Batch BVH -> VRMA converter for the ai-live3d pet.
 *
 * Conversion core: scripts/bvh-converter/ (from vrm-c/bvh2vrma, MIT License).
 *
 * Usage:
 *   node scripts/convert-bvh-to-vrma.cjs <inputDir> <outputDir>
 * Build:
 *   npx esbuild scripts/convert-bvh-to-vrma.ts --bundle --platform=node --format=cjs --outfile=scripts/convert-bvh-to-vrma.cjs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { convertBVHToVRMAnimation } from './bvh-converter/convertBVHToVRMAnimation.js';

// Node lacks FileReader; three's GLTFExporter GLB path needs it (binary output
// is assembled from blob.arrayBuffer() inside reader.onloadend).
if (typeof (globalThis as any).FileReader === 'undefined') {
  (globalThis as any).FileReader = class FileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: ((ev?: unknown) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf;
          this.onloadend?.({ target: this });
        })
        .catch((err) => this.onerror?.(err));
    }
    readAsDataURL(blob: Blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = `data:application/octet-stream;base64,${Buffer.from(buf).toString('base64')}`;
          this.onloadend?.({ target: this });
        })
        .catch((err) => this.onerror?.(err));
    }
  };
}

/**
 * BVH units vary between exporters (Mixamo = cm, some rigs = dm).
 * The root OFFSET y is the hips height (~1.0-1.2 m real world); use it to
 * pick the scale that maps the source units to meters.
 */
function guessScale(bvhText: string): number {
  const m = bvhText.match(/OFFSET\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/);
  if (m) {
    const rootY = Math.abs(parseFloat(m[2]));
    if (rootY >= 80) return 0.01; // cm
    if (rootY >= 8) return 0.1; // dm
  }
  return 0.01;
}

async function main() {
  const [inputDir, outputDir] = process.argv.slice(2);
  if (!inputDir || !outputDir) {
    console.error('Usage: node convert-bvh-to-vrma.cjs <inputDir> <outputDir>');
    process.exit(1);
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const files = fs
    .readdirSync(inputDir)
    .filter((f) => /\.bvh$/i.test(f))
    .sort();
  console.log(`${files.length} bvh files in ${inputDir}`);

  const loader = new BVHLoader();
  let ok = 0;
  let fail = 0;
  const failed: string[] = [];

  for (const file of files) {
    const src = path.join(inputDir, file);
    const dst = path.join(outputDir, file.replace(/\.bvh$/i, '.vrma'));
    try {
      const text = fs.readFileSync(src, 'utf8');
      const parsed = loader.parse(text);
      const scale = guessScale(text);
      const buffer = await convertBVHToVRMAnimation(parsed, { scale });
      fs.writeFileSync(dst, Buffer.from(buffer));
      ok++;
      console.log(`ok  ${file} (scale ${scale})`);
    } catch (err) {
      fail++;
      failed.push(file);
      console.log(`ERR ${file}: ${err?.message ?? err}`);
    }
  }

  console.log(`done: ${ok} converted, ${fail} failed`);
  if (failed.length > 0) {
    console.log('failed files:');
    for (const f of failed) console.log(`  ${f}`);
  }
  process.exit(0);
}

main();
