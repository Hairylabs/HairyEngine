// HairyEngine multiplayer server — Colyseus rooms for matchmaking/state,
// geckos.io UDP/WebRTC for hot gameplay packets. Deploy to Edgegap (UDP
// edge) for gameplay; Render or Fly free tier works for the Colyseus HTTP
// side. Run locally with `npm run dev`.
//
// Wire format:
//   Colyseus state: player slots (id, ponkTokenId, team, score)
//   geckos messages:
//     'state' (server -> client, 20Hz snapshot of all player transforms)
//     'input' (client -> server, intended move dir + look + firing)
//     'shoot' (client -> server, world-space ray; server validates)
//     'hit'   (server -> all, broadcast splat events)

import { Server } from 'colyseus';
import { createServer } from 'node:http';
import { WebSocketTransport } from '@colyseus/ws-transport';
import geckos from '@geckos.io/server';
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

// geckos.io for low-latency UDP. Stash the IO server on each ArenaRoom when
// it's created so the room can broadcast snapshot deltas to its connected peers.
const io = geckos();
io.listen(UDP_PORT);
console.log(`[geckos] listening on udp://localhost:${UDP_PORT}`);

io.onConnection((channel) => {
  console.log('[geckos] client connected', channel.id);
  channel.on('input', (data) => {
    // Broadcast loop will be wired through ArenaRoom in a follow-up. For now
    // we just log to prove the pipe is up.
    console.log('[geckos] input', data);
  });
  channel.onDisconnect(() => {
    console.log('[geckos] client disconnected', channel.id);
  });
});
