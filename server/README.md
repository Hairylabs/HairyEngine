# HairyEngine multiplayer server

Authoritative server for HairyEngine multiplayer paintball. Hybrid stack:

- **Colyseus** for room management + low-frequency state (scores, teams, who's alive). Runs over WebSocket on port `2567`.
- **geckos.io** for hot-path UDP/WebRTC packets (transforms, aim, pellets) at 20 Hz. Runs on UDP port `3000`.

## Local dev

```
cd server
npm install
npm run dev
```

That's it — Colyseus listens on `ws://localhost:2567`, geckos.io on `udp://localhost:3000`. The HairyEngine client (renderer) will connect to both once the multiplayer toggle ships in editor (Sprint 2 sequel).

## Deploy

- **Edgegap free tier** for the UDP gameplay server (geckos.io needs UDP, and edge locations matter for FPS): containerize this folder, push to Edgegap, expose `3000/udp` + `2567/tcp`.
- **Render** or **Fly.io** free tier works for the Colyseus side alone if you don't need UDP edges yet.

## Wire format (engine ↔ server)

| Channel | Direction | Payload | Notes |
|---|---|---|---|
| Colyseus state | server → all | `players[]` map (id, ponkTokenId, team, score, alive) | Auto-synced via Schema deltas |
| Colyseus `setPonk` | client → server | `{ tokenId: string }` | Player picks their NFT head |
| Colyseus `shoot` | client → server | `{ hitId?: string }` | Server applies damage |
| geckos `input` | client → server | `{ pos: [x,y,z], yaw, pitch, firing }` | 20 Hz |
| geckos `state` | server → client | snapshot of all transforms | 20 Hz (future) |
| geckos `hit` | server → all | `{ shooter, victim, point }` | Triggers VFX |

## TODO

- [ ] Wire geckos channels through ArenaRoom for the broadcast loop
- [ ] Lag compensation: server replays shoot ray against historical positions
- [ ] Anti-cheat: server validates that input deltas don't exceed max speed
- [ ] Match lifecycle (warmup → live → end → restart)
- [ ] Spectator slots
