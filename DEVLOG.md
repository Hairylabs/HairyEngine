# HairyEngine Dev Log

Chronological log of meaningful changes. Reverse-chronological order at the top.

---

## 2026-05-12 — v0.0.3 released, auto-update live

- First release published to GitHub Releases (Hairylabs/HairyEngine). NSIS installer + portable .exe at <https://github.com/Hairylabs/HairyEngine/releases/tag/v0.0.3>.
- `app-update.yml` shipped inside the .exe has the fine-grained PAT embedded so installed clients can pull future versions automatically from the private repo.
- Repo seeded — initial commit `e62d87a` pushed to `master`.
- Bug fix: ❌ close buttons on the floating Claude / Blender chat panels weren't firing. Replaced the querySelectorAll wiring with explicit IDs and `e.stopPropagation()` to be defensive against any propagation interactions.

## 2026-05-12 — Strategic pivot to artist-first

**Goal locked**: a dyslexic artist with no coding background can build and ship a multiplayer web paintball game from scratch. UX is measured against that bar from now on.

Sent six research agents in parallel to map what other engines do well for non-coders. Findings:

- **Unity**: Starter Asset templates ship a fully playable character in 60s. Animator state graph is the gold standard for non-coder animation wiring. Mixamo Humanoid retargeting "just works". Unity 6's Multiplayer Center is a wizard that scaffolds packages; Multiplayer Play Mode spawns multiple Virtual Players for in-editor testing. Visual Scripting (Bolt) + PlayMaker FSMs are how non-coders write logic.
- **Godot**: One mental model — tree of nodes. Inspector-driven multiplayer (Spawner + Synchronizer with checkbox sync). AssetLib inside the editor for one-click installs. Visual AnimationTree with draggable blend pad.
- **Unreal**: Typed colored pins + execution wires for Blueprints. GameMode/PlayerController/Pawn/PlayerState forces a clean server-authoritative architecture. Quixel Bridge for one-click asset adds. **DO NOT** copy heavyweight replication — overkill for browser games.
- **JS engines / networking**: **Hathora shut down May 2026**. Use **Colyseus + geckos.io** (WebRTC/UDP) for fast paintball; geckos beats WebSockets because TCP head-of-line blocking ruins shooters. Edgegap free tier for hosting. Babylon's Node Particle Editor is the best JS visual VFX authoring story.
- **Animation pipeline**: **Ready Player Me shut down January 2026**. Mixamo is still the best free auto-rig + animations source. `SkeletonUtils.retargetClip` is **buggy** — don't retarget at runtime. Adopt the Mixamo skeleton as canonical, pre-bake animations in Blender via the MCP, ship clean per-clip GLBs. Attach-to-bone is trivial in Three.js (`hand.add(weapon)`).
- **Web3 / PulseChain**: PulseChain has no Alchemy/Infura/Moralis support — read NFTs directly via RPC. Use **viem + RainbowKit + wagmi** (not ethers). Race IPFS gateways for image loading. SIWE for auth, burner wallets for in-game tx, never custodial.

Architecture decisions that fall out of this:

- Multiplayer hot path: **geckos.io UDP** (transforms, aim, pellets at 20 Hz). Colyseus for room/match/score state.
- Animation: pre-bake everything to the Mixamo skeleton, ship per-clip GLBs.
- Player creation: one-click "FPS Player" template that creates character + controller + camera + crosshair + shooter + animator in one action. Mirrors Unity's Starter Assets.
- Web3: deferred until core gameplay works, then Wallet Connect button drops Ponks NFT images onto player heads.

**Today's deliverables**:
- 6 research agents launched + reports captured
- FBX import added (`FBXLoader` on drag-drop) — opens the Mixamo workflow
- DEVLOG.md (this file) + updated ROADMAP.md synthesizing findings
- git init + initial commit (push deferred until user finishes gh auth + PAT)
- Per-conversation memory: target user persona saved to memory

## 2026-05-12 — Scene cameras + chat relocation + Blender bridge

- Scene Camera primitive (Add menu) with CameraHelper frustum gizmo
- `MainCamera` marker script: first scene camera with this flag becomes the active camera in Play
- `FollowCamera` script: tracks a named target with offset + smoothing + optional look-at
- Camera helpers hidden during Play so they don't appear in the rendered frame
- Physics Cube + Physics Sphere primitives (Rigidbody pre-attached)
- Blender bridge: "⬇ Import from Blender (selected)" / "⬆ Send selection to Blender" buttons in the Blender panel. Uses `%TEMP%/hairyengine-bridge/` for GLB temp files; Blender side `bpy.ops.export_scene.gltf(...)`.
- Right panel back to Inspector-only. Both chat panels moved into **floating dropdowns** that anchor to header buttons (💬 Claude, 🤖 Blender). Esc closes them.

## 2026-05-12 — Roadmap sprint (HUD + particles + web export)

- HUD overlay (DOM layer above canvas, pointer-events pass through)
- `Crosshair` script (FPS reticle)
- `Shooter` script (left-click raycast with hit flash overlay)
- `ParticleEmitter` script (point sprites, cone spread, gravity)
- Web export pipeline: `npm run web:build` → `dist-web/` standalone bundle. Auto-plays a scene from `scene.json` if present.
- UI polish: header restructured, panel headers uppercase.

## 2026-05-12 — Engine systems (Play Mode, Scripts, Physics, Animation)

- `PlayState` with Play/Pause/Stop toolbar buttons; takes scene snapshot via `toJSON`, restores on Stop
- `Input` singleton (keyboard, mouse, pointer lock)
- Script lifecycle (`start/update/stop`) with registry, descriptors stored as `userData.__scripts` for serialization
- Inspector "Scripts" section with "+ Add Component" + per-param form
- Rapier physics: implicit ground plane, gravity, kinematic character controller (Rapier KCC), raycasts
- `AnimationSystem` with `AnimationMixer` per object; clips kept in runtime registry (don't survive `toJSON`)
- Built-in scripts shipped: Rotator, PlayerController, Rigidbody, CharacterController, AnimationPlayer

## 2026-05-12 — Claude Agent SDK switch (zero token cost)

- Migrated chat from direct Anthropic API to **@anthropic-ai/claude-agent-sdk**. Spawns the local `claude` CLI; uses user's subscription. No API key.
- Tool use: `blender_execute_python`, `blender_get_scene_info`, `engine_add_primitive`, `engine_list_scene` (all via in-process MCP server).
- Conversation continuity via session_id from result events.
- Removed API key vault + dialog.

## 2026-05-12 — Undo/Redo + Console + Asset Browser

- Command pattern + History (200-action cap). Add/Remove/Transform commands; gizmo + Inspector + drag-drop wire through it.
- Console panel — captures `console.*` + uncaught errors + unhandled rejections.
- Asset Browser at `%APPDATA%/hairyengine/assets`. Import, refresh, reveal-in-Explorer, click to spawn, drag to viewport to spawn.

## 2026-05-12 — Initial scaffold + .exe

- Electron + Vite + TS scaffold (electron-vite v4).
- Three.js viewport, hierarchy, inspector, status bar.
- Unity-style editor camera (RMB look, WASD fly).
- TransformControls gizmo (W/E/R + Ctrl-snap), outline pass for selection.
- Primitives menu, drag-drop GLB import.
- `.hairy` project save/load + Ctrl+S + recents.
- electron-builder installer + portable .exe (had to write a C# shim for `7za.exe` to skip macOS symlinks; written up in [[project-hairyengine]] memory).
- electron-updater wired for private GitHub releases (waiting on user's PAT to ship the first release).
