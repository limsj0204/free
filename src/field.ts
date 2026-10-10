import * as THREE from 'three';
import { FIELD } from './config';
import { BASES, MOUND, P, fencePoint } from './coords';

const COLORS = {
  outside: 0x16201a,
  grass: 0x3f8f3c,
  infieldGrass: 0x449640,
  dirt: 0xb47c4e,
  track: 0x9a6a44,
  line: 0xf4f4f0,
  fence: 0x1d2d5c,
  fenceTop: 0xd9b23a,
  stands: 0x161a28,
  tower: 0x3565b5,
  pole: 0xf2c230,
};

const DEG = Math.PI / 180;

// 바닥 레이어는 깊이를 쓰지 않고 그리는 순서로 겹친다. z-fighting 방지용.
let groundOrder = -100;
function groundMesh(shape: THREE.Shape, color: number): THREE.Mesh {
  const mat = new THREE.MeshLambertMaterial({ color, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 48), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = groundOrder++;
  return mesh;
}

// 회전한 ShapeGeometry에서 (x, y)는 월드 (x, -z)가 된다.
function sv(v: THREE.Vector3): THREE.Vector2 {
  return new THREE.Vector2(v.x, -v.z);
}

function shapeFrom(points: THREE.Vector3[]): THREE.Shape {
  return new THREE.Shape(points.map(sv));
}

function circleShape(center: THREE.Vector3, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(center.x, -center.z, r, 0, Math.PI * 2, false);
  return s;
}

// 홈 뒤를 감싸는 외벽 경로: 좌측 폴 → 펜스 호 → 우측 폴 → 파울 지역 벽 → 백스톱
function wallPath(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let a = -45; a <= 45; a += 1.5) pts.push(fencePoint(a * DEG));
  pts.push(P(26, -14), P(-26, -14));
  return pts;
}

function textPlane(text: string, w: number, h: number, opts: { color?: string; bg?: string; font?: string } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round((512 * h) / w);
  const ctx = canvas.getContext('2d')!;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.font = opts.font ?? `bold ${Math.round(canvas.height * 0.6)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: !opts.bg });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

function buildGround(group: THREE.Group) {
  // 경기장 바깥 어두운 땅
  const outside = new THREE.Shape();
  outside.absarc(0, -40, 400, 0, Math.PI * 2, false);
  group.add(groundMesh(outside, COLORS.outside));

  // 외벽 안쪽 잔디
  group.add(groundMesh(shapeFrom(wallPath()), COLORS.grass));

  // 워닝 트랙
  const outer: THREE.Vector3[] = [];
  const inner: THREE.Vector3[] = [];
  for (let a = -45; a <= 45; a += 1.5) {
    outer.push(fencePoint(a * DEG));
    inner.push(fencePoint(a * DEG, -4.5));
  }
  group.add(groundMesh(shapeFrom([...outer, ...inner.reverse()]), COLORS.track));

  // 내야 흙: 파울라인을 따라 조금 바깥으로 넓힌 띠 + 마운드 중심의 큰 호
  const mound = new THREE.Vector2(MOUND.x, MOUND.z);
  const R = FIELD.infieldArcRadius;
  const off = 1.6;
  const dirtPts: THREE.Vector3[] = [];
  const lineEnd = (sign: number) => {
    // 파울라인(바깥으로 off만큼 평행 이동)과 호의 교점
    const dir = new THREE.Vector2(-sign * Math.SQRT1_2, Math.SQRT1_2);
    const normal = new THREE.Vector2(-sign * Math.SQRT1_2, -Math.SQRT1_2);
    const o = normal.clone().multiplyScalar(off);
    const oc = o.clone().sub(mound);
    const b = dir.dot(oc);
    const t = -b + Math.sqrt(b * b - (oc.lengthSq() - R * R));
    return { start: o, end: o.clone().add(dir.multiplyScalar(t)) };
  };
  const right = lineEnd(1);
  const left = lineEnd(-1);
  dirtPts.push(new THREE.Vector3(right.start.x, 0, right.start.y));
  dirtPts.push(new THREE.Vector3(right.end.x, 0, right.end.y));
  const a0 = Math.atan2(right.end.y - mound.y, right.end.x - mound.x);
  const a1 = Math.atan2(left.end.y - mound.y, left.end.x - mound.x);
  for (let i = 1; i < 60; i++) {
    const a = a0 + ((a1 - a0) * i) / 60;
    dirtPts.push(new THREE.Vector3(mound.x + Math.cos(a) * R, 0, mound.y + Math.sin(a) * R));
  }
  dirtPts.push(new THREE.Vector3(left.end.x, 0, left.end.y));
  dirtPts.push(new THREE.Vector3(left.start.x, 0, left.start.y));
  group.add(groundMesh(shapeFrom(dirtPts), COLORS.dirt));

  // 내야 잔디 (베이스 길 안쪽)
  const h = FIELD.baseDistance / Math.SQRT2;
  const inset = 1.7;
  group.add(
    groundMesh(
      shapeFrom([P(0, inset * Math.SQRT2), P(h - inset * Math.SQRT2, h), P(0, 2 * h - inset * Math.SQRT2), P(-h + inset * Math.SQRT2, h)]),
      COLORS.infieldGrass,
    ),
  );

  // 홈 주변 원, 마운드
  group.add(groundMesh(circleShape(BASES.home, 6.2), COLORS.dirt));
  group.add(groundMesh(circleShape(MOUND, 2.9), COLORS.dirt));

  // 흰 선들
  const lineMat = COLORS.line;
  const strip = (a: THREE.Vector3, b: THREE.Vector3, w = 0.1) => {
    const d = b.clone().sub(a);
    const n = new THREE.Vector3(-d.z, 0, d.x).normalize().multiplyScalar(w / 2);
    return groundMesh(shapeFrom([a.clone().add(n), b.clone().add(n), b.clone().sub(n), a.clone().sub(n)]), lineMat);
  };
  group.add(strip(BASES.home, fencePoint(45 * DEG)));
  group.add(strip(BASES.home, fencePoint(-45 * DEG)));

  // 타석 박스
  for (const side of [-1, 1]) {
    const x0 = side * 0.36;
    const x1 = side * (0.36 + 1.22);
    const z0 = -0.9;
    const z1 = 0.95;
    group.add(strip(P(x0, z0), P(x0, z1), 0.08));
    group.add(strip(P(x1, z0), P(x1, z1), 0.08));
    group.add(strip(P(x0, z0), P(x1, z0), 0.08));
    group.add(strip(P(x0, z1), P(x1, z1), 0.08));
  }

  // 홈플레이트
  group.add(groundMesh(shapeFrom([P(-0.22, 0.22), P(0.22, 0.22), P(0.22, 0), P(0, -0.22), P(-0.22, 0)]), lineMat));
}

function buildBases(group: THREE.Group) {
  const mat = new THREE.MeshLambertMaterial({ color: COLORS.line });
  const geo = new THREE.BoxGeometry(0.38, 0.08, 0.38);
  for (const key of ['first', 'second', 'third'] as const) {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(BASES[key]).setY(0.04);
    m.rotation.y = Math.PI / 4;
    group.add(m);
  }
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.15), mat);
  rubber.position.copy(MOUND).setY(0.03);
  group.add(rubber);
}

function buildWalls(group: THREE.Group) {
  const pts = wallPath();
  pts.push(pts[0]);
  const H = FIELD.fenceHeight;
  const pos: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    pos.push(a.x, 0, a.z, b.x, 0, b.z, b.x, H, b.z);
    pos.push(a.x, 0, a.z, b.x, H, b.z, a.x, H, a.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: COLORS.fence, side: THREE.DoubleSide })));

  // 펜스 위 노란 띠
  const railPos: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const y0 = H;
    const y1 = H + 0.12;
    railPos.push(a.x, y0, a.z, b.x, y0, b.z, b.x, y1, b.z);
    railPos.push(a.x, y0, a.z, b.x, y1, b.z, a.x, y1, a.z);
  }
  const railGeo = new THREE.BufferGeometry();
  railGeo.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
  group.add(new THREE.Mesh(railGeo, new THREE.MeshBasicMaterial({ color: COLORS.fenceTop, side: THREE.DoubleSide })));

  // 거리 표시
  const marks: [number, string][] = [
    [0, `${FIELD.fenceCenter}m`],
    [-44, `${FIELD.fenceLine}m`],
    [44, `${FIELD.fenceLine}m`],
  ];
  for (const [deg, label] of marks) {
    const p = fencePoint(deg * DEG, -0.05);
    const m = textPlane(label, 4, 1.2);
    m.position.set(p.x, H * 0.62, p.z);
    m.lookAt(0, H * 0.62, 0);
    group.add(m);
  }

  // 폴대
  const poleMat = new THREE.MeshLambertMaterial({ color: COLORS.pole });
  for (const deg of [-45, 45]) {
    const p = fencePoint(deg * DEG, 0.3);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 16, 8), poleMat);
    pole.position.set(p.x, 8, p.z);
    group.add(pole);
  }
}

function buildStadium(group: THREE.Group) {
  const center = P(0, 40);

  // 관중석: 바깥으로 기울어진 원뿔대
  const stands = new THREE.Mesh(
    new THREE.CylinderGeometry(165, 105, 26, 72, 1, true),
    new THREE.MeshLambertMaterial({ color: COLORS.stands, side: THREE.DoubleSide }),
  );
  stands.position.set(center.x, 13, center.z);
  group.add(stands);

  // 조명탑
  const towerMat = new THREE.MeshLambertMaterial({ color: COLORS.tower });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6dc });
  for (const deg of [-75, -30, 30, 75, 140, -140]) {
    const a = deg * DEG;
    const r = 128;
    const x = center.x - Math.sin(a) * r;
    const z = center.z + Math.cos(a) * r;
    const tower = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(2.2, 44, 2.2), towerMat);
    post.position.y = 22;
    tower.add(post);
    // 트러스 느낌의 가로대
    for (let y = 6; y < 44; y += 6) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.35, 3.6), towerMat);
      bar.position.y = y;
      tower.add(bar);
    }
    const panel = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 0.8), towerMat);
    panel.position.y = 46;
    tower.add(panel);
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(11, 5), lampMat);
    lamp.position.set(0, 46, 0.45);
    tower.add(lamp);
    tower.position.set(x, 0, z);
    tower.lookAt(center.x, 0, center.z);
    group.add(tower);
  }

  // 전광판과 그 아래 검은 배경판
  const board = scoreboardMesh();
  const bp = P(0, 132);
  board.position.set(bp.x, 30, bp.z);
  board.lookAt(0, 30, 0);
  group.add(board);

  const eye = new THREE.Mesh(new THREE.BoxGeometry(34, 9, 1), new THREE.MeshLambertMaterial({ color: 0x050608 }));
  const ep = P(0, 112);
  eye.position.set(ep.x, 8, ep.z);
  group.add(eye);
}

function scoreboardMesh(): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 300;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#07080b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  const cols = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'R', 'H', 'E'];
  cols.forEach((c, i) => {
    ctx.fillStyle = i < 9 ? '#f2c94c' : '#ffffff';
    ctx.fillText(c, 300 + i * 56, 90);
  });
  const rows = ['원정', '홈'];
  rows.forEach((name, r) => {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(name, 120, 160 + r * 70);
    ctx.textAlign = 'center';
    cols.forEach((_, i) => ctx.fillText('0', 300 + i * 56, 160 + r * 70));
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.BoxGeometry(44, 13, 1), [
    new THREE.MeshBasicMaterial({ color: 0x07080b }),
    new THREE.MeshBasicMaterial({ color: 0x07080b }),
    new THREE.MeshBasicMaterial({ color: 0x07080b }),
    new THREE.MeshBasicMaterial({ color: 0x07080b }),
    new THREE.MeshBasicMaterial({ map: tex }),
    new THREE.MeshBasicMaterial({ color: 0x07080b }),
  ]);
}

export function buildField(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x0a0f1c);
  scene.fog = new THREE.Fog(0x0a0f1c, 160, 420);

  scene.add(new THREE.HemisphereLight(0xe8eeff, 0x4a5a3a, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(30, 80, -20);
  scene.add(sun);

  const group = new THREE.Group();
  buildGround(group);
  buildBases(group);
  buildWalls(group);
  buildStadium(group);
  scene.add(group);
}
