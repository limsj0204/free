import * as THREE from 'three';
import { PITCH, RUN, THROW } from './config';
import { BASES, P, fencePoint, type BaseId } from './coords';
import { fieldersOf } from './scenarios';
import {
  batterBox,
  decisionDeadline,
  planRunners,
  type ChoiceScenario,
  type FielderId,
  type Grade,
  type Outcome,
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

function bagSpot(base: BaseId) {
  // 베이스 바로 안쪽 (내야 중심 방향으로 0.5m)
  const center = P(0, 19.4);
  const b = BASES[base];
  return b.clone().add(center.clone().sub(b).setY(0).normalize().multiplyScalar(0.5));
}

function walk(from: THREE.Vector3, to: THREE.Vector3, startTime: number, speed = RUN.fielderSpeed): Path {
  return { waypoints: [from.clone(), to.clone()], startTime, speed };
}

// ---------- 송구 판단 상황 ----------

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
  for (const e of outcome?.events ?? []) if (e.out) outAt.set(e.runner, e.ballTime + (e.tag ? THROW.tagTime : 0));
  for (const r of plans) runners.set(r.id, { waypoints: r.waypoints, startTime: r.startTime, speed: RUN.speed, stopAt: outAt.get(r.id) });
  if (type === 'liner') {
    // 직선타가 잡히면 타자는 몇 걸음 뛰다 멈춘다
    runners.set('batter', { waypoints: [batterBox(scn), BASES.first], startTime: RUN.batterStartDelay, speed: RUN.speed, stopAt: travelTime + 0.4 });
  }

  const moves: Partial<Record<FielderId, Path>> = {};
  for (const [base, id] of Object.entries(scn.covers) as [BaseId, FielderId][]) {
    if (!id || id === scn.position || base === 'home') continue;
    moves[id] = walk(fielders[id], bagSpot(base), bunt ? tRelease : 0.2);
  }
  for (const [id, to] of Object.entries(scn.fielderMoves ?? {}) as [FielderId, THREE.Vector3][]) {
    moves[id] = walk(fielders[id], to, bunt ? tRelease : 0.1);
  }

  const playerStart = fielders[scn.position];
  const player: Move[] = [];
  if (playerStart.distanceTo(catchPoint) > 0.1) player.push({ from: playerStart, to: catchPoint, t0: bunt ? tRelease : 0, t1: travelTime });

  let holdEnd = Infinity;
  const calls: Call[] = [];
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
      calls.push({
        t: e.out ? e.ballTime + (e.tag ? THROW.tagTime : 0) : e.runnerTime,
        pos: BASES[e.base],
        text: e.out ? '아웃!' : '세이프',
        good: e.out,
      });
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
    decisionAt: travelTime,
    window: decisionDeadline(scn),
    end,
  };
}

// ---------- 위치 판단 상황 ----------

export interface ChoiceInput {
  index: number | null; // null이면 시간 초과
  d: number; // 결정까지 걸린 게임 시간
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
        tl.runners.set('r1', { waypoints: [lead, BASES.second.clone()], startTime: runStart, speed: RUN.speed, stopAt: out ? t1 + THROW.tagTime : undefined });
        tl.calls.push({ t: out ? t1 + THROW.tagTime : runArrive, pos: BASES.second, text: out ? '아웃!' : '세이프', good: out });
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
        tl.player.push({ from: opt.moveTo, to: buntAt, t0: Math.max(arrival, 1.4), t1: fieldT });
        tl.gloveHold = [fieldT, throwT0];
        tl.ball.push({ from: buntAt.clone().setY(GLOVE), to: firstTo, t0: throwT0, t1, arc: 0.8, thrower: scn.position });
        batterPath.stopAt = t1;
        tl.calls.push({ t: t1, pos: BASES.first, text: '아웃!', good: true });
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
        tl.calls.push({ t: out ? t1 : runnerArrive, pos: BASES[c.base], text: out ? '아웃!' : '세이프', good: out });
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
