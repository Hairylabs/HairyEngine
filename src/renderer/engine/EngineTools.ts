import * as THREE from 'three';
import { Scene } from './Scene';
import { History as UndoHistory } from './History';
import { AddObjectCommand } from './Commands';
import {
  makeCube,
  makeSphere,
  makeCylinder,
  makePlane,
  makeTorus,
  makePointLight,
} from './Primitives';

// Renderer-side dispatchers for the engine-scoped tools Claude can call.
// Each tool returns a JSON-encoded result string that goes back to the model
// as a tool_result block.

const PRIMITIVE_FACTORIES: Record<string, () => THREE.Object3D> = {
  cube: makeCube,
  sphere: makeSphere,
  cylinder: makeCylinder,
  plane: makePlane,
  torus: makeTorus,
  point_light: makePointLight,
};

export function dispatchEngineTool(
  name: string,
  input: Record<string, unknown>,
  scene: Scene,
  history: UndoHistory,
): string {
  try {
    if (name === 'engine_add_primitive') {
      return engineAddPrimitive(input, scene, history);
    }
    if (name === 'engine_list_scene') {
      return engineListScene(scene);
    }
    return JSON.stringify({ error: `unknown tool: ${name}` });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

function engineAddPrimitive(
  input: Record<string, unknown>,
  scene: Scene,
  history: UndoHistory,
): string {
  const type = String(input.type ?? '');
  const factory = PRIMITIVE_FACTORIES[type];
  if (!factory) {
    return JSON.stringify({ error: `unknown primitive: ${type}` });
  }
  const obj = factory();
  if (input.name && typeof input.name === 'string') {
    obj.name = input.name;
  }
  if (Array.isArray(input.position) && input.position.length === 3) {
    const [x, y, z] = input.position as number[];
    obj.position.set(Number(x) || 0, Number(y) || 0, Number(z) || 0);
  }
  if (input.color && typeof input.color === 'string') {
    const mesh = obj as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
    if (mat && mat.color) {
      try {
        mat.color.set(input.color);
      } catch {
        // ignore bad color
      }
    }
  }
  history.push(new AddObjectCommand(scene, obj));
  return JSON.stringify({
    added: {
      name: obj.name,
      type: obj.type,
      position: [obj.position.x, obj.position.y, obj.position.z],
    },
  });
}

function engineListScene(scene: Scene): string {
  const roots = scene.editableRoots().map((obj) => ({
    name: obj.name || obj.type,
    type: obj.type,
    position: [
      Number(obj.position.x.toFixed(3)),
      Number(obj.position.y.toFixed(3)),
      Number(obj.position.z.toFixed(3)),
    ],
    rotation: [
      Number(obj.rotation.x.toFixed(3)),
      Number(obj.rotation.y.toFixed(3)),
      Number(obj.rotation.z.toFixed(3)),
    ],
    scale: [
      Number(obj.scale.x.toFixed(3)),
      Number(obj.scale.y.toFixed(3)),
      Number(obj.scale.z.toFixed(3)),
    ],
  }));
  return JSON.stringify({ object_count: roots.length, objects: roots });
}
