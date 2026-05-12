import * as THREE from 'three';

// Sprint 6 part 2 — face-cluster extrude that works on any indexed triangle
// mesh (BoxGeometry, RoundedBox, imported GLB, CSG output). Replaces the
// BoxGeometry-only path in FaceExtrude with a real topology operation.
//
// Approach (hand-rolled half-edge lite):
//   1. Normalize the input geometry to indexed positions (no UV/normal reuse).
//   2. Pick a starting triangle, compute its face normal.
//   3. Flood-fill across shared edges to find every coplanar neighbour
//      (same normal within an angular tolerance). This is the "flat face"
//      a user sees on a GLB they imported.
//   4. Find the boundary edges of that cluster — edges referenced by exactly
//      one cluster face.
//   5. To extrude by `distance`: clone each unique cluster vertex, offset
//      the clone by `normal * distance`, rewrite cluster face indices to use
//      the clones, then stitch two triangles per boundary edge between the
//      original ring and the offset ring.
//
// The result is a valid manifold extrude — the user can repeat it to keep
// growing, undo it cleanly, or sub-divide / boolean-op the result later.

export type Cluster = {
  faceIndices: number[]; // triangle indices that belong to the flat face
  normal: THREE.Vector3; // averaged outward normal in local space
  boundaryEdges: Array<[number, number]>; // pairs of vertex indices forming the cluster boundary
};

/** Bring `geom` into a canonical "indexed, position-only" form so face ops
 *  don't have to special-case UV/normal attribute strides. Returns the same
 *  geom if it already qualifies, otherwise a rebuilt one. */
export function canonicalizeForFaceOps(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = geom.clone();
  // Drop normals/uvs — we'll recompute normals after the edit.
  // Three keeps them as attributes; deletion is fine.
  if (out.attributes.normal) out.deleteAttribute('normal');
  if (out.attributes.uv) out.deleteAttribute('uv');
  if (!out.index) {
    // Non-indexed: build a simple sequential index.
    const pos = out.attributes.position;
    const idx = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; i++) idx[i] = i;
    out.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return out;
}

/** Compute the face normal for triangle `triIdx` in `geom` (assumed indexed). */
export function faceNormal(geom: THREE.BufferGeometry, triIdx: number): THREE.Vector3 {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index as THREE.BufferAttribute;
  const a = idx.getX(triIdx * 3);
  const b = idx.getX(triIdx * 3 + 1);
  const c = idx.getX(triIdx * 3 + 2);
  const va = new THREE.Vector3().fromBufferAttribute(pos, a);
  const vb = new THREE.Vector3().fromBufferAttribute(pos, b);
  const vc = new THREE.Vector3().fromBufferAttribute(pos, c);
  return new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(vb, va),
    new THREE.Vector3().subVectors(vc, va),
  ).normalize();
}

/** Build edge → triangle[] adjacency. Key uses min,max so undirected. */
function buildEdgeAdjacency(geom: THREE.BufferGeometry): Map<string, number[]> {
  const idx = geom.index as THREE.BufferAttribute;
  const triCount = idx.count / 3;
  const edges = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    const i0 = idx.getX(t * 3);
    const i1 = idx.getX(t * 3 + 1);
    const i2 = idx.getX(t * 3 + 2);
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]] as Array<[number, number]>) {
      const key = edgeKey(a, b);
      const list = edges.get(key);
      if (list) list.push(t);
      else edges.set(key, [t]);
    }
  }
  return edges;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** Flood-fill coplanar triangles starting from `seedTri`. `cosTolerance` is
 *  the dot-product threshold (e.g. 0.999 ≈ within 2.5°). */
export function findCoplanarCluster(
  geom: THREE.BufferGeometry,
  seedTri: number,
  cosTolerance = 0.995,
): Cluster {
  const idx = geom.index as THREE.BufferAttribute;
  const triCount = idx.count / 3;
  const seedN = faceNormal(geom, seedTri);
  const edgeAdj = buildEdgeAdjacency(geom);

  const visited = new Set<number>();
  const stack = [seedTri];
  const faces: number[] = [];

  while (stack.length > 0) {
    const t = stack.pop()!;
    if (visited.has(t)) continue;
    visited.add(t);
    const n = faceNormal(geom, t);
    if (n.dot(seedN) < cosTolerance) continue;
    faces.push(t);
    // Walk to neighbours across each of the three edges
    const i0 = idx.getX(t * 3);
    const i1 = idx.getX(t * 3 + 1);
    const i2 = idx.getX(t * 3 + 2);
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]] as Array<[number, number]>) {
      const neighbours = edgeAdj.get(edgeKey(a, b)) ?? [];
      for (const nb of neighbours) {
        if (!visited.has(nb) && nb !== t && nb < triCount) stack.push(nb);
      }
    }
  }

  // Boundary edges = edges where exactly one of the two adjacent triangles
  // is in the cluster.
  const inCluster = new Set(faces);
  const boundary: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (const t of faces) {
    const i0 = idx.getX(t * 3);
    const i1 = idx.getX(t * 3 + 1);
    const i2 = idx.getX(t * 3 + 2);
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]] as Array<[number, number]>) {
      const k = edgeKey(a, b);
      if (seen.has(k)) continue;
      const neighbours = edgeAdj.get(k) ?? [];
      const clusterCount = neighbours.filter((n) => inCluster.has(n)).length;
      if (clusterCount === 1) {
        // Preserve direction so we can sew triangles with consistent winding.
        // We use the order seen in this triangle.
        boundary.push([a, b]);
      }
      seen.add(k);
    }
  }

  return { faceIndices: faces, normal: seedN.clone(), boundaryEdges: boundary };
}

/** Extrude cluster by `distance` along the cluster normal (local space).
 *  Mutates `mesh.geometry` in place. Returns true on success. */
export function extrudeCluster(
  mesh: THREE.Mesh,
  cluster: Cluster,
  distance: number,
): boolean {
  const oldGeom = mesh.geometry;
  const geom = canonicalizeForFaceOps(oldGeom);
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index as THREE.BufferAttribute;

  // Collect every unique vertex index referenced by cluster triangles.
  const clusterVerts = new Set<number>();
  for (const t of cluster.faceIndices) {
    clusterVerts.add(idx.getX(t * 3));
    clusterVerts.add(idx.getX(t * 3 + 1));
    clusterVerts.add(idx.getX(t * 3 + 2));
  }

  // Allocate one duplicate vertex per cluster vertex, offset along normal.
  // Mapping: old vertex index → new vertex index (top ring).
  const topMap = new Map<number, number>();
  const newPositions: number[] = [];
  // We'll append to the existing position attribute, so seed with originals.
  const baseCount = pos.count;
  for (let i = 0; i < baseCount; i++) {
    newPositions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  const n = cluster.normal;
  let nextIdx = baseCount;
  for (const v of clusterVerts) {
    const x = pos.getX(v) + n.x * distance;
    const y = pos.getY(v) + n.y * distance;
    const z = pos.getZ(v) + n.z * distance;
    newPositions.push(x, y, z);
    topMap.set(v, nextIdx++);
  }

  // Rewrite cluster faces to use top-ring indices.
  const newIndices: number[] = [];
  const clusterSet = new Set(cluster.faceIndices);
  const triCount = idx.count / 3;
  for (let t = 0; t < triCount; t++) {
    const a = idx.getX(t * 3);
    const b = idx.getX(t * 3 + 1);
    const c = idx.getX(t * 3 + 2);
    if (clusterSet.has(t)) {
      newIndices.push(topMap.get(a)!, topMap.get(b)!, topMap.get(c)!);
    } else {
      newIndices.push(a, b, c);
    }
  }

  // Stitch side quads: for each boundary edge (a,b), the original edge stays
  // on the bottom ring, the corresponding top edge is (top(a), top(b)).
  // Two triangles per quad, winding chosen so the outward normal of the
  // side face points away from the cluster centroid.
  for (const [a, b] of cluster.boundaryEdges) {
    const tA = topMap.get(a)!;
    const tB = topMap.get(b)!;
    // Winding: bottom-a → top-a → top-b, then bottom-a → top-b → bottom-b
    newIndices.push(a, tA, tB);
    newIndices.push(a, tB, b);
  }

  // Build the new geometry.
  const out = new THREE.BufferGeometry();
  out.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(newPositions, 3),
  );
  out.setIndex(newIndices);
  out.computeVertexNormals();

  // Hand off and dispose old.
  mesh.geometry = out;
  oldGeom.dispose();
  // Drop any BoxGeometry "parameters" cache — geometry is no longer a primitive.
  delete (mesh.geometry as { parameters?: unknown }).parameters;
  return true;
}

/** Snapshot just enough state to undo an extrude — we store the entire
 *  position+index arrays since cluster ops permute everything. */
export type GeomSnapshot = {
  positions: Float32Array;
  indices: Uint32Array | Uint16Array;
};

export function snapshotGeometry(geom: THREE.BufferGeometry): GeomSnapshot {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index as THREE.BufferAttribute;
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  const indices = idx.count < 65536
    ? new Uint16Array(idx.count)
    : new Uint32Array(idx.count);
  for (let i = 0; i < idx.count; i++) indices[i] = idx.getX(i);
  return { positions, indices };
}

export function restoreGeometry(mesh: THREE.Mesh, snap: GeomSnapshot) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(snap.positions, 3));
  g.setIndex(new THREE.BufferAttribute(snap.indices, 1));
  g.computeVertexNormals();
  mesh.geometry.dispose();
  mesh.geometry = g;
}
