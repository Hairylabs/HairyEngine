# Sprint 6 — Real Face-Extrude (research synthesis)

Captures what 4 parallel research agents found about how Blender / Wings3D / ProBuilder / Unreal Modeling implement mesh editing, and the concrete plan to port the workable subset into HairyEngine.

---

## Conclusions

### 1. Data structure

Use **half-edge DCEL**, not Blender's BMesh (BMesh is 100k+ LOC and deeply coupled to Blender's memory pools / customdata layers — months to port). Half-edge is sufficient for extrude/inset/loop-cut on a paintball arena. Skip n-gon support; quads + tris is enough.

### 2. Library: `mda` (YCAMInterlab/mda.js)

- **Apache-2.0**, npm name `mda`
- The **only** mature JS library that ships a working `ExtrudeOperator` — every other half-edge lib is read-only
- Plain JS, no TypeScript types — write a 50-line ambient `mda.d.ts`
- Not Three-aware — write a 30-line `BufferGeometry ↔ mda.Mesh` bridge
- ~40–60 KB minified including its `cga` / `gl-matrix@2` / `guf` deps
- Last commit is old, but the surface is small and vendorable

Combine with:
- **`erasta/three-halfedge-dcel`** (MIT) — cherry-pick its BufferGeometry-to-DCEL build code if mda's is messy
- **`three-bvh-csg`** — already installed, keep for door/window subtract (different role: booleans, not topology)
- **`three-mesh-bvh`** — already installed transitively, use for fast face-picking under the cursor

Skip:
- **Manifold** — overkill for blockout (only needed for 3D-print-grade output)
- **MeshLab** — wrong domain (processing/repair) + GPL3 viral
- **geometry-processing-js** — academic; Laplacians/Poisson, not edit operators
- **three.js `ExtrudeGeometry`** — wrong abstraction (extrudes 2D shapes along paths)

### 3. Algorithm (from Blender's `bmo_extrude.cc`)

Region extrude on a set of selected faces:

```
function extrudeRegion(mesh, selectedFaces, distance):
  // 1. boundary classification
  boundaryEdges = []
  for f in selectedFaces:
    for he in f.loop():
      if he.twin.face not in selectedFaces:
        boundaryEdges.push(he)

  // 2. average normal
  n = sum(f.normal * f.area for f in selectedFaces).normalize()

  // 3. duplicate verts touched by selection
  vmap = new Map()
  for f in selectedFaces:
    for he in f.loop():
      if !vmap.has(he.vertex):
        vmap.set(he.vertex, mesh.addVertex(he.vertex.pos.clone()))

  // 4. duplicate faces using new verts
  newFaces = selectedFaces.map(f =>
    mesh.addFace(f.loop().map(he => vmap.get(he.vertex))))

  // 5. side quads from boundary edges
  for he in boundaryEdges:
    a = he.vertex; b = he.next.vertex
    mesh.addFace([a, b, vmap.get(b), vmap.get(a)])

  // 6. remove originals
  for f in selectedFaces: mesh.removeFace(f)
  selectedFaces = newFaces

  // 7. translate new verts (driven by modal widget)
  for v in vmap.values(): v.pos.addScaledVector(n, distance)

  mesh.toBufferGeometry()
```

Inset is "scale boundary verts inward by bisector" — 30 lines after extrude works.
Bevel is 2+ weeks — skip for paintball.

### 4. UX (synthesis of Blender / ProBuilder / UE5 / Maya / Wings3D, filtered for dyslexia)

**Selection mode toggle:**
- 4 large color-coded icon buttons (Object · Vertex · Edge · Face) in a dedicated row.
- Active mode has thick outline + tinted background.
- Number keys 1/2/3/4 are *accelerators*, not primary affordance. NEVER Tab-cycling (cognitive state machine = bad for dyslexia).
- Cursor changes shape per mode.

**Face hover/select:**
- Hover: **cyan translucent fill (alpha 0.35) + cyan 2px outline**. Use *both* — fill alone too subtle, outline alone reads as edge select.
- Selected: **orange fill + orange outline**.
- No center dots (too small to read).

**Extrude widget:**
- One **fat colored arrow along the face normal** (Unreal-style, NOT tri-axis).
- Hover state: yellow.
- Anchored at selected face centroid.
- **Inline numeric chip** floating next to the arrow with `+ / − / type` controls. Show the distance in meters live.

**Modal drag flow (skip Blender's E-then-Esc footgun):**
- Pointer-down on the arrow → enter modal preview.
- Pointer-move → ghost preview only (no real geometry until drag > 0.05m).
- Pointer-up → commit, run `mesh.computeVertexNormals()`, snap to grid, undo entry recorded.
- ESC → cancel, no geometry created.

**Constraints:**
- Hold Ctrl for grid-snap distance.
- Numeric chip overrides drag distance when typed.

**Three.js implementation hooks:**
- `raycaster.intersectObjects([mesh])[0].faceIndex` since r125 — gives the triangle hit.
- Pre-bake a `geometry.userData.quadGroups: Int32Array` per mesh so hovering one triangle highlights its entire logical quad/ngon. Built once on mesh import; updated after each edit.
- Snapshot `geometry.attributes.position.array` into a `Float32Array` for the undo stack before each commit (avoids re-running the whole extrude on undo).
- Cache the `mda.Mesh` on `obj.userData.halfedge` so successive operators on the same mesh don't rebuild the DCEL.

### 5. Effort estimate

| Day | Deliverable |
|---|---|
| 1 | `npm install mda` + write `halfedge-bridge.ts` (BufferGeometry ↔ mda.Mesh + ambient types) + face-mode toggle in toolbar |
| 2 | Face hover highlighting (raycast + quad-group lookup + overlay material) |
| 3 | Extrude arrow widget (Object3D + drag projection + ghost preview) |
| 4 | Commit flow + undo + edge cases (flipped normals, near-zero drag) |
| 5 | Numeric chip + Ctrl-snap + polish |

After that: inset is ~1 more day, bevel is 2+ weeks (skip).

---

## Sources

- Blender source: `bmo_extrude.cc`, `editmesh_extrude.cc`, `bmesh_class.h` — projects.blender.org/blender/blender
- Wings3D: https://github.com/dgud/wings — wings/src/wings_extrude_face.erl, wings_inset.erl
- mda.js: https://github.com/YCAMInterlab/mda.js, npm `mda` v1.1.0
- three-mesh-halfedge: https://github.com/LokiResearch/three-mesh-halfedge
- three-halfedge-dcel: https://github.com/erasta/three-halfedge-dcel
- three-bvh-csg: https://github.com/gkjohnson/three-bvh-csg
- three-mesh-bvh: https://github.com/gkjohnson/three-mesh-bvh
- ProBuilder docs: docs.unity3d.com/Packages/com.unity.probuilder@6.0/manual/Face_Extrude.html
- UE5 Modeling Mode: dev.epicgames.com/documentation/en-us/unreal-engine/modeling-mode-quick-start-in-unreal-engine
- Crisalix engineering blog on half-edges in Three.js: engineering.crisalix.com/articles/half-edges/
