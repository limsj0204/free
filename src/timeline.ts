import * as THREE from 'three';
import { PITCH, RUN, THROW } from './config';
import { BASES, P, bagSpot, fencePoint, type BaseId } from './coords';
import { fieldersOf } from './scenarios';
import {
  batterBox,
  coverPath,
  decisionDeadline,
  planRunners,
  type ChoiceScenario,
  type FielderId,
  type Grade,
  type Outcome,
  type PlayEvent,
  type RunnerId,
  type ThrowScenario,
} from './scenario';

// 한 번의 플레이를 시간(t)의 함수로 표현한다. t=0은 공이 홈플레이트에 도착하는 순간(타격).
// 결정 전과 후에 같은 함수로 다시 만들어도 결정 전 구간은 똑같아서, 리플레이도 이걸 다시 재생하면 된다.

export interface BallSeg {
  from: THREE.Vector3;
  to: THREE.Vector3;
  t0: number;
  t1: number;
  arc: number; // 포물선 높이 (bounces가 있으면 튀는 높이)
  bounces?: number;
  thrower?: FielderId;
}

export interface Path {
  waypoints: THREE.Vector3[];
  startTime: number;
  speed: number;
  stopAt?: number; // 아웃되면 그 자리에 멈춘다
}

export interface Move {
  from: THREE.Vector3;
  to: THREE.Vector3;
  t0: number;
  t1: number;
}

export interface Call {
  t: number;
  pos: THREE.Vector3;
  text: string;
  good: boolean;
}

export interface ChoiceResult {
  index: number | null;
  grade: Grade;
  headline: string;
  result: string;
  feedback: string;
  late: boolean;
  playerArrival: number;
  deadline: number; // 이 시간까지 도착해야 제때
}

export interface Timeline {
  start: number;
  tWindup: number;
  tRelease: number;
  pitch: boolean; // 투수가 타자에게 공을 던지는지 (견제면 false)
  pickoffAt?: number;
  ballStart: THREE.Vector3;
  ball: BallSeg[];
  gloveHold: [number, number] | null; // 1인칭 글러브에 공이 들려 있는 구간
  runners: Map<RunnerId, Path>;
  fielders: Partial<Record<FielderId, Path>>;
  player: Move[];
  playerStart: THREE.Vector3;
  batter: 'swing' | 'bunt' | 'take';
  calls: Call[];
  decisionAt: number;
  window: number;
  end: number;
  choice?: ChoiceResult;
  // 액션 모드: 타구가 잡는 지점에서 멈추지 않고 계속 굴러간다. 잡히면 그 시점부터 글러브에 있다.
  actionHit?: ActionHit;
  // 베이스에서 일어나는 플레이: 받는 수비수의 포스/태그 동작과 주자의 슬라이딩에 쓴다
  plays: BasePlay[];
}

export interface BasePlay {
  t: number;
  base: BaseId;
  runner: RunnerId;
  kind: 'force' | 'tag' | 'return';
  out: boolean;
  receiver: FielderId | 'player';
}

export function callText(kind: BasePlay['kind'], out: boolean) {
  if (!out) return '세이프';
  return kind === 'tag' ? '태그아웃!' : kind === 'return' ? '아웃! (귀루 실패)' : '포스아웃!';
}

export interface ActionHit {
  type: 'grounder' | 'roller' | 'liner' | 'bunt';
  catchPoint: THREE.Vector3;
  travelTime: number;
  caughtAt: number | null;
}

// 액션 모드 타구 위치. 상황에 정해진 지점을 정해진 시간에 지나고, 그 뒤로는 서서히 느려지며 외야로 굴러간다.
export function actionBallPos(hit: ActionHit, t: number, out = new THREE.Vector3()) {
  const start = CONTACT_POINT;
  const dir = hit.catchPoint.clone().sub(start).setY(0);
  const D = dir.length();
  dir.normalize();
  const T = hit.travelTime;
  const v = D / T;
  const decel = v / (hit.type === 'liner' ? 4 : 2.5);
  let s: number;
  if (t <= T) s = v * t;
  else {
    const dt = Math.min(t - T, v / decel);
    s = D + v * dt - 0.5 * decel * dt * dt;
  }
  out.set(start.x + dir.x * s, 0, start.z + dir.z * s);
  if (hit.type === 'liner') {
    // 가슴 높이로 날아와 잡는 지점을 지난 뒤 떨어진다
    if (t <= T) out.y = THREE.MathUtils.lerp(start.y, 1.3, t / T) + Math.sin((t / T) * Math.PI) * 0.3;
    else out.y = Math.max(0.05, 1.3 - 4 * (t - T) * (t - T));
  } else {
    const h = hit.type === 'grounder' ? 1.1 : 0.25;
    const freq = (Math.PI * (hit.type === 'grounder' ? 3.2 : 4)) / T;
    const bounce = Math.abs(Math.sin(t * freq)) * h * Math.exp(-t * 0.8);
    const drop = Math.max(0, 1 - t / 0.15) * (start.y - 0.05);
    out.y = 0.05 + Math.max(bounce, drop);
  }
  return out;
}

// 액션 모드 송구 상황: 스크립트로 정한 타구·플레이어 움직임 대신 실제 입력을 쓴다
export function buildActionThrowTimeline(scn: ThrowScenario, pitchFlight: number, outcome?: Outcome, caughtAt: number | null = null): Timeline {
  const tl = buildThrowTimeline(scn, pitchFlight, outcome);
  tl.ball = tl.ball.filter((_, i) => i !== 1); // 정해진 타구 경로는 actionBallPos가 대신한다
  tl.player = [];
  tl.actionHit = { type: scn.batted.type, catchPoint: scn.batted.catchPoint, travelTime: scn.batted.travelTime, caughtAt };
  if (caughtAt === null) tl.gloveHold = null;
  else {
    const firstThrow = tl.ball.find((b) => b.t0 >= caughtAt && b.thrower === scn.position);
    tl.gloveHold = [caughtAt, firstThrow ? firstThrow.t0 : Infinity];
  }
  return tl;
}

export const PRE_PITCH = 1.6;
export const CONTACT_POINT = P(0.1, 0.6, 0.85);
export const MITT = P(0, -0.7, 0.85);
const GLOVE = 1.2;

function pitchTimes(pitchFlight: number, prePitchDecision = false) {
  const tRelease = -pitchFlight;
  const tWindup = tRelease - PITCH.windupTime;
  // 투구 전 판단은 세트 포지션 동안 고를 시간을 따로 준다
  const start = tWindup - (prePitchDecision ? 3.2 : PRE_PITCH);
  return { tRelease, tWindup, start };
}

export function releasePoint() {
  return P(-0.4, 17.0, 1.9);
}

export function pathPosition(p: Path, t: number, out = new THREE.Vector3()): { pos: THREE.Vector3; moving: boolean } {
  const tt = Math.min(t, p.stopAt ?? Infinity);
  let dist = Math.max(0, (tt - p.startTime) * p.speed);
  const wp = p.waypoints;
  for (let i = 0; i < wp.length - 1; i++) {
    const seg = wp[i].distanceTo(wp[i + 1]);
    if (dist <= seg) {
      out.lerpVectors(wp[i], wp[i + 1], seg > 0 ? dist / seg : 1);
      return { pos: out, moving: dist > 0 && t < (p.stopAt ?? Infinity) };
    }
    dist -= seg;
  }
  out.copy(wp[wp.length - 1]);
  return { pos: out, moving: false };
}

export function pathEnd(p: Path) {
  let len = 0;
  for (let i = 0; i < p.waypoints.length - 1; i++) len += p.waypoints[i].distanceTo(p.waypoints[i + 1]);
  return p.startTime + len / p.speed;
}

export function movePosition(start: THREE.Vector3, moves: Move[], t: number, out = new THREE.Vector3()) {
  out.copy(start);
  for (const m of moves) {
    if (t >= m.t1) out.copy(m.to);
    else if (t > m.t0) {
      out.lerpVectors(m.from, m.to, (t - m.t0) / (m.t1 - m.t0));
      break;
    } else break;
  }
  return out;
}

function walk(from: THREE.Vector3, to: THREE.Vector3, startTime: number, speed = RUN.fielderSpeed): Path {
  return { waypoints: [from.clone(), to.clone()], startTime, speed };
}

// ---------- 송구 판단 상황 ----------

// 아웃 판정 시점. 베이스에서 하는 태그는 공이 먼저 와 있어도 주자가 베이스 앞까지 들어와야 태그된다.
function outTime(e: PlayEvent) {
  if (!e.tag) return e.ballTime;
  const t = e.ballTime + THROW.tagTime;
  return e.at ? t : Math.max(t, e.runnerTime - TAG_REACH / RUN.speed);
}
const TAG_REACH = 1.5; // 베이스 앞 이 거리에서 태그된다
const BACKUP_ROLL = 12; // 뒤로 빠진 송구가 굴러가는 속도

export function buildThrowTimeline(scn: ThrowScenario, pitchFlight: number, outcome?: Outcome): Timeline {
  const { tRelease, tWindup, start } = pitchTimes(pitchFlight);
  const fielders = fieldersOf(scn);
  const { type, catchPoint, travelTime } = scn.batted;
  const bunt = type === 'bunt';

  const ball: BallSeg[] = [{ from: releasePoint(), to: CONTACT_POINT, t0: tRelease, t1: 0, arc: 0.15 }];
  if (type === 'grounder') ball.push({ from: CONTACT_POINT, to: catchPoint.clone().setY(0.35), t0: 0, t1: travelTime, arc: 1.1, bounces: 3 });
  else if (type === 'bunt') ball.push({ from: CONTACT_POINT, to: catchPoint.clone().setY(0.15), t0: 0, t1: travelTime, arc: 0.25, bounces: 4 });
  else if (type === 'roller') ball.push({ from: CONTACT_POINT, to: catchPoint.clone().setY(0.15), t0: 0, t1: travelTime, arc: 0.35, bounces: 6 });
  else ball.push({ from: CONTACT_POINT, to: catchPoint.clone().setY(1.3), t0: 0, t1: travelTime, arc: 0.4 });

  const runners = new Map<RunnerId, Path>();
  const plans = planRunners(scn);
  const outAt = new Map<RunnerId, number>();
  for (const e of outcome?.events ?? []) if (e.out) outAt.set(e.runner, outTime(e));
  for (const r of plans) runners.set(r.id, { waypoints: r.waypoints, startTime: r.startTime, speed: RUN.speed, stopAt: outAt.get(r.id) });
  if (type === 'liner') {
    // 직선타가 잡히면 타자는 몇 걸음 뛰다 멈춘다
    runners.set('batter', { waypoints: [batterBox(scn), BASES.first], startTime: RUN.batterStartDelay, speed: RUN.speed, stopAt: travelTime + 0.4 });
  }

  const moves: Partial<Record<FielderId, Path>> = {};
  // 커버는 판정과 같은 경로로 움직인다 (fielderMoves를 거쳐 가는 경우 포함)
  for (const base of Object.keys(scn.covers) as BaseId[]) {
    const path = base === 'home' ? null : coverPath(scn, base);
    if (path) moves[path.id] = { waypoints: path.waypoints, startTime: path.startTime, speed: RUN.fielderSpeed };
  }
  for (const [id, to] of Object.entries(scn.fielderMoves ?? {}) as [FielderId, THREE.Vector3][]) {
    if (!moves[id]) moves[id] = walk(fielders[id], to, bunt ? tRelease : 0.1);
  }

  const playerStart = fielders[scn.position];
  const player: Move[] = [];
  if (playerStart.distanceTo(catchPoint) > 0.1) player.push({ from: playerStart, to: catchPoint, t0: bunt ? tRelease : 0, t1: travelTime });

  let holdEnd = Infinity;
  const calls: Call[] = [];
  const plays: BasePlay[] = [];
  let end = Infinity;
  if (outcome) {
    for (const s of outcome.segments) {
      if (s.carry) player.push({ from: s.from.clone().setY(0), to: s.to.clone().setY(0), t0: s.t0, t1: s.t1 });
      else {
        holdEnd = Math.min(holdEnd, s.t0);
        ball.push({ from: s.from, to: s.to, t0: s.t0, t1: s.t1, arc: s.arc, thrower: s.thrower });
      }
    }
    for (const e of outcome.events) {
      const t = e.out ? outTime(e) : e.runnerTime;
      calls.push({ t, pos: e.at ?? BASES[e.base], text: callText(e.kind, e.out), good: e.out });
      // 누가 받았나: 직접 밟거나 태그했으면 플레이어, 아니면 그 베이스로 던진 공을 받은 수비수
      const seg = [...outcome.segments].reverse().find((g) => g.to.distanceTo(BASES[e.base].clone().setY(g.to.y)) < 0.5);
      const cover = scn.covers[e.base];
      const receiver: FielderId | 'player' = !seg || seg.carry || !cover || cover === scn.position ? 'player' : cover;
      plays.push({ t: e.out ? t : Math.max(e.ballTime, e.runnerTime), base: e.base, runner: e.runner, kind: e.kind, out: e.out, receiver });
    }
    const lastCall = Math.max(0, ...calls.map((c) => c.t));
    const lastSeg = Math.max(0, ...outcome.segments.map((s) => s.t1));
    const lastRunner = Math.max(0, ...[...runners.values()].map((p) => Math.min(pathEnd(p), p.stopAt ?? Infinity)));
    end = Math.max(lastCall, lastSeg, lastRunner, travelTime + outcome.decisionDelay) + 1.3;
  }

  return {
    start,
    tWindup,
    tRelease,
    pitch: true,
    ballStart: releasePoint(),
    ball,
    gloveHold: [travelTime, holdEnd],
    runners,
    fielders: moves,
    player,
    playerStart,
    batter: bunt ? 'bunt' : 'swing',
    calls,
    plays,
    decisionAt: travelTime,
    window: decisionDeadline(scn),
    end,
  };
}

// ---------- 위치 판단 상황 ----------

export interface ChoiceInput {
  index: number | null; // null이면 시간 초과
  d: number; // 결정까지 걸린 게임 시간
  arrival?: number; // 액션 모드: 실제로 그 위치에 도착한 시간 (플레이어 움직임은 입력 기록을 쓴다)
}

export function buildChoiceTimeline(scn: ChoiceScenario, pitchFlight: number, input?: ChoiceInput): Timeline {
  const prePitch = scn.setup === 'pickoff' || scn.setup === 'bunt';
  const { tRelease, tWindup, start } = pitchTimes(pitchFlight, prePitch);
  const fielders = fieldersOf(scn);
  const playerStart = fielders[scn.position];

  const tl: Timeline = {
    start,
    tWindup,
    tRelease,
    pitch: true,
    ballStart: releasePoint(),
    ball: [],
    gloveHold: null,
    runners: new Map(),
    fielders: {},
    player: [],
    playerStart,
    batter: 'take',
    calls: [],
    plays: [],
    decisionAt: 0,
    window: 1.5,
    end: Infinity,
  };

  const opt = input && input.index !== null ? scn.options[input.index] : undefined;
  const decide = (decisionAt: number, window: number) => {
    tl.decisionAt = decisionAt;
    tl.window = window;
  };
  // 선택한 위치로 이동. 반환값은 도착 시간 (선택 전이면 Infinity)
  const movePlayer = (earliest = -Infinity) => {
    if (!input || !opt) return Infinity;
    if (input.arrival !== undefined) return input.arrival;
    const t0 = Math.max(tl.decisionAt + input.d + RUN.reaction, earliest);
    const t1 = t0 + playerStart.distanceTo(opt.moveTo) / RUN.fielderSpeed;
    tl.player.push({ from: playerStart, to: opt.moveTo, t0, t1 });
    return t1;
  };
  const fielderMovesFrom = (t: number) => {
    for (const [id, to] of Object.entries(scn.fielderMoves ?? {}) as [FielderId, THREE.Vector3][]) {
      tl.fielders[id] = walk(fielders[id], to, t);
    }
  };
  const lead1 = (extra = 0) => BASES.first.clone().add(BASES.second.clone().sub(BASES.first).normalize().multiplyScalar(RUN.leadOff + extra));

  let arrival = Infinity;
  let deadline = Infinity;
  let late = false;

  switch (scn.setup) {
    case 'steal': {
      tl.batter = 'take';
      tl.ball.push({ from: releasePoint(), to: MITT, t0: tRelease, t1: 0, arc: 0.15 });
      const runStart = tWindup + 0.3;
      const lead = lead1();
      const runArrive = runStart + lead.distanceTo(BASES.second) / RUN.speed;
      decide(tRelease + 0.05, 0);
      const t0 = THROW.catcherPopTime;
      const target = BASES.second.clone().setY(0.6);
      const throwFrom = MITT.clone().setY(1.5);
      const t1 = t0 + throwFrom.distanceTo(target) / THROW.catcherSpeed;
      tl.window = t1 - tl.decisionAt - 0.25;
      deadline = t1 + 0.05;
      fielderMovesFrom(tl.decisionAt + 0.2);
      arrival = movePlayer();
      late = !!opt?.takes && arrival > deadline;
      const received = !!input && (scn.otherCovers || (!!opt?.takes && !late));
      if (!input) {
        tl.runners.set('r1', { waypoints: [lead, BASES.second.clone()], startTime: runStart, speed: RUN.speed });
        break;
      }
      tl.ball.push({ from: throwFrom, to: target, t0, t1, arc: 0.5, thrower: 'C' });
      if (received) {
        const out = t1 + THROW.tagTime < runArrive;
        const tagT = out ? Math.max(t1 + THROW.tagTime, runArrive - TAG_REACH / RUN.speed) : runArrive;
        tl.runners.set('r1', { waypoints: [lead, BASES.second.clone()], startTime: runStart, speed: RUN.speed, stopAt: out ? tagT : undefined });
        tl.calls.push({ t: tagT, pos: BASES.second, text: callText('tag', out), good: out });
        // 2루에서 받는 사람: 내가 커버했으면 나, 아니면 2루로 들어간 다른 수비수
        const other = (Object.entries(scn.fielderMoves ?? {}) as [FielderId, THREE.Vector3][]).find(([, to]) => to.distanceTo(BASES.second) < 2)?.[0];
        const receiver: FielderId | 'player' = opt?.takes && !late ? 'player' : (other ?? 'player');
        tl.plays.push({ t: tagT, base: 'second', runner: 'r1', kind: 'tag', out, receiver });
        tl.end = t1 + 2;
      } else {
        tl.ball.push({ from: target, to: P(1, 60, 0.1), t0: t1, t1: t1 + 1.6, arc: 0.5, bounces: 3 });
        tl.runners.set('r1', { waypoints: [lead, BASES.second.clone(), BASES.third.clone()], startTime: runStart, speed: RUN.speed });
        tl.calls.push({ t: t1 + 0.1, pos: BASES.second, text: '빠졌다!', good: false });
        tl.end = runStart + (lead.distanceTo(BASES.second) + 27.43) / RUN.speed + 0.8;
      }
      break;
    }

    case 'gap': {
      const sgn = scn.side === 'left' ? -1 : 1;
      tl.batter = 'swing';
      const fence = fencePoint(sgn * 22 * (Math.PI / 180), -1.2);
      const landing = fence.clone().multiplyScalar(0.84);
      tl.ball.push({ from: releasePoint(), to: CONTACT_POINT, t0: tRelease, t1: 0, arc: 0.15 });
      tl.ball.push({ from: CONTACT_POINT, to: landing.clone().setY(0.1), t0: 0, t1: 1.6, arc: 6 });
      tl.ball.push({ from: landing.clone().setY(0.1), to: fence.clone().setY(0.1), t0: 1.6, t1: 3.8, arc: 0.6, bounces: 2 });
      const retriever: FielderId = sgn < 0 ? 'LF' : 'RF';
      const pick = fence.clone().multiplyScalar(0.975);
      tl.fielders[retriever] = { waypoints: [fielders[retriever].clone(), pick], startTime: 0.3, speed: fielders[retriever].distanceTo(pick) / 4.3 };
      const cfTo = P(sgn * 13, 84);
      tl.fielders.CF = { waypoints: [fielders.CF.clone(), cfTo], startTime: 0.3, speed: RUN.fielderSpeed };
      fielderMovesFrom(0.4);
      decide(0.5, 1.6);
      const throwT0 = 5.0;
      deadline = throwT0;
      const box = batterBox(scn);
      arrival = movePlayer();
      late = !!opt?.takes && arrival > deadline;
      const received = !!opt?.takes && !late;
      if (!input) {
        tl.runners.set('batter', { waypoints: [box, BASES.first.clone(), BASES.second.clone()], startTime: RUN.batterStartDelay, speed: RUN.speed });
        break;
      }
      const from = pick.clone().setY(1.6);
      if (received) {
        const to = opt!.moveTo.clone().setY(1.5);
        tl.ball.push({ from, to, t0: throwT0, t1: throwT0 + from.distanceTo(to) / THROW.outfieldSpeed, arc: 2.5, thrower: retriever });
        tl.runners.set('batter', { waypoints: [box, BASES.first.clone(), BASES.second.clone()], startTime: RUN.batterStartDelay, speed: RUN.speed });
        tl.calls.push({ t: throwT0 + from.distanceTo(to) / THROW.outfieldSpeed, pos: opt!.moveTo, text: '중계!', good: true });
      } else {
        const bounce = P(sgn * 6, 44, 0.1);
        const t1 = throwT0 + from.distanceTo(bounce) / THROW.outfieldSpeed;
        tl.ball.push({ from, to: bounce, t0: throwT0, t1, arc: 3, thrower: retriever });
        tl.ball.push({ from: bounce, to: P(sgn * 1, 33, 0.1), t0: t1, t1: t1 + 1.4, arc: 0.6, bounces: 2 });
        tl.runners.set('batter', {
          waypoints: [box, BASES.first.clone(), BASES.second.clone(), BASES.third.clone()],
          startTime: RUN.batterStartDelay,
          speed: RUN.speed,
        });
        tl.calls.push({ t: t1 + 1.4, pos: BASES.second, text: '3루까지!', good: false });
      }
      tl.end = 8.6;
      break;
    }

    case 'cutoff': {
      tl.batter = 'swing';
      const field = P(0.8, 57.5);
      tl.ball.push({ from: releasePoint(), to: CONTACT_POINT, t0: tRelease, t1: 0, arc: 0.15 });
      tl.ball.push({ from: CONTACT_POINT, to: field.clone().setY(0.1), t0: 0, t1: 2.8, arc: 0.9, bounces: 4 });
      tl.fielders.CF = walk(fielders.CF, field.clone().add(P(0, 0.8)), 0.1);
      const lead2 = BASES.second.clone().add(BASES.third.clone().sub(BASES.second).normalize().multiplyScalar(RUN.leadOff));
      tl.runners.set('r2', { waypoints: [lead2, BASES.third.clone()], startTime: RUN.runnerStartDelay, speed: RUN.speed });
      decide(0.6, 1.6);
      const throwT0 = 3.1;
      const from = field.clone().setY(1.6);
      const homeTo = BASES.home.clone().setY(1.0);
      const box = batterBox(scn);
      const cutSpot = scn.options.find((o) => o.takes)!.moveTo;
      deadline = throwT0 + from.distanceTo(cutSpot.clone().setY(1.6)) / THROW.outfieldSpeed;
      arrival = movePlayer();
      late = !!opt?.takes && arrival > deadline;
      const received = !!opt?.takes && !late;
      if (!input) {
        tl.runners.set('batter', { waypoints: [box, BASES.first.clone()], startTime: RUN.batterStartDelay, speed: RUN.speed });
        break;
      }
      if (received) {
        const to = opt!.moveTo.clone().setY(1.6);
        tl.ball.push({ from, to, t0: throwT0, t1: deadline, arc: 2, thrower: 'CF' });
        tl.runners.set('batter', { waypoints: [box, BASES.first.clone(), P(23, 23.5)], startTime: RUN.batterStartDelay, speed: RUN.speed });
        tl.calls.push({ t: deadline, pos: opt!.moveTo, text: '커트!', good: true });
        tl.end = 7.2;
      } else {
        const t1 = throwT0 + from.distanceTo(homeTo) / THROW.outfieldSpeed;
        tl.ball.push({ from, to: homeTo, t0: throwT0, t1, arc: 2.5, thrower: 'CF' });
        const p: Path = { waypoints: [box, BASES.first.clone(), BASES.second.clone()], startTime: RUN.batterStartDelay, speed: RUN.speed };
        tl.runners.set('batter', p);
        tl.calls.push({ t: pathEnd(p), pos: BASES.second, text: '세이프', good: false });
        tl.end = pathEnd(p) + 1;
      }
      break;
    }

    case 'pickoff': {
      tl.batter = 'take';
      decide(start + 0.5, 2.2);
      arrival = movePlayer();
      const lead = lead1();
      if (!input) {
        tl.runners.set('r1', { waypoints: [lead], startTime: 0, speed: RUN.speed });
        break;
      }
      if (opt?.takes) {
        // 1루수가 붙어 있으니 투수가 견제구를 던진다
        tl.pitch = false;
        const t0 = Math.max(arrival + 0.3, tl.decisionAt + input.d + 1.0);
        tl.pickoffAt = t0;
        const from = P(0.4, 18.6, 1.8);
        const to = bagSpot('first').setY(0.6);
        const t1 = t0 + from.distanceTo(to) / 24;
        tl.ballStart = from;
        tl.ball.push({ from, to, t0, t1, arc: 0.4, thrower: 'P' });
        tl.runners.set('r1', { waypoints: [lead, BASES.first.clone()], startTime: t0 - 0.05, speed: RUN.speed });
        tl.calls.push({ t: t1 + 0.1, pos: BASES.first, text: '귀루', good: true });
        tl.end = t1 + 1.5;
      } else {
        const bigLead = lead1(1.5);
        tl.ball.push({ from: releasePoint(), to: MITT, t0: tRelease, t1: 0, arc: 0.15 });
        const p: Path = { waypoints: [bigLead, BASES.second.clone()], startTime: tWindup + 0.1, speed: RUN.speed };
        tl.runners.set('r1', p);
        tl.calls.push({ t: pathEnd(p), pos: BASES.second, text: '세이프', good: false });
        tl.end = pathEnd(p) + 1.2;
      }
      break;
    }

    case 'bunt': {
      tl.batter = 'bunt';
      decide(start + 0.5, 2.2);
      const buntAt = P(-10.5, 10);
      tl.ball.push({ from: releasePoint(), to: CONTACT_POINT, t0: tRelease, t1: 0, arc: 0.15 });
      tl.ball.push({ from: CONTACT_POINT, to: buntAt.clone().setY(0.12), t0: 0, t1: 2.0, arc: 0.25, bounces: 4 });
      fielderMovesFrom(tRelease);
      // 투구와 동시에 움직인다
      arrival = movePlayer(tRelease - 0.2);
      const lead = lead1();
      tl.runners.set('r1', { waypoints: [lead, BASES.second.clone()], startTime: RUN.buntRunnerStartDelay, speed: RUN.speed });
      const box = batterBox(scn);
      const batterPath: Path = { waypoints: [box, BASES.first.clone()], startTime: RUN.buntBatterStartDelay, speed: RUN.speed };
      tl.runners.set('batter', batterPath);
      if (!input) break;
      const firstTo = bagSpot('first').setY(GLOVE);
      if (opt?.takes) {
        const fieldT = Math.max(2.0, arrival);
        const throwT0 = fieldT + 0.4;
        const from = opt.moveTo.clone().setY(GLOVE);
        const t1 = throwT0 + from.distanceTo(firstTo) / THROW.speed;
        if (input.arrival === undefined) tl.player.push({ from: opt.moveTo, to: buntAt, t0: Math.max(arrival, 1.4), t1: fieldT });
        tl.gloveHold = [fieldT, throwT0];
        tl.ball.push({ from: buntAt.clone().setY(GLOVE), to: firstTo, t0: throwT0, t1, arc: 0.8, thrower: scn.position });
        batterPath.stopAt = t1;
        tl.calls.push({ t: t1, pos: BASES.first, text: callText('force', true), good: true });
        tl.end = t1 + 1.5;
      } else {
        // 3루수가 없으니 투수가 늦게 처리한다
        tl.fielders.P = walk(fielders.P, buntAt.clone().add(P(0.4, 0.6)), 0.6);
        const throwT0 = 3.5;
        const from = buntAt.clone().setY(GLOVE);
        const t1 = throwT0 + from.distanceTo(firstTo) / THROW.speed;
        tl.ball.push({ from, to: firstTo, t0: throwT0, t1, arc: 0.8, thrower: 'P' });
        tl.calls.push({ t: pathEnd(batterPath), pos: BASES.first, text: '세이프', good: false });
        tl.end = t1 + 1.5;
      }
      break;
    }

    case 'backup': {
      // 외야수가 안타를 잡아 base로 던지고, 그 송구가 뒤로 빠진다. 백업 자리에 있으면 막는다.
      const b = scn.backup!;
      tl.batter = 'swing';
      tl.ball.push({ from: releasePoint(), to: CONTACT_POINT, t0: tRelease, t1: 0, arc: 0.15 });
      tl.ball.push({ from: CONTACT_POINT, to: b.field.clone().setY(0.1), t0: 0, t1: b.travelTime, arc: 0.9, bounces: 4 });
      tl.fielders[b.fielder] = walk(fielders[b.fielder], b.field.clone().add(P(0, 0.8)), 0.1);
      fielderMovesFrom(0.3);
      decide(0.6, 1.6);
      const throwT0 = b.travelTime + 0.3;
      const from = b.field.clone().setY(1.6);
      const baseAt = BASES[b.base].clone().setY(1.0);
      const t1 = throwT0 + from.distanceTo(baseAt) / THROW.outfieldSpeed;
      const spot = scn.options.find((o) => o.takes)!.moveTo.clone().setY(0.3);
      deadline = t1 + baseAt.distanceTo(spot) / BACKUP_ROLL;
      arrival = movePlayer();
      late = !!opt?.takes && arrival > deadline;
      const received = !!opt?.takes && !late;
      // 홈 승부면 2루 주자, 3루 승부면 1루 주자가 그 베이스까지 뛴다
      const leadId: RunnerId = b.base === 'home' ? 'r2' : 'r1';
      const origin = b.base === 'home' ? BASES.second : BASES.first;
      const via = b.base === 'home' ? BASES.third : BASES.second;
      const lead = origin.clone().add(via.clone().sub(origin).normalize().multiplyScalar(RUN.leadOff));
      const leadPath: Path = { waypoints: [lead, via.clone(), BASES[b.base].clone()], startTime: RUN.runnerStartDelay, speed: RUN.speed };
      tl.runners.set(leadId, leadPath);
      const box = batterBox(scn);
      if (!input) {
        tl.runners.set('batter', { waypoints: [box, BASES.first.clone()], startTime: RUN.batterStartDelay, speed: RUN.speed });
        break;
      }
      tl.ball.push({ from, to: baseAt, t0: throwT0, t1, arc: 2.5, thrower: b.fielder });
      tl.calls.push({ t: t1 + 0.1, pos: BASES[b.base], text: '빠졌다!', good: false });
      if (received) {
        tl.ball.push({ from: baseAt, to: spot, t0: t1, t1: deadline, arc: 0.3, bounces: 2 });
        tl.runners.set('batter', { waypoints: [box, BASES.first.clone(), P(23, 23.5)], startTime: RUN.batterStartDelay, speed: RUN.speed });
        tl.calls.push({ t: deadline, pos: opt!.moveTo, text: '백업!', good: true });
        tl.end = deadline + 2;
      } else {
        const dir = baseAt.clone().sub(from).setY(0).normalize();
        const past = BASES[b.base].clone().addScaledVector(dir, 16).setY(0.1);
        tl.ball.push({ from: baseAt, to: past, t0: t1, t1: t1 + 2.2, arc: 0.4, bounces: 3 });
        // 공이 빠진 사이 한 베이스씩 더 간다
        if (b.base === 'third') leadPath.waypoints.push(BASES.home.clone());
        const extra = b.base === 'home' ? [BASES.second.clone(), BASES.third.clone()] : [BASES.second.clone()];
        tl.runners.set('batter', { waypoints: [box, BASES.first.clone(), ...extra], startTime: RUN.batterStartDelay, speed: RUN.speed });
        tl.end = t1 + 4;
      }
      break;
    }

    case 'cover': {
      const c = scn.play!;
      const bunt = c.batted === 'bunt';
      tl.batter = bunt ? 'bunt' : 'swing';
      tl.ball.push({ from: releasePoint(), to: CONTACT_POINT, t0: tRelease, t1: 0, arc: 0.15 });
      tl.ball.push({
        from: CONTACT_POINT,
        to: c.catchPoint.clone().setY(bunt ? 0.15 : 0.35),
        t0: 0,
        t1: c.travelTime,
        arc: bunt ? 0.25 : 1.1,
        bounces: bunt ? 4 : 3,
      });
      // 공을 잡는 수비수는 타구 도착에 맞춰 그 자리로 간다
      const fStart = fielders[c.fielder];
      const fT0 = bunt ? tRelease : 0;
      tl.fielders[c.fielder] = {
        waypoints: [fStart.clone(), c.catchPoint.clone()],
        startTime: fT0,
        speed: Math.max(0.1, fStart.distanceTo(c.catchPoint) / (c.travelTime - fT0)),
      };
      fielderMovesFrom(bunt ? tRelease : 0.2);
      // 번트는 타자가 번트 자세를 잡는 투구 순간, 땅볼은 타구 방향이 보이는 순간에 판단한다
      decide(bunt ? tRelease + 0.05 : 0.25, 1.5);
      const box = batterBox(scn);
      const batterPath: Path = {
        waypoints: [box, BASES.first.clone()],
        startTime: bunt ? RUN.buntBatterStartDelay : RUN.batterStartDelay,
        speed: RUN.speed,
      };
      tl.runners.set('batter', batterPath);
      let r1Path: Path | undefined;
      if (scn.situation.runners.first) {
        r1Path = {
          waypoints: [lead1(), BASES.second.clone()],
          startTime: bunt ? RUN.buntRunnerStartDelay : RUN.runnerStartDelay,
          speed: RUN.speed,
        };
        tl.runners.set('r1', r1Path);
      }
      const target = c.base === 'first' ? batterPath : r1Path!;
      const from = c.catchPoint.clone().setY(GLOVE);
      const to = bagSpot(c.base).setY(GLOVE);
      const dist = from.distanceTo(to);
      const toss = dist <= THROW.tossMaxDistance;
      const throwT0 = c.travelTime + 0.5;
      const t1 = throwT0 + dist / (toss ? THROW.tossSpeed : THROW.speed);
      deadline = t1;
      arrival = movePlayer();
      late = !!opt?.takes && arrival > deadline;
      if (!input) break;
      // 커버가 있든 없든 공은 베이스로 던진다
      tl.ball.push({ from, to, t0: throwT0, t1, arc: toss ? 0.6 : 0.8, thrower: c.fielder });
      const runnerArrive = pathEnd(target);
      if (opt?.takes && !late) {
        const out = t1 < runnerArrive;
        if (out) target.stopAt = t1;
        tl.calls.push({ t: out ? t1 : runnerArrive, pos: BASES[c.base], text: callText('force', out), good: out });
        tl.plays.push({ t: out ? t1 : runnerArrive, base: c.base, runner: c.base === 'first' ? 'batter' : 'r1', kind: 'force', out, receiver: 'player' });
        tl.end = Math.max(t1, runnerArrive) + 1.5;
      } else {
        const past = to.clone().add(to.clone().sub(from).setY(0).normalize().multiplyScalar(14)).setY(0.1);
        tl.ball.push({ from: to, to: past, t0: t1, t1: t1 + 1.3, arc: 0.5, bounces: 3 });
        target.waypoints.push(BASES[c.base === 'first' ? 'second' : 'third'].clone());
        tl.calls.push({ t: t1 + 0.1, pos: BASES[c.base], text: '빠졌다!', good: false });
        tl.end = t1 + 3;
      }
      break;
    }
  }

  if (input) {
    const base = opt ?? null;
    let grade: Grade = base ? base.grade : 'bad';
    let headline = base ? base.headline : '제자리에 멈춰 있었어요';
    let feedback = base ? base.feedback : '정해진 시간 안에 움직이지 못했어요. 상황을 보자마자 바로 움직여야 해요.';
    let result = base ? base.result : scn.options.find((o) => o.grade === 'bad')?.result ?? '';
    if (late && base) {
      grade = 'bad';
      headline = '맞는 위치였지만 늦었어요';
      feedback = `${base.label}가 맞아요. 하지만 늦게 출발해서 공보다 늦게 도착했어요. 상황을 보자마자 바로 움직여야 해요.`;
      result = scn.options.find((o) => !o.takes && o.grade === 'bad')?.result ?? result;
    }
    if (!base) {
      // 시간 초과면 제자리에 있었던 것과 같다
      tl.end = Math.max(tl.end === Infinity ? 0 : tl.end, tl.decisionAt + tl.window + 2);
    }
    tl.choice = { index: input.index, grade, headline, result, feedback, late, playerArrival: arrival, deadline };
  }
  return tl;
}
