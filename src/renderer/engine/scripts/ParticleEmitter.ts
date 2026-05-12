import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';

// Minimal particle emitter using THREE.Points. Useful for muzzle flash,
// paint splats, smoke. Particles spawn at the owner's position, fan out
// in a cone, fade over their lifetime. Performance is fine up to a few
// thousand particles per emitter.

const tmpVel = new THREE.Vector3();
const tmpOrig = new THREE.Vector3();

registerScript({
  type: 'ParticleEmitter',
  label: 'Particle Emitter',
  description: 'Continuously emits short-lived points. Tweak rate/spread/lifetime for the look.',
  category: 'FX',
  params: [
    { key: 'rate', label: 'Per second', kind: 'number', default: 30, step: 1 },
    { key: 'lifetime', label: 'Lifetime (s)', kind: 'number', default: 1.2, step: 0.1 },
    { key: 'speed', label: 'Speed', kind: 'number', default: 3, step: 0.5 },
    { key: 'spread', label: 'Spread (rad)', kind: 'number', default: 0.4, step: 0.05 },
    { key: 'gravity', label: 'Gravity', kind: 'number', default: -3, step: 0.5 },
    { key: 'size', label: 'Size', kind: 'number', default: 0.1, step: 0.01 },
    { key: 'color', label: 'Color', kind: 'string', default: '#ff3a8c' },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    const maxParticles = 512;
    const positions = new Float32Array(maxParticles * 3);
    const velocities = new Float32Array(maxParticles * 3);
    const lives = new Float32Array(maxParticles);
    let aliveCount = 0;
    let spawnAccumulator = 0;
    const cursor = { v: 0 };

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(String(params.color ?? '#ff3a8c')),
      size: Number(params.size ?? 0.1),
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.userData.deletable = false;

    const rate = Number(params.rate ?? 30);
    const lifetime = Number(params.lifetime ?? 1.2);
    const speed = Number(params.speed ?? 3);
    const spread = Number(params.spread ?? 0.4);
    const gravity = Number(params.gravity ?? -3);

    return {
      start() {
        ctx.scene.three.add(points);
      },
      update(dt: number) {
        // Spawn new particles
        spawnAccumulator += rate * dt;
        const toSpawn = Math.floor(spawnAccumulator);
        spawnAccumulator -= toSpawn;
        ctx.owner.getWorldPosition(tmpOrig);
        for (let i = 0; i < toSpawn; i++) {
          spawn();
        }

        // Tick + write live particles to the front of the buffer
        let writeIdx = 0;
        for (let i = 0; i < aliveCount; i++) {
          lives[i] -= dt;
          if (lives[i] <= 0) continue;
          // Integrate
          velocities[i * 3 + 1] += gravity * dt;
          positions[i * 3 + 0] += velocities[i * 3 + 0] * dt;
          positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
          positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
          if (writeIdx !== i) {
            positions[writeIdx * 3 + 0] = positions[i * 3 + 0];
            positions[writeIdx * 3 + 1] = positions[i * 3 + 1];
            positions[writeIdx * 3 + 2] = positions[i * 3 + 2];
            velocities[writeIdx * 3 + 0] = velocities[i * 3 + 0];
            velocities[writeIdx * 3 + 1] = velocities[i * 3 + 1];
            velocities[writeIdx * 3 + 2] = velocities[i * 3 + 2];
            lives[writeIdx] = lives[i];
          }
          writeIdx++;
        }
        aliveCount = writeIdx;
        geo.setDrawRange(0, aliveCount);
        (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      },
      stop() {
        ctx.scene.three.remove(points);
        geo.dispose();
        mat.dispose();
      },
    };

    function spawn() {
      const i = cursor.v;
      cursor.v = (cursor.v + 1) % maxParticles;
      if (aliveCount < maxParticles) aliveCount++;

      positions[i * 3 + 0] = tmpOrig.x;
      positions[i * 3 + 1] = tmpOrig.y;
      positions[i * 3 + 2] = tmpOrig.z;

      // Random cone direction
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * spread * 2;
      tmpVel.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      tmpVel.multiplyScalar(speed * (0.6 + 0.4 * Math.random()));
      velocities[i * 3 + 0] = tmpVel.x;
      velocities[i * 3 + 1] = tmpVel.y;
      velocities[i * 3 + 2] = tmpVel.z;

      lives[i] = lifetime * (0.7 + 0.6 * Math.random());
    }
  },
});
