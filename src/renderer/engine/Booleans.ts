import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Wraps three-bvh-csg for the three operations a level designer actually uses:
// subtract (door/window cut), union (merge walls), and intersect (rare).
//
// The result inherits the target's material and replaces it in the scene at
// the same parent + transform. Cutter is removed (it was a stand-in object).

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];

export type BooleanOp = 'subtract' | 'union' | 'intersect';

function opCode(op: BooleanOp) {
  if (op === 'subtract') return SUBTRACTION;
  if (op === 'union') return ADDITION;
  return INTERSECTION;
}

// Apply op(target, cutter). Returns the new resulting Mesh. Caller is
// responsible for swapping it into the scene + removing the cutter.
export function applyBoolean(
  target: THREE.Mesh,
  cutter: THREE.Mesh,
  op: BooleanOp,
): THREE.Mesh {
  // Brushes need world-space geometry so the CSG math is correct.
  target.updateMatrixWorld(true);
  cutter.updateMatrixWorld(true);

  const targetBrush = new Brush(
    target.geometry.clone(),
    target.material as THREE.Material,
  );
  targetBrush.applyMatrix4(target.matrixWorld);
  targetBrush.updateMatrixWorld();

  const cutterBrush = new Brush(
    cutter.geometry.clone(),
    cutter.material as THREE.Material,
  );
  cutterBrush.applyMatrix4(cutter.matrixWorld);
  cutterBrush.updateMatrixWorld();

  const result = evaluator.evaluate(targetBrush, cutterBrush, opCode(op));

  // Bring the result back into target's local frame so the resulting mesh
  // keeps its position/rotation/scale.
  const invTarget = target.matrixWorld.clone().invert();
  result.geometry.applyMatrix4(invTarget);
  // Merge any tiny duplicate verts the CSG produced — common after a cut.
  try {
    result.geometry = mergeVertices(result.geometry, 1e-4);
  } catch {
    // mergeVertices is finicky on some geometries; non-fatal.
  }
  result.geometry.computeVertexNormals();

  const out = new THREE.Mesh(result.geometry, target.material);
  out.name = `${target.name}_${op}`;
  out.position.copy(target.position);
  out.quaternion.copy(target.quaternion);
  out.scale.copy(target.scale);
  out.castShadow = target.castShadow;
  out.receiveShadow = target.receiveShadow;
  return out;
}
