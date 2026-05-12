import { Room, Client } from 'colyseus';
import { Schema, MapSchema, type } from '@colyseus/schema';

// Per-player state synced via Colyseus' built-in delta protocol. The hot
// transform/aim updates ride a separate geckos.io UDP channel; here we keep
// the discrete state (team, score, who's alive) that's fine at 5 Hz.

export class Player extends Schema {
  @type('string') id = '';
  @type('string') name = '';
  @type('string') ponkTokenId = '';
  @type('number') team = 0;
  @type('number') score = 0;
  @type('boolean') alive = true;
}

export class ArenaState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

export class ArenaRoom extends Room<ArenaState> {
  maxClients = 16;

  onCreate() {
    this.state = new ArenaState();
    this.onMessage('setPonk', (client, message: { tokenId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.ponkTokenId = String(message.tokenId);
    });
    this.onMessage('shoot', (client, message: { hitId?: string }) => {
      // Authoritative hit application. For v1: if a hitId came in and that
      // player exists, dock them. Real implementation will replay the shooter's
      // ray against the server-side world state with lag-compensation.
      if (!message?.hitId) return;
      const victim = this.state.players.get(message.hitId);
      const shooter = this.state.players.get(client.sessionId);
      if (victim && shooter) {
        victim.alive = false;
        shooter.score += 1;
        // Respawn after 3s
        this.clock.setTimeout(() => {
          victim.alive = true;
        }, 3000);
      }
    });
  }

  onJoin(client: Client, options: { name?: string; team?: number } = {}) {
    const p = new Player();
    p.id = client.sessionId;
    p.name = options.name ?? `Player-${client.sessionId.slice(0, 4)}`;
    p.team = Number(options.team ?? 0);
    this.state.players.set(client.sessionId, p);
    console.log(`[arena] ${p.name} joined`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    console.log(`[arena] ${client.sessionId} left`);
  }
}
