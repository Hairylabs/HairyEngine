import * as THREE from 'three';
import { Client, Room } from 'colyseus.js';
import { Scene } from './Scene';
import { PlayState } from './PlayState';

// Minimal Colyseus client. Connects to ws://localhost:2567/arena by default,
// streams the local Player's transform at 20 Hz, and renders remote players
// as labelled capsules. No anti-cheat, no interpolation buffer yet — the
// server scaffold also doesn't do tick-rate broadcast. This is the
// "hello, two browsers can see each other" milestone.

type RemotePlayer = {
  id: string;
  name: string;
  mesh: THREE.Mesh;
  targetPos: THREE.Vector3;
  targetYaw: number;
};

const DEFAULT_URL = 'ws://localhost:2567';

export class Multiplayer {
  private client: Client | null = null;
  private room: Room | null = null;
  private remotes = new Map<string, RemotePlayer>();
  private sendInterval: ReturnType<typeof setInterval> | null = null;
  private sessionId: string | null = null;
  private listeners: Array<(connected: boolean, info?: string) => void> = [];

  constructor(
    private scene: Scene,
    private play: PlayState,
  ) {
    play.onChange((mode) => {
      // Stop sending when not playing — saves bandwidth and avoids
      // animating the editor camera as if it were a player.
      if (mode === 'edit') this.stopSendLoop();
      else if (mode === 'play' && this.room) this.startSendLoop();
    });
  }

  isConnected(): boolean {
    return Boolean(this.room);
  }

  onStateChange(l: (connected: boolean, info?: string) => void) {
    this.listeners.push(l);
  }

  async connect(url = DEFAULT_URL, name?: string): Promise<{ ok: boolean; error?: string }> {
    if (this.room) return { ok: true };
    try {
      this.client = new Client(url);
      this.room = await this.client.joinOrCreate('arena', {
        name: name ?? 'Player',
      });
      this.sessionId = this.room.sessionId;
      this.wireRoom();
      this.notify(true, `Joined ${this.room.name} as ${this.sessionId}`);
      if (this.play.isPlaying()) this.startSendLoop();
      return { ok: true };
    } catch (err) {
      this.client = null;
      this.room = null;
      this.notify(false, (err as Error).message);
      return { ok: false, error: (err as Error).message };
    }
  }

  disconnect() {
    this.stopSendLoop();
    if (this.room) {
      this.room.leave();
      this.room = null;
    }
    this.client = null;
    for (const r of this.remotes.values()) {
      this.scene.three.remove(r.mesh);
      r.mesh.geometry.dispose();
      (r.mesh.material as THREE.Material).dispose();
    }
    this.remotes.clear();
    this.sessionId = null;
    this.notify(false);
  }

  /** Called every frame to lerp remote-player meshes toward their last reported pos. */
  tick(dt: number) {
    const alpha = 1 - Math.pow(0.001, dt); // exponential smoothing
    for (const r of this.remotes.values()) {
      r.mesh.position.lerp(r.targetPos, alpha);
      r.mesh.rotation.y = THREE.MathUtils.lerp(r.mesh.rotation.y, r.targetYaw, alpha);
    }
  }

  private wireRoom() {
    const room = this.room!;
    room.onStateChange((state: unknown) => {
      // Colyseus state has a .players MapSchema. Iterate names; create remote
      // capsules for any session we haven't seen, remove ones that vanished.
      const players = (state as { players?: { forEach?: (cb: (p: unknown, id: string) => void) => void } })
        .players;
      if (!players?.forEach) return;
      const liveIds = new Set<string>();
      players.forEach((p: unknown, id: string) => {
        liveIds.add(id);
        if (id === this.sessionId) return; // self
        if (!this.remotes.has(id)) {
          const mesh = makeRemoteCapsule(
            (p as { name?: string }).name ?? id.slice(0, 4),
          );
          this.scene.three.add(mesh);
          this.remotes.set(id, {
            id,
            name: (p as { name?: string }).name ?? id,
            mesh,
            targetPos: mesh.position.clone(),
            targetYaw: 0,
          });
        }
      });
      // Cleanup remotes that left
      for (const [id, r] of this.remotes) {
        if (!liveIds.has(id)) {
          this.scene.three.remove(r.mesh);
          r.mesh.geometry.dispose();
          (r.mesh.material as THREE.Material).dispose();
          this.remotes.delete(id);
        }
      }
    });

    room.onMessage('pos', (data: { id: string; x: number; y: number; z: number; yaw: number }) => {
      if (data.id === this.sessionId) return;
      const r = this.remotes.get(data.id);
      if (!r) return;
      r.targetPos.set(data.x, data.y, data.z);
      r.targetYaw = data.yaw;
    });

    room.onLeave(() => {
      this.notify(false, 'Left room');
    });
    room.onError((code: number, message?: string) => {
      this.notify(false, `Error ${code}: ${message ?? ''}`);
    });
  }

  private startSendLoop() {
    if (this.sendInterval) return;
    this.sendInterval = setInterval(() => {
      if (!this.room) return;
      // Find the local Player object by name and ship its transform.
      const player = this.scene.three.getObjectByName('Player');
      if (!player) return;
      this.room.send('pos', {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        yaw: player.rotation.y,
      });
    }, 50); // 20 Hz
  }

  private stopSendLoop() {
    if (this.sendInterval) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }
  }

  private notify(connected: boolean, info?: string) {
    this.listeners.forEach((l) => l(connected, info));
  }
}

function makeRemoteCapsule(label: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 1, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x4cf8c5, roughness: 0.5 }),
  );
  mesh.name = `Remote_${label}`;
  mesh.castShadow = true;
  mesh.userData.deletable = false;
  return mesh;
}
