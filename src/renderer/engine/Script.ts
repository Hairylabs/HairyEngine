import * as THREE from 'three';
import { Input } from './Input';
import { Scene } from './Scene';

// A Script is a behaviour attached to an Object3D. Lifecycle:
//   constructor(ctx) — params/state init
//   start()         — called once when Play Mode begins (or when script
//                     is attached during play)
//   update(dt)      — called every frame in Play Mode
//   stop()          — called when Play Mode ends or script is removed
//
// Attached scripts live in obj.userData.__scripts as an array of descriptors
// so they round-trip through Scene serialization. The actual script instances
// live in ScriptSystem and are torn down on Stop.

export interface ScriptCtx {
  owner: THREE.Object3D;
  scene: Scene;
  input: Input;
  camera: THREE.PerspectiveCamera;
}

export interface ScriptDescriptor {
  type: string;                            // registered script name
  params?: Record<string, unknown>;
  // Renderable schema info so the Inspector can build a form. Set by registry.
}

export interface ScriptParamDef {
  key: string;
  label: string;
  kind: 'number' | 'string' | 'boolean' | 'vector3';
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
}

export type ScriptCategory =
  | 'Behavior'   // movement, rotation, lock-on, AI
  | 'Paint'      // PaintShooter / PaintImpact / paintball-specific
  | 'Camera'     // MainCamera / FollowCamera / orbit cameras
  | 'Audio'      // listener / source
  | 'Physics'    // Rigidbody
  | 'Player'     // CharacterController / PlayerController / Shooter / Crosshair
  | 'Animation'  // AnimationPlayer / AttachToBone
  | 'FX'         // ParticleEmitter
  | 'User';      // user-defined scripts

export interface ScriptDefinition {
  type: string;
  label: string;
  description: string;
  category?: ScriptCategory;
  params: ScriptParamDef[];
  create: (ctx: ScriptCtx, params: Record<string, unknown>) => Script;
}

export interface Script {
  start?(): void;
  update?(dt: number): void;
  stop?(): void;
}

const registry = new Map<string, ScriptDefinition>();

export function registerScript(def: ScriptDefinition) {
  registry.set(def.type, def);
}

export function getScriptDefinition(type: string): ScriptDefinition | undefined {
  return registry.get(type);
}

export function listScripts(): ScriptDefinition[] {
  return Array.from(registry.values());
}

// userData helpers — stored as plain JSON so they survive serialize/deserialize.

export function getScriptDescriptors(obj: THREE.Object3D): ScriptDescriptor[] {
  const arr = obj.userData.__scripts;
  return Array.isArray(arr) ? (arr as ScriptDescriptor[]) : [];
}

export function setScriptDescriptors(obj: THREE.Object3D, descriptors: ScriptDescriptor[]) {
  if (descriptors.length === 0) {
    delete obj.userData.__scripts;
  } else {
    obj.userData.__scripts = descriptors;
  }
}

export function addScriptDescriptor(obj: THREE.Object3D, descriptor: ScriptDescriptor) {
  const list = getScriptDescriptors(obj);
  list.push(descriptor);
  setScriptDescriptors(obj, list);
}

export function removeScriptDescriptor(obj: THREE.Object3D, index: number) {
  const list = getScriptDescriptors(obj);
  list.splice(index, 1);
  setScriptDescriptors(obj, list);
}
