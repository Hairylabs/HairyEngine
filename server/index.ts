// HairyEngine multiplayer server — Colyseus rooms for matchmaking/state,
// geckos.io UDP/WebRTC for hot gameplay packets.
//
// Local dev:
//   cd server
//   npm install
//   npm run dev
//
// Wire format:
//   Colyseus (ws://localhost:2567) carries the room state Schema —
//     players map (id, ponkTokenId, team, score, alive). Low frequency.
//   geckos.io (udp://localhost:3000) carries:
//     client -> server 'input' {x,y,z,yaw}
//     server -> all    'state' Array<{id,x,y,z,yaw}>  at 20Hz
//
// For v1 the server takes no authoritative simulation step. It just forwards
// the last-received transform from each channel. Anti-cheat / lag-compensated
// hit registration is a follow-up.

import { Server } from 'colyseus';
import { createServer } from 'node:http';
import { WebSocketTransport } from '@colyseus/ws-transport';
import geckos, { ServerChannel } from '@geckos.io/server';
import { ArenaRoom } from './rooms/ArenaRoom';

const PORT = Number(process.env.PORT ?? 2567);
const UDP_PORT = Number(process.env.UDP_PORT ?? 3000);

const httpServer = createServer();
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});
gameServer.define('arena', ArenaRoom);

httpServer.listen(PORT, () => {
  console.log(`[colyseus] listening on ws://localhost:${PORT}`);
});

// geckos.io UDP server
type Snapshot = { x: number; y: number; z: number; yaw: number };
const liveChannels = new Map<string, ServerChannel>();
const positions = new Map<string, Snapshot>();

const io = geckos();
io.listen(UDP_PORT);
console.log(`[geckos] listening on udp://localhost:${UDP_PORT}`);

io.onConnection((channel) => {
  liveChannels.set(channel.id ?? '', channel);
  console.log('[geckos] connected', channel.id, '  total=', liveChannels.size);

  channel.on('input', (data) => {
    const d = data as Snapshot | undefined;
    if (!d || typeof d.x !== 'number') return;
    positions.set(channel.id ?? '', d);
  });

  channel.onDisconnect(() => {
    if (channel.id) {
      liveChannels.delete(channel.id);
      positions.delete(channel.id);
    }
    console.log('[geckos] disconnected', channel.id, '  total=', liveChannels.size);
  });
});

// Broadcast loop — every 50ms (20Hz) ship the current snapshot of every
// connected channel to every connected channel. Each client filters out its
// own id locally so it doesn't render itself twice.
setInterval(() => {
  if (liveChannels.size === 0) return;
  const snapshot: Array<Snapshot & { id: string }> = [];
  for (const [id, pos] of positions) {
    snapshot.push({ id, ...pos });
  }
  io.emit('state', snapshot);
}, 50);
