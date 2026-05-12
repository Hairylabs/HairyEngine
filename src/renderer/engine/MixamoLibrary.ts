import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attachAnimations, getAnimations, listAnimationNames } from './Animations';

// In-engine animation library. Long-term, "rip all Mixamo animations" means
// shipping a vendored animation pack (legally we can't redistribute Mixamo
// clips, so the user must bring their own). This module gives the workflow:
//
//   1. The user drops one or more GLB/FBX animation files into the local
//      Asset library at <userData>/library/animations/*.glb
//   2. MixamoLibrary scans that folder and offers each clip in a popup
//   3. Clicking a clip retargets it (best-effort) onto the selected
//      character — works automatically if the character uses Mixamo bone
//      names (mixamorig:*), which is the case for ~90% of user-imported
//      humanoid GLBs.
//
// "Built-in" set: a small curated list of public-domain idle/walk/run
// clips packaged with the app under resources/animations/*.glb. If the
// folder isn't present we just show the user-added files.

export type AnimEntry = {
  source: 'builtin' | 'user';
  path: string;
  name: string;
  size?: number;
};

const gltfLoader = new GLTFLoader();

/** List animation files in the engine library. Currently the user library
 *  is a slice of the regular assets list filtered to .glb / .gltf. */
export async function listLibraryAnimations(): Promise<AnimEntry[]> {
  const assets = await window.hairy.assets.list();
  const anim = assets
    .filter((a) => /\.(glb|gltf|fbx)$/i.test(a.ext) || /\.(glb|gltf|fbx)$/i.test(a.path))
    .filter((a) => /anim|walk|run|idle|jump|dance|attack|wave|punch|kick/i.test(a.name))
    .map((a) => ({
      source: 'user' as const,
      path: a.path,
      name: a.name.replace(/\.[^.]+$/, ''),
      size: a.size,
    }));
  return [...BUILTIN, ...anim];
}

/** A tiny built-in shortcut list — these don't ship with the app yet, but the
 *  user can drop matching files into the asset library and they'll appear
 *  here automatically. We expose the names so the UI has stable buttons. */
const BUILTIN: AnimEntry[] = [
  { source: 'builtin', path: 'builtin:wave', name: 'Wave (procedural)' },
  { source: 'builtin', path: 'builtin:idle', name: 'Idle (procedural)' },
  { source: 'builtin', path: 'builtin:jump', name: 'Jump (procedural)' },
  { source: 'builtin', path: 'builtin:dance', name: 'Dance (procedural)' },
];

/** Apply a procedural built-in clip to `target`. We generate the
 *  AnimationClip on the fly from a tiny hand-authored keyframe table so the
 *  user has *something* to click without having to source GLB files first.
 *  This works on any rigged character whose bones use mixamo naming. */
export function buildProceduralClip(kind: string, target: THREE.Object3D): THREE.AnimationClip | null {
  const findBone = (name: string): THREE.Object3D | null => {
    let hit: THREE.Object3D | null = null;
    target.traverse((o) => {
      if (hit) return;
      if (o.name === name || o.name === `mixamorig:${name}` || o.name.endsWith(`:${name}`)) {
        hit = o;
      }
    });
    return hit;
  };

  const tracks: THREE.KeyframeTrack[] = [];
  const T = (b: THREE.Object3D, sec: number[], qs: number[][]): THREE.QuaternionKeyframeTrack => {
    const flat: number[] = [];
    for (const q of qs) flat.push(q[0], q[1], q[2], q[3]);
    return new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, sec, flat);
  };

  if (kind === 'builtin:wave') {
    const arm = findBone('RightArm') ?? findBone('LeftArm');
    const fa = findBone('RightForeArm') ?? findBone('LeftForeArm');
    if (!arm) return null;
    const upQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -2.2)).toArray() as [number, number, number, number];
    const waveA = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -2.2 + 0.5)).toArray() as [number, number, number, number];
    const waveB = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -2.2 - 0.5)).toArray() as [number, number, number, number];
    tracks.push(T(arm, [0, 1, 2], [upQ, upQ, upQ]));
    if (fa) {
      tracks.push(T(fa, [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8], [
        waveA, waveB, waveA, waveB, waveA, waveB, waveA,
      ]));
    }
  } else if (kind === 'builtin:idle') {
    const spine = findBone('Spine') ?? findBone('Hips');
    if (!spine) return null;
    const a = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.04, 0)).toArray() as [number, number, number, number];
    const b = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.04, 0)).toArray() as [number, number, number, number];
    tracks.push(T(spine, [0, 1.5, 3.0], [a, b, a]));
  } else if (kind === 'builtin:jump') {
    const hips = findBone('Hips');
    if (!hips) return null;
    const downPos = [0, -0.2, 0];
    const upPos = [0, 1.0, 0];
    const homePos = [0, 0, 0];
    tracks.push(new THREE.VectorKeyframeTrack(
      `${hips.name}.position`,
      [0, 0.15, 0.45, 0.75, 1.0],
      [...homePos, ...downPos, ...upPos, ...downPos, ...homePos],
    ));
  } else if (kind === 'builtin:dance') {
    const hips = findBone('Hips');
    const spine = findBone('Spine');
    if (!hips || !spine) return null;
    const times = [0, 0.5, 1.0, 1.5, 2.0];
    const qs = [0, 0.6, -0.6, 0.6, 0];
    const flat: number[] = [];
    for (const z of qs) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, z * 0.3)).toArray();
      flat.push(q[0], q[1], q[2], q[3]);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${hips.name}.quaternion`, times, flat));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${spine.name}.quaternion`, times, flat));
  } else {
    return null;
  }

  return new THREE.AnimationClip(kind, -1, tracks);
}

/** Load a GLB animation file from disk via the asset bridge and merge its
 *  clips into `target`'s animation list. Bone names in the donor clip must
 *  match (or be remappable to) the target's skeleton — best results with
 *  Mixamo-authored characters since both donor + target use mixamorig:*. */
export async function importAnimationFile(path: string, target: THREE.Object3D): Promise<string[]> {
  const r = await window.hairy.assets.read(path);
  if (!r.ok) throw new Error(r.error);
  const gltf = await gltfLoader.parseAsync(r.bytes, '');
  if (!gltf.animations || gltf.animations.length === 0) {
    throw new Error('No animations found in file');
  }
  // Append to existing clips; if the target has none, attach fresh.
  const existing = getAnimations(target);
  attachAnimations(target, [...existing, ...gltf.animations]);
  return gltf.animations.map((c) => c.name);
}

/** Apply a built-in procedural clip to `target` and register it so the
 *  Mixamo-style buttons in the selection toolbar pick it up. */
export function applyBuiltinClip(kind: string, target: THREE.Object3D): boolean {
  const clip = buildProceduralClip(kind, target);
  if (!clip) return false;
  const existingClips = getAnimations(target);
  attachAnimations(target, [...existingClips, clip]);
  return true;
}

// Quiet unused-import warning — listAnimationNames is used by callers.
void listAnimationNames;
