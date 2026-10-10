import * as THREE from 'three';
import { FIELD } from './config';

// 필드 좌표: 홈플레이트가 원점, fx는 1루 쪽(홈에서 보면 오른쪽), fz는 중견수 쪽.
// Three.js 월드에서는 홈에서 +z를 바라볼 때 오른쪽이 -x라서 x 부호만 뒤집는다.
export function P(fx: number, fz: number, y = 0): THREE.Vector3 {
  return new THREE.Vector3(-fx, y, fz);
}

const half = FIELD.baseDistance / Math.SQRT2;

export const BASES = {
  home: P(0, 0),
  first: P(half, half),
  second: P(0, half * 2),
  third: P(-half, half),
};

export type BaseId = keyof typeof BASES;

export const BASE_LABEL: Record<BaseId, string> = {
  home: '홈',
  first: '1루',
  second: '2루',
  third: '3루',
};

export const MOUND = P(0, FIELD.moundDistance);

// 홈 기준 각도(가운데 0, 1루 폴 +45°)에 따른 펜스 거리
export function fenceDistance(angle: number): number {
  const t = Math.cos(2 * angle);
  return FIELD.fenceLine + (FIELD.fenceCenter - FIELD.fenceLine) * Math.max(0, t);
}

export function fencePoint(angle: number, extra = 0): THREE.Vector3 {
  const r = fenceDistance(angle) + extra;
  return P(Math.sin(angle) * r, Math.cos(angle) * r);
}
