import * as THREE from 'three';
import { PITCH, RUN, RUNNER, RUN_EXPECTANCY, THROW } from './config';
import { BASES, BASE_LABEL, P, bagSpot, type BaseId } from './coords';
import { josa } from './explain';
import type { FielderId, Grade, Situation, ThrowScenario } from './scenario';
import { DEFAULT_FIELDERS } from './scenarios';
import { CONTACT_POINT, PRE_PITCH, grounderHops, releasePoint, type BallSeg, type Call, type Path } from './timeline';

// 주루 판단 엔진의 공통 부분.
// 판단은 '단계'로 나눈다. 한 상황에 판단이 한 번(한 베이스 더, 땅볼 진루) 또는 두 번(플라이: 타구 판단 → 태그업) 있다.
// 단계마다 선택지별 기대 득점(RUN_EXPECTANCY)을 계산해서, 판단 순간 바로 정했을 때 가장 높은 선택이 최선이다.
// 송구에는 오차가 있어서 결과(세이프/아웃)는 운이 섞이고, 판정은 기대 득점으로 한다.

export type RunMe = 'batter' | 'r1' | 'r2' | 'r3';
export type OutfielderId = 'LF' | 'CF' | 'RF';
export type RunKind = 'extra' | 'fly' | 'ground';
export const RUN_KIND_LABEL: Record<RunKind, string> = { extra: '한 베이스 더', fly: '플라이', ground: '땅볼' };

export interface OutfieldHit {
  type: 'grounder' | 'liner' | 'fly';
  land?: { pos: THREE.Vector3; t: number }; // liner: 여기 떨어진 뒤 field까지 굴러간다
  field: THREE.Vector3; // 외야수가 공을 잡는 곳 (fly: 포구 지점, 안 잡히면 공이 떨어지는 곳)
  fieldT: number;
  release: keyof typeof RUNNER.release;
  catchProb?: number; // fly: 잡힐 확률
  drop?: { field: THREE.Vector3; t: number }; // fly: 안 잡히면 외야수가 공을 줍는 곳과 시간
}

export interface RunScenario {
  id: string;
  kind: RunKind; // extra: 안타 때 한 베이스 더, fly: 외야 플라이 (타구 판단 → 태그업), ground: 땅볼 진루
  title: string;
  event: string; // 상황판에 보이는 짧은 타구 이름
  me: RunMe;
  situation: Situation;
  fielder?: OutfielderId; // extra/fly: 공을 처리하는 외야수
  hit?: OutfieldHit;
  ground?: ThrowScenario; // ground: 내야 수비 엔진에 넘기는 상황 (내 주자의 행동은 판단에 따라 바꾼다)
  brief: string;
  explanation?: string;
  generated?: boolean;
}

export const OF_NAME: Record<OutfielderId, string> = { LF: '좌익수', CF: '중견수', RF: '우익수' };
export const ME_NAME: Record<RunMe, string> = { batter: '타자 주자', r1: '1루 주자', r2: '2루 주자', r3: '3루 주자' };

export const ORIGIN: Record<RunMe, BaseId> = { batter: 'home', r1: 'first', r2: 'second', r3: 'third' };
export const NEXT: Record<BaseId, BaseId> = { home: 'first', first: 'second', second: 'third', third: 'home' };
export const BASE_PATH = 27.43;
export const TAG_REACH = 1.5; // 베이스 앞 이 거리에서 태그된다

export function batterBoxOf(scn: RunScenario) {
  return P(scn.situation.batter === 'R' ? -0.9 : 0.9, 0);
}

export const pct = (p: number) => (p > 0.99 ? '99% 이상' : p < 0.01 ? '1% 미만' : `${Math.round(p * 100)}%`);

// 베이스에서 다음 베이스 쪽으로 dist만큼 나간 곳 (베이스를 지나면 그다음 베이스 쪽으로 이어진다)
export function along(origin: BaseId, dist: number): THREE.Vector3 {
  let base = origin;
  let d = dist;
  while (d > BASE_PATH && base !== 'home') {
    d -= BASE_PATH;
    base = NEXT[base];
  }
  if (base === 'home' && origin !== 'home' && dist > 0) return BASES.home.clone();
  const dir = BASES[NEXT[base]].clone().sub(BASES[base]).normalize();
  return BASES[base].clone().addScaledVector(dir, Math.max(-2, d));
}

export function leadSpot(base: BaseId, dist: number) {
  return along(base, dist);
}

// ---------- 확률 ----------

function phi(x: number) {
  // 표준정규분포 누적확률 (Abramowitz-Stegun 근사)
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// 송구 오차를 감안한 세이프 확률 (margin: 주자가 송구보다 몇 초 먼저 도착하는지). 송구는 평소 throwSd 정도 흔들리고,
// wildRate 확률로 빗나가서 더 늦어진다.
export function safeProb(margin: number) {
  const sd = RUNNER.throwSd;
  const normal = phi(margin / sd);
  let wild = 0;
  const n = 12;
  for (let i = 0; i < n; i++) {
    const u = RUNNER.wildMin + ((i + 0.5) / n) * (RUNNER.wildMax - RUNNER.wildMin);
    wild += phi((margin + u) / sd) / n;
  }
  return (1 - RUNNER.wildRate) * normal + RUNNER.wildRate * wild;
}

// 이번 송구의 오차 (초, +면 늦게 도착). 한 번 플레이할 때 한 번 뽑는다.
export function sampleThrowNoise(): number {
  const u1 = Math.max(1e-9, Math.random());
  const u2 = Math.random();
  const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const wild = Math.random() < RUNNER.wildRate ? RUNNER.wildMin + Math.random() * (RUNNER.wildMax - RUNNER.wildMin) : 0;
  return gauss * RUNNER.throwSd + wild;
}

// ---------- 기대 득점 ----------

export interface BaseState {
  runs: number;
  outs: number;
  runners: { first: boolean; second: boolean; third: boolean };
}

export function expectancy(st: BaseState) {
  if (st.outs >= 3) return st.runs;
  const key = `${st.runners.first ? '1' : '_'}${st.runners.second ? '2' : '_'}${st.runners.third ? '3' : '_'}`;
  return st.runs + RUN_EXPECTANCY[key][st.outs];
}

export const R = (first: boolean, second: boolean, third: boolean) => ({ first, second, third });

export function stateLabel(st: BaseState) {
  const runs = st.runs ? `${st.runs}점 득점, ` : '';
  if (st.outs >= 3) return `${runs}3아웃 이닝 종료`;
  const outs = st.outs === 0 ? '무사' : `${st.outs}사`;
  const bases = (['first', 'second', 'third'] as const).filter((b) => st.runners[b]).map((b) => BASE_LABEL[b].replace('루', ''));
  const on = bases.length === 3 ? '만루' : bases.length ? `${bases.join(', ')}루` : '주자 없음';
  return `${runs}${outs} ${on}`;
}

export const evText = (st: BaseState) => `${stateLabel(st)} <small>(기대 ${expectancy(st).toFixed(2)}점)</small>`;

// ---------- 단계와 판정 ----------

export interface StepOption {
  id: string;
  key: 'W' | 'S' | 'D';
  label: string;
  short: string; // 3D 표시에 쓰는 짧은 이름
  pos: THREE.Vector3 | null; // 화면에 표시할 곳 (지금 서 있는 베이스면 null)
}

export interface OptionValue {
  id: string;
  ev: number; // 기대 득점
  lines: string[]; // 결과 화면에 보여줄 설명 (확률 → 상황)
  invalid?: boolean; // 원칙상 답이 될 수 없는 선택 (포스인데 귀루, 2아웃인데 스타트하지 않음)
}

export interface StepValue {
  options: OptionValue[];
  note: string; // 판단 근거 한 줄 (예: 세이프 확률과 이득 기준)
}

export interface Step {
  key: 'extra' | 'read' | 'tagup' | 'ground';
  name: string; // 결과 화면의 단계 이름
  prompt: string; // 결정 패널 제목
  urgent: string; // 판단 순간(슬로모션) 제목
  options: StepOption[];
  decisionAt: number;
  deadline: number;
  timeout: string; // 시간 안에 안 고르면 이 선택
  value(td: number): StepValue; // td(게임 시간)에 정했을 때 선택지별 기대 득점
}

export type RunVerdict = 'ideal' | 'late' | 'fallback' | 'other' | 'timeout';

export interface StepGrade {
  step: Step;
  choice: string;
  delay: number;
  timedOut: boolean;
  grade: Grade;
  verdict: RunVerdict;
  best: string[]; // 판단 순간 바로 정했을 때 최선 (여럿일 수 있음)
  immediate: StepValue;
  mine: StepValue; // 내가 정한 시각 기준
  loss: number; // 최선과의 기대 득점 차이
}

const evOf = (v: StepValue, id: string) => v.options.find((o) => o.id === id)!.ev;

export function bestOptions(v: StepValue): string[] {
  const top = Math.max(...v.options.map((o) => o.ev));
  return v.options.filter((o) => o.ev >= top - RUNNER.closeTolerance).map((o) => o.id);
}

export function gradeStep(step: Step, choice: string, delay: number, timedOut: boolean): StepGrade {
  const immediate = step.value(step.decisionAt);
  const mine = step.value(step.decisionAt + delay);
  const best = bestOptions(immediate);
  const top = Math.max(...immediate.options.map((o) => o.ev));
  const loss = Math.max(0, top - evOf(mine, choice));
  let verdict: RunVerdict;
  let grade: Grade;
  if (timedOut) {
    verdict = 'timeout';
    grade = best.includes(choice) ? 'ok' : 'bad';
  } else if (best.includes(choice)) {
    verdict = loss < 0.05 ? 'ideal' : 'late';
    grade = loss < 0.05 ? 'best' : loss < 0.2 ? 'ok' : 'bad';
  } else if (bestOptions(mine).includes(choice) && delay > 0.05) {
    // 처음엔 다른 게 맞았지만, 늦게 정한 시점에선 이게 나았다
    verdict = 'fallback';
    grade = 'ok';
  } else {
    verdict = 'other';
    grade = loss < 0.1 ? 'ok' : 'bad';
  }
  return { step, choice, delay, timedOut, grade, verdict, best, immediate, mine, loss };
}

// ---------- 타임라인 ----------

export interface Key {
  t: number;
  pos: THREE.Vector3;
}

// 키프레임 사이를 직선으로 잇는 움직임. 키프레임 밖에서는 처음/마지막 위치에 있다.
export function trackAt(track: Key[], t: number, out = new THREE.Vector3()) {
  if (t <= track[0].t) return { pos: out.copy(track[0].pos), moving: false };
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (t <= b.t) {
      const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      out.lerpVectors(a.pos, b.pos, u);
      return { pos: out, moving: b.pos.distanceTo(a.pos) > 0.05 };
    }
  }
  return { pos: out.copy(track[track.length - 1].pos), moving: false };
}

// t 이후를 잘라 그 자리에 멈추게 한다
export function cutTrack(track: Key[], t: number): Key[] {
  const kept = track.filter((k) => k.t < t);
  return [...kept, { t, pos: trackAt(track, t).pos.clone() }];
}

// 내야 수비 엔진의 경로(Path)를 키프레임으로 바꾼다
export function pathKeys(p: Path): Key[] {
  const keys: Key[] = [{ t: p.startTime, pos: p.waypoints[0].clone() }];
  let t = p.startTime;
  for (let i = 1; i < p.waypoints.length; i++) {
    t += p.waypoints[i - 1].distanceTo(p.waypoints[i]) / p.speed;
    keys.push({ t, pos: p.waypoints[i].clone() });
  }
  return p.stopAt !== undefined ? cutTrack(keys, p.stopAt) : keys;
}

export interface RunPlay {
  t: number;
  base: BaseId;
  out: boolean;
  receiver: FielderId;
  runner: 'me' | number; // number: others의 순서
}

export interface Other {
  keys: Key[];
  batter: boolean; // 타석에서 스윙 자세로 시작하는 타자
  start: number; // 이 시간 전에는 타석(타자)이나 리드 자리에 서 있다
}

export interface RunTimeline {
  start: number;
  tWindup: number;
  tRelease: number;
  ball: BallSeg[];
  fielders: Partial<Record<FielderId, Key[]>>;
  fieldersHome?: Partial<Record<FielderId, THREE.Vector3>>; // 움직이지 않는 수비수의 자리 (없으면 기본 수비 위치)
  me: Key[];
  meBatter: boolean; // 내가 타자 주자 (타석에서 시작)
  meStart: number;
  others: Other[];
  calls: Call[];
  plays: RunPlay[];
  slides: { runner: 'me' | number; base: BaseId; t: number }[];
  end: number;
}

export function pitchTimes(pitchFlight: number) {
  const tRelease = -pitchFlight;
  const tWindup = tRelease - PITCH.windupTime;
  return { tRelease, tWindup, start: tWindup - PRE_PITCH };
}

export function walkKeys(from: THREE.Vector3, to: THREE.Vector3, t0: number, speed = RUN.fielderSpeed): Key[] {
  return [
    { t: t0, pos: from.clone() },
    { t: t0 + from.distanceTo(to) / speed, pos: to.clone() },
  ];
}

// 외야로 가는 타구 (땅볼·라이너·뜬공)
export function hitSegments(hit: OutfieldHit): BallSeg[] {
  if (hit.type === 'grounder') {
    return [{ from: CONTACT_POINT, to: hit.field.clone().setY(0.3), t0: 0, t1: hit.fieldT, ...grounderHops(Math.min(hit.fieldT, 2.2)) }];
  }
  if (hit.type === 'liner') {
    const land = hit.land!;
    return [
      { from: CONTACT_POINT, to: land.pos.clone().setY(0.1), t0: 0, t1: land.t, arc: (9.8 * land.t * land.t) / 8 },
      { from: land.pos.clone().setY(0.1), to: hit.field.clone().setY(0.3), t0: land.t, t1: hit.fieldT, arc: 0.6, bounces: 3 },
    ];
  }
  return [{ from: CONTACT_POINT, to: hit.field.clone().setY(1.9), t0: 0, t1: hit.fieldT, arc: (9.8 * hit.fieldT * hit.fieldT) / 8 }];
}

export const PITCH_SEG = (tRelease: number): BallSeg => ({ from: releasePoint(), to: CONTACT_POINT, t0: tRelease, t1: 0, arc: 0.15 });

const RECEIVER: Record<BaseId, (f: OutfielderId) => FielderId> = {
  home: () => 'C',
  first: () => '1B',
  second: (f) => (f === 'RF' ? '2B' : 'SS'),
  third: () => '3B',
};

export function receiverAt(base: BaseId, f: OutfielderId): FielderId {
  return RECEIVER[base](f);
}

// 외야수의 송구: 빗나간 송구는 베이스 옆으로 간다
export function outfieldThrow(from: THREE.Vector3, base: BaseId, t0: number, noise: number) {
  const src = from.clone().setY(1.8);
  const bag = BASES[base].clone().setY(1.0);
  const off = noise > RUNNER.wildMin ? Math.min(2.5, noise * 3) : 0;
  const side = src.clone().sub(bag).setY(0).normalize();
  const to = bag.clone().add(new THREE.Vector3(-side.z, 0, side.x).multiplyScalar(off));
  const flight = src.distanceTo(bag) / RUNNER.throwSpeed;
  return { from: src, to, t0, t1: t0 + flight + noise, flight };
}

// 외야 수비 기본 움직임: 공을 처리하는 외야수, 그 베이스로 들어가는 수비수, 그 뒤를 받치는 투수
export function outfieldDefense(fielder: OutfielderId, ballAt: THREE.Vector3, arriveBy: number, playBase: BaseId, alsoCover: BaseId | null) {
  const f = DEFAULT_FIELDERS;
  const moves: Partial<Record<FielderId, Key[]>> = {};
  const target = ballAt.clone().setY(0);
  moves[fielder] = [
    { t: 0.15, pos: f[fielder].clone() },
    { t: Math.max(0.3, arriveBy), pos: target },
  ];
  const receiver = receiverAt(playBase, fielder);
  if (receiver !== 'C') moves[receiver] = walkKeys(f[receiver], bagSpot(playBase), 0.5);
  // 다른 베이스에 들어가는 수비수는 주자가 지나가는 길을 막지 않게 베이스 안쪽에 선다
  if (alsoCover && alsoCover !== playBase && alsoCover !== 'home') {
    const cover: FielderId = alsoCover === 'second' ? (receiver === 'SS' ? '2B' : fielder === 'RF' ? '2B' : 'SS') : alsoCover === 'first' ? '1B' : '3B';
    const inside = BASES[alsoCover].clone().lerp(P(0, 19.4), 2.5 / BASES[alsoCover].distanceTo(P(0, 19.4)));
    if (!moves[cover]) moves[cover] = walkKeys(f[cover], inside, 0.6);
  }
  const backDir = BASES[playBase].clone().sub(target).setY(0).normalize();
  moves.P = walkKeys(f.P, BASES[playBase].clone().addScaledVector(backDir, 9), 0.4);
  return { moves, receiver };
}

// 타자: 1루로 뛴다 (뜬공이 잡히면 그 자리에서 멈춘다)
export function batterRun(scn: RunScenario, stopAt?: number, toSecond = false): Other {
  const box = batterBoxOf(scn);
  const t1 = RUN.batterStartDelay + box.distanceTo(BASES.first) / RUN.speed;
  let keys: Key[] = [
    { t: RUN.batterStartDelay, pos: box },
    { t: t1, pos: BASES.first.clone() },
  ];
  if (toSecond) keys.push({ t: t1 + RUNNER.roundTime + BASE_PATH / RUNNER.speed, pos: BASES.second.clone() });
  if (stopAt !== undefined) keys = cutTrack(keys, stopAt);
  return { keys, batter: true, start: RUN.batterStartDelay };
}

export function tagCall(base: BaseId, t: number, safe: boolean): Call {
  return { t, pos: BASES[base], text: safe ? '세이프!' : '태그아웃', good: !safe };
}

export function throwArc(from: THREE.Vector3, to: THREE.Vector3) {
  return Math.min(6, from.distanceTo(to) * 0.06);
}

export const TAG_TIME = THROW.tagTime;

export function baseLabelTo(base: BaseId) {
  return josa(BASE_LABEL[base], '으로', '로');
}
