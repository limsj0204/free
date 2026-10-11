import * as THREE from 'three';
import { PITCH, RUN, RUNNER, RUN_EXPECTANCY, THROW } from './config';
import { BASES, BASE_LABEL, P, bagSpot, type BaseId } from './coords';
import { josa } from './explain';
import type { FielderId, Grade, Situation } from './scenario';
import { DEFAULT_FIELDERS } from './scenarios';
import { CONTACT_POINT, PRE_PITCH, grounderHops, releasePoint, type BallSeg, type Call, type Path } from './timeline';

// 주루 판단 엔진. 외야수가 공을 잡아 던지는 시간과 주자가 베이스에 도착하는 시간을 비교해서 세이프 확률을 내고,
// 아웃 카운트·주자 상황별 기대 득점(RUN_EXPECTANCY)으로 '가는 게 이득인지'를 판정한다.
// 수비 판단과 달리 송구에는 오차가 있어서, 결과(세이프/아웃)는 운이 섞이고 판정은 기대 득점으로 한다.

export type RunMe = 'batter' | 'r1' | 'r2' | 'r3';
export type Arm = keyof typeof RUNNER.arm;
export type OutfielderId = 'LF' | 'CF' | 'RF';
export type RunDecision = 'go' | 'stop';

export interface RunScenario {
  id: string;
  kind: 'extra' | 'tagup'; // extra: 안타 때 한 베이스 더, tagup: 플라이 태그업
  title: string;
  event: string; // 상황판에 보이는 짧은 타구 이름
  me: RunMe;
  situation: Situation;
  fielder: OutfielderId; // 공을 처리하는 외야수
  arm: Arm;
  hit: {
    type: 'grounder' | 'liner' | 'fly';
    land?: { pos: THREE.Vector3; t: number }; // liner: 여기 떨어진 뒤 field까지 굴러간다
    field: THREE.Vector3; // 외야수가 공을 잡는 곳 (fly: 포구 지점)
    fieldT: number;
    release: keyof typeof RUNNER.release;
  };
  brief: string;
  explanation?: string;
  generated?: boolean;
}

export const ARM_LABEL: Record<Arm, string> = { strong: '강견', average: '보통', weak: '약견' };
export const OF_NAME: Record<OutfielderId, string> = { LF: '좌익수', CF: '중견수', RF: '우익수' };
export const ME_NAME: Record<RunMe, string> = { batter: '타자 주자', r1: '1루 주자', r2: '2루 주자', r3: '3루 주자' };

const ORIGIN: Record<RunMe, BaseId> = { batter: 'home', r1: 'first', r2: 'second', r3: 'third' };
const NEXT: Record<BaseId, BaseId> = { home: 'first', first: 'second', second: 'third', third: 'home' };
const TAG_REACH = 1.5; // 베이스 앞 이 거리에서 태그된다

export function batterBoxOf(scn: RunScenario) {
  return P(scn.situation.batter === 'R' ? -0.9 : 0.9, 0);
}

// 판단에 쓰는 베이스: mid는 돌아서 지나가는 베이스(태그업은 없음), target은 노리는 베이스, stay는 멈추면 남는 베이스
export function route(scn: RunScenario) {
  const origin = ORIGIN[scn.me];
  if (scn.kind === 'tagup') return { origin, mid: null, target: NEXT[origin], stay: origin };
  const mid = NEXT[origin];
  return { origin, mid, target: NEXT[mid], stay: mid };
}

export function decisionLabel(scn: RunScenario, d: RunDecision) {
  const r = route(scn);
  if (scn.kind === 'tagup') return d === 'go' ? `태그업, ${josa(BASE_LABEL[r.target], '으로', '로')}` : `${BASE_LABEL[r.stay]}에 머묾`;
  return d === 'go' ? (r.target === 'home' ? '홈으로' : `${BASE_LABEL[r.target]}까지`) : `${BASE_LABEL[r.stay]}에서 멈춤`;
}

// ---------- 시간 ----------

function leadSpot(base: BaseId, dist: number) {
  const dir = BASES[NEXT[base]].clone().sub(BASES[base]).normalize();
  return BASES[base].clone().addScaledVector(dir, dist);
}

// 타격 순간 주자의 출발 위치와 출발 시간
function start(scn: RunScenario) {
  if (scn.kind === 'tagup') {
    // 태그업은 베이스를 밟고 있다가 포구 순간에 출발한다
    return { pos: BASES[ORIGIN[scn.me]].clone(), t: Infinity };
  }
  if (scn.me === 'batter') return { pos: batterBoxOf(scn), t: RUN.batterStartDelay };
  const pos = leadSpot(ORIGIN[scn.me], RUN.leadOff + RUNNER.secondaryLead);
  if (scn.me === 'r1' || scn.situation.outs === 2) return { pos, t: RUN.runnerStartDelay };
  // 2루 주자는 밀려서 뛰는 게 아니라서, 타구가 빠지는(잡히지 않는) 걸 보고 출발한다
  return { pos, t: scn.hit.type === 'liner' ? RUNNER.liner2Delay : RUNNER.grounder2Delay };
}

export interface RunTiming {
  decisionAt: number; // 슬로모션이 걸리는 판단 순간
  deadline: number; // 이때까지 안 고르면 멈춘다(머문다)
  tBase: number; // extra: 돌아서 지나가는 베이스에 도착하는 시간
  release: number; // 외야수가 공을 놓는 시간
  ballAt: number; // 송구가 노리는 베이스에 도착하는 시간 (오차 없이)
  tagAt: number; // 태그까지 마친 시간
}

export function timing(scn: RunScenario): RunTiming {
  const r = route(scn);
  const s = start(scn);
  const fieldT = scn.hit.fieldT;
  const release = fieldT + RUNNER.release[scn.hit.release];
  const from = scn.hit.field.clone().setY(1.8);
  const flight = from.distanceTo(BASES[r.target].clone().setY(1.0)) / RUNNER.arm[scn.arm];
  const ballAt = release + flight;
  const tagAt = ballAt + THROW.tagTime;
  if (scn.kind === 'tagup') return { decisionAt: fieldT, deadline: fieldT + RUNNER.tagupWindow, tBase: fieldT, release, ballAt, tagAt };
  const tBase = s.t + s.pos.distanceTo(BASES[r.mid!]) / (scn.me === 'batter' ? RUN.speed : RUNNER.speed);
  return { decisionAt: Math.min(fieldT, tBase - RUNNER.commit), deadline: tBase + RUNNER.window, tBase, release, ballAt, tagAt };
}

// 판단 시각(게임 시간) td에 간다고 정했을 때 노리는 베이스에 도착하는 시간
export function arrivalIfGo(scn: RunScenario, td: number) {
  const r = route(scn);
  const tm = timing(scn);
  if (scn.kind === 'tagup') {
    const leave = Math.max(td, scn.hit.fieldT) + RUNNER.tagupReaction;
    return { leave, arrival: leave + BASES[r.origin].distanceTo(BASES[r.target]) / RUNNER.speed, late: 0 };
  }
  // 베이스 commit초 전까지 정하면 속도를 줄이지 않고 돈다. 늦으면 늦은 만큼 베이스에서 머뭇거린다.
  const late = Math.max(0, td - (tm.tBase - RUNNER.commit));
  const leave = tm.tBase + late;
  return { leave, arrival: leave + RUNNER.roundTime + BASES[r.mid!].distanceTo(BASES[r.target]) / RUNNER.speed, late };
}

// 주자가 태그보다 얼마나 먼저 도착하는지 (+면 세이프 쪽, 송구 오차 없이)
export function marginAt(scn: RunScenario, td: number) {
  return timing(scn).tagAt - arrivalIfGo(scn, td).arrival;
}

// ---------- 확률 ----------

function phi(x: number) {
  // 표준정규분포 누적확률 (Abramowitz-Stegun 근사)
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// 송구 오차를 감안한 세이프 확률. 송구는 평소 throwSd 정도 흔들리고, wildRate 확률로 빗나가서 태그가 더 늦어진다.
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

const R = (first: boolean, second: boolean, third: boolean) => ({ first, second, third });

// 판단 결과의 상황. 리드 주자가 송구 승부를 하면 타자 주자는 송구 사이에 2루까지 간다.
export function resultState(scn: RunScenario, d: RunDecision, safe: boolean): BaseState {
  const o = scn.situation.outs;
  if (scn.kind === 'tagup') {
    const o1 = o + 1; // 플라이가 잡혀서 타자는 아웃
    if (scn.me === 'r3') {
      if (d === 'stop') return { runs: 0, outs: o1, runners: R(false, false, true) };
      return safe ? { runs: 1, outs: o1, runners: R(false, false, false) } : { runs: 0, outs: o1 + 1, runners: R(false, false, false) };
    }
    if (d === 'stop') return { runs: 0, outs: o1, runners: R(false, true, false) };
    return safe ? { runs: 0, outs: o1, runners: R(false, false, true) } : { runs: 0, outs: o1 + 1, runners: R(false, false, false) };
  }
  if (scn.me === 'batter') {
    if (d === 'stop') return { runs: 0, outs: o, runners: R(true, false, false) };
    return safe ? { runs: 0, outs: o, runners: R(false, true, false) } : { runs: 0, outs: o + 1, runners: R(false, false, false) };
  }
  if (scn.me === 'r1') {
    if (d === 'stop') return { runs: 0, outs: o, runners: R(true, true, false) };
    return safe ? { runs: 0, outs: o, runners: R(false, true, true) } : { runs: 0, outs: o + 1, runners: R(false, true, false) };
  }
  // r2: 홈 승부
  if (d === 'stop') return { runs: 0, outs: o, runners: R(true, false, true) };
  return safe ? { runs: 1, outs: o, runners: R(false, true, false) } : { runs: 0, outs: o + 1, runners: R(false, true, false) };
}

export function stateLabel(st: BaseState) {
  const runs = st.runs ? `${st.runs}점 득점, ` : '';
  if (st.outs >= 3) return `${runs}3아웃 이닝 종료`;
  const outs = st.outs === 0 ? '무사' : `${st.outs}사`;
  const bases = (['first', 'second', 'third'] as const).filter((b) => st.runners[b]).map((b) => BASE_LABEL[b].replace('루', ''));
  const on = bases.length === 3 ? '만루' : bases.length ? `${bases.join(', ')}루` : '주자 없음';
  return `${runs}${outs} ${on}`;
}

export interface RunValue {
  decisionTime: number; // 판단 시각 (게임 시간)
  margin: number;
  pSafe: number;
  evGo: number;
  evStop: number;
  safe: BaseState;
  out: BaseState;
  stay: BaseState;
  breakEven: number; // 이 확률보다 세이프 확률이 높아야 가는 게 이득
}

export function valueAt(scn: RunScenario, td: number): RunValue {
  const margin = marginAt(scn, td);
  const pSafe = safeProb(margin);
  const safe = resultState(scn, 'go', true);
  const out = resultState(scn, 'go', false);
  const stay = resultState(scn, 'stop', false);
  const vs = expectancy(safe);
  const vo = expectancy(out);
  const vk = expectancy(stay);
  return {
    decisionTime: td,
    margin,
    pSafe,
    evGo: pSafe * vs + (1 - pSafe) * vo,
    evStop: vk,
    safe,
    out,
    stay,
    breakEven: vs > vo ? THREE.MathUtils.clamp((vk - vo) / (vs - vo), 0, 1) : 1,
  };
}

// ---------- 판정 ----------

export type RunVerdict = 'ideal' | 'late' | 'fallback' | 'other' | 'timeout';

export interface RunGrade {
  grade: Grade;
  verdict: RunVerdict;
  best: RunDecision[]; // 판단 순간 바로 정했을 때 최선 (둘 다일 수 있음)
  immediate: RunValue; // 판단 순간 바로 정했을 때
  mine: RunValue; // 내가 정한 시각 기준
  loss: number; // 최선과의 기대 득점 차이
}

const evOf = (v: RunValue, d: RunDecision) => (d === 'go' ? v.evGo : v.evStop);

export function bestDecisions(v: RunValue): RunDecision[] {
  const top = Math.max(v.evGo, v.evStop);
  return (['go', 'stop'] as RunDecision[]).filter((d) => evOf(v, d) >= top - RUNNER.closeTolerance);
}

export function gradeRun(scn: RunScenario, decision: RunDecision, delay: number, timedOut: boolean): RunGrade {
  const tm = timing(scn);
  const immediate = valueAt(scn, tm.decisionAt);
  const mine = valueAt(scn, tm.decisionAt + delay);
  const best = bestDecisions(immediate);
  const top = Math.max(immediate.evGo, immediate.evStop);
  const loss = Math.max(0, top - evOf(mine, decision));
  let verdict: RunVerdict;
  let grade: Grade;
  if (timedOut) {
    verdict = 'timeout';
    grade = best.includes('stop') ? 'ok' : 'bad';
  } else if (best.includes(decision)) {
    verdict = loss < 0.05 ? 'ideal' : 'late';
    grade = loss < 0.05 ? 'best' : loss < 0.2 ? 'ok' : 'bad';
  } else if (bestDecisions(mine).includes(decision) && delay > 0.05) {
    // 처음엔 가는 게 맞았지만, 늦게 정한 시점에선 멈추는 게 나았다
    verdict = 'fallback';
    grade = 'ok';
  } else {
    verdict = 'other';
    grade = loss < 0.1 ? 'ok' : 'bad';
  }
  return { grade, verdict, best, immediate, mine, loss };
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

export interface RunPlay {
  t: number;
  base: BaseId;
  out: boolean;
  receiver: FielderId;
  runner: 'me' | 'batter';
}

export interface RunTimeline {
  start: number;
  tWindup: number;
  tRelease: number;
  ball: BallSeg[];
  fielders: Partial<Record<FielderId, Path>>;
  me: Key[];
  batter: Key[] | null; // 내가 타자 주자가 아니면 타자의 움직임 (타격 전에는 타석에 있다)
  batterStart: number;
  calls: Call[];
  plays: RunPlay[];
  decisionAt: number;
  deadline: number;
  end: number;
  slide: { base: BaseId; t: number } | null; // 내가 슬라이딩하는 순간
}

export interface RunInput {
  decision: RunDecision;
  td: number; // 정한 시각 (게임 시간)
  noise: number; // 이번 송구의 오차
}

const RECEIVER: Record<BaseId, (f: OutfielderId) => FielderId> = {
  home: () => 'C',
  first: () => '1B',
  second: (f) => (f === 'RF' ? '2B' : 'SS'),
  third: () => '3B',
};

export function receiverOf(scn: RunScenario): FielderId {
  return RECEIVER[route(scn).target](scn.fielder);
}

function walk(from: THREE.Vector3, to: THREE.Vector3, startTime: number, speed = RUN.fielderSpeed): Path {
  return { waypoints: [from.clone(), to.clone()], startTime, speed };
}

// 실제 송구가 도착하는 시간과 곳 (빗나간 송구는 베이스 옆으로 간다)
export function throwOf(scn: RunScenario, noise: number) {
  const r = route(scn);
  const tm = timing(scn);
  const from = scn.hit.field.clone().setY(1.8);
  const bag = BASES[r.target].clone().setY(1.0);
  const off = noise > RUNNER.wildMin ? Math.min(2.5, noise * 3) : 0;
  const side = from.clone().sub(bag).setY(0).normalize();
  const to = bag.clone().add(new THREE.Vector3(-side.z, 0, side.x).multiplyScalar(off));
  return { from, to, t0: tm.release, t1: tm.ballAt + noise, tagAt: tm.tagAt + noise };
}

export function buildRunTimeline(scn: RunScenario, pitchFlight: number, input?: RunInput): RunTimeline {
  const tRelease = -pitchFlight;
  const tWindup = tRelease - PITCH.windupTime;
  const startT = tWindup - PRE_PITCH;
  const r = route(scn);
  const tm = timing(scn);
  const s = start(scn);
  const hit = scn.hit;
  const fielders = DEFAULT_FIELDERS;

  // 공: 투구, 타구, 송구
  const ball: BallSeg[] = [{ from: releasePoint(), to: CONTACT_POINT, t0: tRelease, t1: 0, arc: 0.15 }];
  if (hit.type === 'grounder') {
    ball.push({ from: CONTACT_POINT, to: hit.field.clone().setY(0.3), t0: 0, t1: hit.fieldT, ...grounderHops(Math.min(hit.fieldT, 2.2)) });
  } else if (hit.type === 'liner') {
    const land = hit.land!;
    ball.push({ from: CONTACT_POINT, to: land.pos.clone().setY(0.1), t0: 0, t1: land.t, arc: (9.8 * land.t * land.t) / 8 });
    ball.push({ from: land.pos.clone().setY(0.1), to: hit.field.clone().setY(0.3), t0: land.t, t1: hit.fieldT, arc: 0.6, bounces: 3 });
  } else {
    ball.push({ from: CONTACT_POINT, to: hit.field.clone().setY(1.9), t0: 0, t1: hit.fieldT, arc: (9.8 * hit.fieldT * hit.fieldT) / 8 });
  }
  const noise = input?.noise ?? 0;
  const thr = throwOf(scn, noise);
  ball.push({ from: thr.from, to: thr.to, t0: thr.t0, t1: thr.t1, arc: Math.min(6, thr.from.distanceTo(thr.to) * 0.06), thrower: scn.fielder });

  // 수비: 외야수는 공을 잡는 곳으로, 받는 수비수는 베이스로, 투수는 그 베이스 뒤로 백업
  const moves: Partial<Record<FielderId, Path>> = {};
  const of = fielders[scn.fielder];
  const arriveBy = hit.type === 'fly' ? hit.fieldT - 0.4 : hit.fieldT;
  moves[scn.fielder] = { waypoints: [of.clone(), hit.field.clone().setY(0)], startTime: 0.15, speed: Math.max(1, of.distanceTo(hit.field.clone().setY(0)) / Math.max(0.3, arriveBy - 0.15)) };
  const receiver = receiverOf(scn);
  if (receiver !== 'C') moves[receiver] = walk(fielders[receiver], bagSpot(r.target), 0.5);
  // 멈추면 남는 베이스에도 누군가 들어간다 (2루는 반대쪽 키스톤, 1루는 1루수)
  // 주자가 지나가는 길을 막지 않게 베이스 안쪽에 선다
  if (r.stay !== r.target && r.stay !== 'home') {
    const cover: FielderId = r.stay === 'second' ? (receiver === 'SS' ? '2B' : scn.fielder === 'RF' ? '2B' : 'SS') : r.stay === 'first' ? '1B' : '3B';
    const inside = BASES[r.stay].clone().lerp(P(0, 19.4), 2.5 / BASES[r.stay].distanceTo(P(0, 19.4)));
    if (!moves[cover]) moves[cover] = walk(fielders[cover], inside, 0.6);
  }
  const backDir = BASES[r.target].clone().sub(thr.from).setY(0).normalize();
  moves.P = walk(fielders.P, BASES[r.target].clone().addScaledVector(backDir, 9), 0.4);

  // 나
  const me: Key[] = [];
  const bag = (b: BaseId) => BASES[b].clone();
  if (scn.kind === 'tagup') {
    // 투구 때 리드했다가, 뜬공을 보고 베이스로 돌아가 태그업 자세를 잡는다
    const lead = leadSpot(r.origin, RUN.leadOff);
    me.push({ t: tWindup, pos: bag(r.origin) }, { t: 0, pos: lead }, { t: 1.2, pos: bag(r.origin) });
  } else if (scn.me === 'batter') {
    me.push({ t: s.t, pos: s.pos.clone() }, { t: tm.tBase, pos: bag(r.mid!) });
  } else {
    const lead = leadSpot(r.origin, RUN.leadOff);
    me.push({ t: tWindup, pos: lead }, { t: 0, pos: s.pos.clone() }, { t: s.t, pos: s.pos.clone() }, { t: tm.tBase, pos: bag(r.mid!) });
  }

  const calls: Call[] = [];
  const plays: RunPlay[] = [];
  let slide: RunTimeline['slide'] = null;
  let end = Infinity;
  let batterGoes = false;
  if (input) {
    if (input.decision === 'go') {
      const go = arrivalIfGo(scn, input.td);
      const from = scn.kind === 'tagup' ? r.origin : r.mid!;
      const safe = go.arrival < thr.tagAt;
      // 아웃이면 태그되는 순간 그 자리에 멈춘다 (주자가 베이스 앞 TAG_REACH까지 와야 태그된다)
      const outT = Math.max(thr.tagAt, go.arrival - TAG_REACH / RUNNER.speed);
      const tEnd = safe ? go.arrival : outT;
      me.push({ t: go.leave, pos: bag(from) });
      const leg: Key[] = [{ t: go.leave, pos: bag(from) }, { t: go.arrival, pos: bag(r.target) }];
      me.push({ t: tEnd, pos: trackAt(leg, tEnd).pos.clone() });
      calls.push({ t: tEnd, pos: BASES[r.target], text: safe ? '세이프!' : '태그아웃', good: !safe });
      plays.push({ t: tEnd, base: r.target, out: !safe, receiver, runner: 'me' });
      slide = { base: r.target, t: tEnd };
      batterGoes = scn.kind === 'extra' && scn.me !== 'batter';
      end = Math.max(tEnd, thr.t1) + 1.6;
    } else {
      end = Math.max(tm.tBase, thr.t1) + 1.4;
    }
  }

  // 타자: 안타면 1루로 뛰고, 리드 주자가 송구 승부를 하면 송구 사이에 2루까지 간다. 플라이면 잡히는 순간 멈춘다.
  let batter: Key[] | null = null;
  const batterStart = RUN.batterStartDelay;
  if (scn.me !== 'batter') {
    const box = batterBoxOf(scn);
    const t1 = batterStart + box.distanceTo(BASES.first) / RUN.speed;
    if (scn.kind === 'tagup') {
      const stopT = hit.fieldT + 0.3;
      const leg: Key[] = [{ t: batterStart, pos: box }, { t: t1, pos: bag('first') }];
      batter = [...leg.filter((k) => k.t < stopT), { t: stopT, pos: trackAt(leg, stopT).pos.clone() }];
    } else {
      batter = [{ t: batterStart, pos: box }, { t: t1, pos: bag('first') }];
      if (batterGoes) batter.push({ t: t1 + RUNNER.roundTime + 27.43 / RUNNER.speed, pos: bag('second') });
    }
  }

  return { start: startT, tWindup, tRelease, ball, fielders: moves, me, batter, batterStart, calls, plays, decisionAt: tm.decisionAt, deadline: tm.deadline, end, slide };
}
