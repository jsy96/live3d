// Diagnostic: print what BVHLoader actually produces for a BVH file.
// Usage: node scripts/test-bvh-tracks.mjs <file.bvh>
import * as fs from 'node:fs';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

const loader = new BVHLoader();
const parsed = loader.parse(fs.readFileSync(process.argv[2], 'utf8'));

console.log('bone names (first 3):', parsed.skeleton.bones.slice(0, 3).map((b) => b.name));
console.log('hips local position:', parsed.skeleton.bones[0].position.toArray().map((v) => v.toFixed(3)));
console.log('track names (first 4):', parsed.clip.tracks.slice(0, 4).map((t) => t.name));
const posTrack = parsed.clip.tracks.find((t) => t.name.endsWith('.position'));
if (posTrack) {
  console.log('position track:', posTrack.name);
  console.log('first frame values:', posTrack.values.slice(0, 6).map((v) => v.toFixed(3)));
  console.log('duration:', parsed.clip.duration.toFixed(2), 's, frames:', posTrack.times.length);
}
