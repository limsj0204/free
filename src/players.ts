import * as THREE from 'three';

// 단순한 마네킹 선수. 관절은 그룹으로 나눠서 팔다리를 흔들 수 있게만 한다.
export interface Mannequin {
  root: THREE.Group;
  body: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  label?: THREE.Sprite;
  runPhase: number;
}

export interface Look {
  uniform: number;
  cap: number;
  skin?: number;
  glove?: boolean;
  helmet?: boolean;
}

export const TEAM_DEFENSE: Look = { uniform: 0xf3f3f0, cap: 0x1b2440, glove: true };
export const TEAM_OFFENSE: Look = { uniform: 0x5b6378, cap: 0x8a1c24, helmet: true };

function limb(len: number, radius: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len - radius * 2, 4, 8), mat);
  m.position.y = -len / 2;
  g.add(m);
  return g;
}

export function createMannequin(look: Look): Mannequin {
  const uniform = new THREE.MeshLambertMaterial({ color: look.uniform });
  const skin = new THREE.MeshLambertMaterial({ color: look.skin ?? 0xf1c9a5 });
  const cap = new THREE.MeshLambertMaterial({ color: look.cap });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.95;
  root.add(body);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.42, 4, 10), uniform);
  torso.position.y = 0.3;
  body.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
  head.position.y = 0.72;
  body.add(head);

  if (look.helmet) {
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.145, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), cap);
    helmet.position.y = 0.73;
    body.add(helmet);
  } else {
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.137, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), cap);
    crown.position.y = 0.74;
    body.add(crown);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 12), cap);
    brim.scale.set(1, 1, 0.7);
    brim.position.set(0, 0.75, 0.14);
    body.add(brim);
  }

  const leftLeg = limb(0.9, 0.075, uniform);
  leftLeg.position.set(0.1, 0, 0);
  body.add(leftLeg);
  const rightLeg = limb(0.9, 0.075, uniform);
  rightLeg.position.set(-0.1, 0, 0);
  body.add(rightLeg);

  for (const leg of [leftLeg, rightLeg]) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.24), dark);
    shoe.position.set(0, -0.88, 0.05);
    leg.add(shoe);
  }

  const leftArm = limb(0.62, 0.055, uniform);
  leftArm.position.set(0.25, 0.55, 0);
  body.add(leftArm);
  const rightArm = limb(0.62, 0.055, uniform);
  rightArm.position.set(-0.25, 0.55, 0);
  body.add(rightArm);

  if (look.glove) {
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshLambertMaterial({ color: 0x7a4a24 }));
    glove.scale.set(1, 1.2, 0.6);
    glove.position.y = -0.64;
    leftArm.add(glove);
  }

  return { root, body, leftLeg, rightLeg, leftArm, rightArm, runPhase: 0 };
}

export function poseIdle(m: Mannequin, ready = false) {
  m.body.position.y = ready ? 0.85 : 0.95;
  m.body.rotation.x = ready ? 0.35 : 0;
  m.leftLeg.rotation.set(ready ? -0.5 : 0, 0, ready ? 0.15 : 0.03);
  m.rightLeg.rotation.set(ready ? -0.5 : 0, 0, ready ? -0.15 : -0.03);
  m.leftArm.rotation.set(ready ? -0.6 : 0, 0, 0.12);
  m.rightArm.rotation.set(ready ? -0.6 : 0, 0, -0.12);
}

export function poseCrouch(m: Mannequin) {
  // 다리가 한 마디라서 발이 땅에 닿도록 엉덩이 높이에 맞춰 벌린다
  m.body.position.y = 0.6;
  m.body.rotation.x = 0.3;
  m.leftLeg.rotation.set(-0.5, 0, 0.75);
  m.rightLeg.rotation.set(-0.5, 0, -0.75);
  m.leftArm.rotation.set(-1.1, 0, 0.15);
  m.rightArm.rotation.set(0.2, 0, -0.15);
}

export function poseRun(m: Mannequin, dt: number, speed: number) {
  m.runPhase += dt * speed * 1.6;
  const s = Math.sin(m.runPhase);
  m.body.position.y = 0.93 + Math.abs(Math.cos(m.runPhase)) * 0.05;
  m.body.rotation.x = 0.2;
  m.leftLeg.rotation.set(s * 0.9, 0, 0);
  m.rightLeg.rotation.set(-s * 0.9, 0, 0);
  m.leftArm.rotation.set(-s * 0.8, 0, 0.1);
  m.rightArm.rotation.set(s * 0.8, 0, -0.1);
}

export function poseThrow(m: Mannequin, t: number) {
  // t: 0 → 1 동안 오른팔을 뒤에서 앞으로
  m.body.position.y = 0.95;
  m.body.rotation.x = 0.1 + t * 0.25;
  m.rightArm.rotation.set(2.6 - t * 3.6, 0, -0.2);
  m.leftArm.rotation.set(-1.2 + t * 0.8, 0, 0.3);
  m.leftLeg.rotation.set(-0.5 * t, 0, 0.05);
  m.rightLeg.rotation.set(0.3 * t, 0, -0.05);
}

// 태그: 몸을 숙이고 글러브(왼손)를 주자 쪽 낮은 곳으로 뻗는다
export function poseTag(m: Mannequin) {
  m.body.position.y = 0.72;
  m.body.rotation.x = 0.75;
  m.leftLeg.rotation.set(-0.8, 0, 0.35);
  m.rightLeg.rotation.set(0.3, 0, -0.3);
  m.leftArm.rotation.set(-1.9, 0, 0.1);
  m.rightArm.rotation.set(-0.6, 0, -0.3);
}

// 포스아웃: 한 발은 베이스에 대고 다른 발과 글러브를 송구 쪽으로 쭉 뻗어 받는다
export function poseStretch(m: Mannequin) {
  m.body.position.y = 0.88;
  m.body.rotation.x = 0.25;
  m.leftLeg.rotation.set(-0.9, 0, 0.05);
  m.rightLeg.rotation.set(0.35, 0, -0.05);
  m.leftArm.rotation.set(-1.45, 0, 0.05);
  m.rightArm.rotation.set(-0.3, 0, -0.2);
}

// 슬라이딩: 몸을 뒤로 눕히고 다리를 베이스 쪽으로 뻗는다
export function poseSlide(m: Mannequin) {
  m.body.position.y = 0.42;
  m.body.rotation.x = -0.9;
  m.leftLeg.rotation.set(-1.5, 0, 0.05);
  m.rightLeg.rotation.set(-1.1, 0, -0.05);
  m.leftArm.rotation.set(-2.6, 0, 0.3);
  m.rightArm.rotation.set(-0.2, 0, -0.6);
}

export function faceTowards(m: Mannequin, target: THREE.Vector3) {
  const p = m.root.position;
  m.root.rotation.y = Math.atan2(target.x - p.x, target.z - p.z);
}

export function nameSprite(text: string, color = '#ffffff'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(2, 0.5, 1);
  sprite.renderOrder = 10;
  return sprite;
}
