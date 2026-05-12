import * as THREE from 'three';
import { Command } from './History';
import { Scene } from './Scene';

// Concrete commands for engine-level mutations. Keep each command tiny and
// idempotent — do() and undo() must each leave the world in a consistent state
// regardless of how many times they're called in sequence.

export class AddObjectCommand implements Command {
  label = 'Add object';

  constructor(
    private scene: Scene,
    private obj: THREE.Object3D,
  ) {
    this.label = `Add ${obj.name || obj.type}`;
  }

  do() {
    this.scene.addInternal(this.obj);
    this.scene.select(this.obj);
  }

  undo() {
    if (this.scene.selection === this.obj) this.scene.select(null);
    this.scene.removeInternal(this.obj);
  }
}

export class RemoveObjectCommand implements Command {
  label = 'Remove object';

  constructor(
    private scene: Scene,
    private obj: THREE.Object3D,
  ) {
    this.label = `Remove ${obj.name || obj.type}`;
  }

  do() {
    if (this.scene.selection === this.obj) this.scene.select(null);
    this.scene.removeInternal(this.obj);
  }

  undo() {
    this.scene.addInternal(this.obj);
    this.scene.select(this.obj);
  }
}

type TransformSnap = {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scl: THREE.Vector3;
};

export class TransformCommand implements Command {
  label = 'Transform';
  constructor(
    private obj: THREE.Object3D,
    private before: TransformSnap,
    private after: TransformSnap,
  ) {}

  do() {
    this.obj.position.copy(this.after.pos);
    this.obj.quaternion.copy(this.after.quat);
    this.obj.scale.copy(this.after.scl);
  }
  undo() {
    this.obj.position.copy(this.before.pos);
    this.obj.quaternion.copy(this.before.quat);
    this.obj.scale.copy(this.before.scl);
  }
}

export function snapshotTransform(obj: THREE.Object3D): TransformSnap {
  return {
    pos: obj.position.clone(),
    quat: obj.quaternion.clone(),
    scl: obj.scale.clone(),
  };
}

export function transformsEqual(a: TransformSnap, b: TransformSnap, eps = 1e-5): boolean {
  return (
    a.pos.distanceToSquared(b.pos) < eps * eps &&
    a.scl.distanceToSquared(b.scl) < eps * eps &&
    Math.abs(a.quat.dot(b.quat)) > 1 - eps
  );
}
