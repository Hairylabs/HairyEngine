# HairyEngine Roadmap

> **North star**: a dyslexic artist with no coding background can build and ship a multiplayer web paintball game from scratch — drop files, drag in browser, talk to Claude.

Synthesized from research on Unity, Godot, Unreal, Babylon, PlayCanvas, Defold, Mixamo, AccuRig, Rigify, Colyseus, geckos.io, viem/RainbowKit, and PulseChain. See [DEVLOG.md](DEVLOG.md) for chronology and findings.

---

## ✓ Shipped

### Editor core
- Electron + Vite + TS scaffold; auto-update; installer .exe + portable
- 3D viewport with bright lighting / readable grid
- Unity-style editor camera, transform gizmo (W/E/R + Ctrl-snap), outline selection
- Hierarchy + Inspector + Console + Asset Browser + Status bar
- Undo / Redo (200-action history)
- `.hairy` project save / load; recents; drag-drop GLB / FBX / .hairy

### Authoring + runtime
- Play / Pause / Stop with snapshot+restore
- Scene Camera primitive with frustum gizmo + MainCamera marker
- Built-in scripts: Rotator, PlayerController, CharacterController (Rapier), Rigidbody, AnimationPlayer, Crosshair, Shooter, ParticleEmitter, MainCamera, FollowCamera
- Rapier physics (gravity, colliders, raycasts, kinematic character controller)
- HUD layer over canvas

### AI + Blender
- In-engine Claude chat **using Claude Code subscription** (no API tokens)
- Floating dropdown panels for Claude + Blender chats
- Tools: `blender_execute_python`, `blender_get_scene_info`, `engine_add_primitive`, `engine_list_scene`
- Blender bridge — Import/Export selected via temp GLB

### Ship
- Web export (`npm run web:build` → static bundle that auto-plays)

---

## ▶ Sprint 1 — "Drop in, ship out" character pipeline

The single biggest unlock for the persona. After this sprint an artist can drop a humanoid model + Mixamo animations and have a player walking around in their game with **zero code**.

1. **One-click "FPS Player" template** (Add menu): creates a Player Group with character mesh placeholder + CharacterController + camera + crosshair + shooter + animator script — all wired. Mirrors Unity's Starter Assets.
2. **Mixamo skeleton as canonical rig**. On import, build a `Map<canonicalBoneName, Bone>` per character. Animations play by bone-name lookup, never by index. Strip `mixamorig:` prefix.
3. **Animation Library panel**: drop a folder of FBX clips, each becomes a "clip slot" the user names (`Idle`, `Run`, `Sprint`, `Jump`, `Shoot`). Behind the scenes, Blender (via MCP) bakes them onto the active character and exports per-clip GLBs.
4. **Visual AnimationTree** (Godot-style): drag clips into boxes, draw transition arrows, set conditions on a `Speed`/`isFiring` parameter. Replaces hand-editing the `AnimationPlayer` script.
5. **Attach-to-bone UI**: when a SkinnedMesh is selected, the Inspector lists every bone in a dropdown. Drag a weapon GLB onto a bone name → it parents and follows.

---

## ▶ Sprint 2 — Multiplayer that actually works

Target: 16-player browser paintball, no engineer needed.

1. **Multiplayer toggle in Player Settings**: on/off + game mode (deathmatch / capture-the-paint).
2. **Inspector-checkbox sync** (Godot-style): on any script param, a "Networked" checkbox. Marked fields auto-replicate.
3. **Server-authoritative paintball loop** baked in: hit detection on server, lag-compensated rewind on shoot RPC.
4. **Hybrid network stack**:
   - **geckos.io (WebRTC/UDP)** at 20 Hz for transforms / aim / pellet positions
   - **Colyseus** Schema for low-frequency state (score, ammo, team, respawn)
   - **WebSocket fallback** for chat / lobby
5. **One-click deploy**: bundles server + client, deploys to Edgegap free tier. Clipboard receives the share URL.
6. **Multi-tab Play Mode** (Unity MPPM-style): button to spawn 2–4 extra browser tabs pointed at a local dev server, all joining the same room. Test the game without leaving the editor.

---

## ▶ Sprint 3 — Logic without code

For an artist who can't write code, this is **the** layer.

1. **Visual scripting (PlayMaker-style FSM)**:
   - States are bubbles, transitions are arrows, conditions are dropdowns
   - Action palette: `On Shoot Hit` → `Add Score`, `Spawn Splat`, `Play Sound`, `Damage Target`
   - Typed colored pins, white execution wire (Unreal lesson)
   - Searchable add-node menu, right-click pin → only valid completions
2. **"Describe what you want" panel**: dictation/text → Claude → produces the FSM nodes (we already have the chat plumbing). For dyslexic users this beats writing or even node-wiring.
3. **Variables panel**: typed scalars (Health, Score, Ammo) added via a UI, accessed by all visual scripts in the scene.
4. **Built-in templates**: pre-made FSMs for "Player Death", "Respawn Loop", "Hit Marker", "Score on Hit" — drop them onto an object and adjust.

---

## ▶ Sprint 4 — Web3 / Ponks heads

Layered on top so it doesn't block gameplay work.

1. **Connect Wallet button** (top-right of header). RainbowKit v2 (`wagmi + viem + @rainbow-me/rainbowkit + react-query`).
2. **PulseChain custom chain** registered (id 369, RPC `rpc.pulsechain.com`).
3. **NFT inventory drawer**: shows the user's Ponks (read directly via `balanceOf` + `tokenOfOwnerByIndex`).
4. **Ponks-as-head texture**: drag a Ponk thumbnail onto a player → that NFT's IPFS image becomes the paper-bag head texture (cached in IndexedDB).
5. **Login with PulseChain**: SIWE for multiplayer auth — server trusts the wallet signature without custodying anything.

---

## ◇ Sprint 5+ — Engine fundamentals (smaller wins)

Each is ~½ to 1 session. Pick by demand.

- **AssetLib in editor**: curated drag-to-install marketplace inside HairyEngine (initially backed by a folder of pre-rigged characters / weapons / arenas we ship; later a community submission flow)
- **PBR material slots in Inspector**: diffuse, normal, metallic-roughness, AO; drag images from Asset Browser into slots
- **Sound system**: `AudioListener` auto-on-main-camera, `AudioSource` script with 3D positional audio (Web Audio API)
- **Skybox / HDRI**: drop an HDR to set environment + background
- **Hierarchy drag-to-reparent**, multi-select, Ctrl+D duplicate, F2 rename
- **Selection box** (mouse drag in editor)
- **Camera preview window** in corner when a Camera is selected
- **Shoot impulse** — wire `Shooter` to apply Rapier force on hit dynamic bodies
- **Particle texture support**, burst mode, color-over-lifetime curves
- **Prefabs** — save a subtree as `.hairyprefab`, drop back in to instance
- **Console pin / unpin**, error toast on unhandled rejection
- **Editor preferences pane** (FOV, snapping defaults, keybindings)
- **One-click "Export game ZIP"** from File menu (web build + scene.json + assets in one zip)
- **Code-sign the .exe** so SmartScreen stops warning

---

## ◆ Long-tail backlog / explicitly deferred

- Custom user scripts written in TS with in-engine editor (Monaco) — heavy work; defer until visual scripting isn't enough
- Multi-scene additive loading
- Real navmesh + bot AI (out of scope for paintball v1)
- Code signing certificate ($200/yr Sectigo)
- ROM-style runtime cheats / mods
- Mobile touch controls (low priority for paintball, easy enough later via Pointer Events)

---

## Notes / design constraints

- **The user is dyslexic.** Every UI choice should be questioned through "would a dyslexic artist ship a game with this?". Prefer **icons + previews + audio** over text labels. Prefer **drag-drop** over typing. Prefer **templates** over component composition.
- **Chat is free at point of use** (Claude Code subscription via Agent SDK). Encourage the user to chat for guidance — it's much cheaper than building tutorials.
- **Animations don't survive `toJSON`** — runtime registry keyed by uuid. Saved projects lose clips until re-imported. Fix candidate: stash GLB bytes per object in the project file (size cost), or asset-system reference.
- **Mixamo skeleton is canonical**. Any other skeleton must be retargeted to it (via Blender bake) before runtime, not at runtime.
- **Hosting**: Edgegap free tier for geckos.io UDP gameplay server; Render free tier for Colyseus matchmaking HTTP server.
- **No Alchemy / Infura / Moralis on PulseChain** — direct RPC + IPFS-gateway race for NFT image loading.
