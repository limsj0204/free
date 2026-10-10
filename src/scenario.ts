import * as THREE from 'three';
import { RUN, THROW, VALUE } from './config';
import { BASES, BASE_LABEL, P, bagSpot, type BaseId } from './coords';
import { fieldersOf } from './scenarios';

export type FielderId = 'P' | 'C' | '1B' | '2B' | 'SS' | '3B' | 'LF' | 'CF' | 'RF';
export type PositionId = '1B' | '2B' | 'SS' | '3B';
export type RunnerId = 'batter' | 'r1' | 'r2' | 'r3';
export type Base3 = 'first' | 'second' | 'third';
export type Grade = 'best' | 'ok' | 'bad';

export const POSITIONS: PositionId[] = ['1B', '2B', 'SS', '3B'];

export const FIELDER_NAME: Record<FielderId, string> = {
  P: '투수',
  C: '포수',
  '1B': '1루수',
  '2B': '2루수',
  SS: '유격수',
  '3B': '3루수',
  LF: '좌익수',
  CF: '중견수',
  RF: '우익수',
};

export const RUNNER_NAME: Record<RunnerId, string> = {
  batter: '타자 주자',
  r1: '1루 주자',
  r2: '2루 주자',
  r3: '3루 주자',
};

export interface Situation {
  outs: number;
  runners: Record<Base3, boolean>;
  batter: 'R' | 'L';
}

interface ScenarioBase {
  id: string;
  title: string;
  event: string; // 브리핑의 '타격' 칸에 보이는 짧은 설명 (예: 정면 땅볼, 1루 주자 도루)
  position: PositionId; // 1인칭으로 플레이하는 포지션
  situation: Situation;
  brief: string; // 투구 전 상황 설명
  explanation: string; // 결과 화면의 해설
  fielders?: Partial<Record<FielderId, THREE.Vector3>>; // 기본 수비 위치에서 바꿀 것만
  fielderMoves?: Partial<Record<FielderId, THREE.Vector3>>; // 플레이가 시작되면 이동할 위치
}

// 공을 잡은 뒤 어디로 던질지 고르는 상황. 결과는 시간 계산으로 판정한다.
export interface ThrowScenario extends ScenarioBase {
  kind: 'throw';
  batted: { type: 'grounder' | 'roller' | 'liner' | 'bunt'; catchPoint: THREE.Vector3; travelTime: number }; // roller: 느린 땅볼
  covers: Partial<Record<BaseId, FielderId>>; // 각 베이스에서 공을 받을 수비수
  selfBases?: BaseId[]; // 던지지 않고 직접 밟으러 가는 베이스
  runnerActs?: Partial<Record<Base3, 'advance' | 'hold'>>; // 안 밀리는 주자가 뛸지 (땅볼일 때)
  hitAndRun?: boolean; // 투구 때 주자가 미리 스타트했는지
  runnerJump?: boolean; // 번트: 밀려 뛰는 주자의 스타트가 빠르다
  generated?: boolean; // 상황 생성기로 만든 상황 (랜덤 연습에만 나온다)
}

export interface ChoiceOption {
  label: string;
  moveTo: THREE.Vector3;
  grade: Grade;
  headline: string;
  result: string; // 결과 상황 한 줄
  feedback: string; // 이 선택에 대한 설명
  takes?: boolean; // 이 위치로 가면 송구를 받거나 공을 처리하게 되는지
}

// 공이 나에게 오지 않을 때 어디로 움직일지 고르는 상황. 선택지별 결과가 정해져 있다.
export interface ChoiceScenario extends ScenarioBase {
  kind: 'choice';
  setup: 'steal' | 'gap' | 'cutoff' | 'pickoff' | 'bunt' | 'cover';
  side?: 'left' | 'right'; // gap: 좌중간/우중간
  // cover: 다른 수비수가 공을 잡아 base로 던질 때 내가 그 베이스를 커버하는지
  play?: { fielder: FielderId; catchPoint: THREE.Vector3; travelTime: number; base: BaseId; batted: 'grounder' | 'bunt' };
  otherCovers?: boolean; // steal: 다른 수비수가 2루 커버를 들어가는지
  prompt: string;
  options: ChoiceOption[];
}

export type Scenario = ThrowScenario | ChoiceScenario;

// ---------- 송구 판정 엔진 ----------

export type Choice = BaseId | 'hold';
export const THROW_CHOICES: Choice[] = ['first', 'second', 'third', 'home', 'hold'];

const BASE_ORDER: BaseId[] = ['home', 'first', 'second', 'third'];
const nextBase = (b: BaseId) => BASE_ORDER[(BASE_ORDER.indexOf(b) + 1) % 4];
const runnerOf = (b: Base3): RunnerId => (b === 'first' ? 'r1' : b === 'second' ? 'r2' : 'r3');

export interface RunnerPlan {
  id: RunnerId;
  origin: BaseId;
  kind: 'force' | 'advance' | 'return' | 'hold';
  target: BaseId; // force/advance: 가려는 베이스, return/hold: 원래 베이스
  waypoints: THREE.Vector3[];
  startTime: number;
  arrival: number;
}

export function batterBox(scn: Scenario) {
  return P(scn.situation.batter === 'R' ? -0.9 : 0.9, 0);
}

export function planRunners(scn: ThrowScenario): RunnerPlan[] {
  const plans: RunnerPlan[] = [];
  const { type, travelTime } = scn.batted;
  const liner = type === 'liner';
  const bunt = type === 'bunt';
  const s = scn.situation;

  if (!liner) {
    const from = batterBox(scn);
    const start = bunt ? RUN.buntBatterStartDelay : RUN.batterStartDelay;
    plans.push({
      id: 'batter',
      origin: 'home',
      kind: 'force',
      target: 'first',
      waypoints: [from, BASES.first],
      startTime: start,
      arrival: start + from.distanceTo(BASES.first) / RUN.speed,
    });
  }

  let forced = true;
  for (const base of ['first', 'second', 'third'] as const) {
    const occupied = s.runners[base];
    forced = forced && occupied;
    if (!occupied) continue;
    const next = nextBase(base);
    const dir = BASES[next].clone().sub(BASES[base]).normalize();
    const lead = BASES[base].clone().addScaledVector(dir, RUN.leadOff);
    const id = runnerOf(base);

    if (liner) {
      // 직선타: 잡히는 걸 보고 원래 베이스로 돌아가야 한다
      const reverseT = travelTime + RUN.returnReaction;
      const startLead = scn.hitAndRun ? RUN.leadOff + RUN.hitAndRunExtra : RUN.leadOff;
      const forward = scn.hitAndRun ? RUN.speed * reverseT : 1.5;
      const maxOut = BASES[base].distanceTo(BASES[next]) - 1;
      const revDist = Math.min(maxOut, startLead + forward);
      const from = BASES[base].clone().addScaledVector(dir, startLead);
      const rev = BASES[base].clone().addScaledVector(dir, revDist);
      const startTime = reverseT - (revDist - startLead) / RUN.speed;
      plans.push({
        id,
        origin: base,
        kind: 'return',
        target: base,
        waypoints: [from, rev, BASES[base].clone()],
        startTime,
        arrival: reverseT + revDist / RUN.speed,
      });
      continue;
    }

    // 안 밀리는 주자: 정해진 행동이 있으면 따르고, 없으면 2아웃일 때만 뛴다
    const act = scn.runnerActs?.[base] ?? (s.outs === 2 ? 'advance' : 'hold');
    const advance = forced || act === 'advance';
    if (advance) {
      const start = forced
        ? bunt
          ? RUN.buntRunnerStartDelay - (scn.runnerJump ? RUN.buntJump : 0)
          : RUN.runnerStartDelay
        : s.outs === 2
          ? RUN.runnerStartDelay
          : RUN.advanceStartDelay;
      plans.push({
        id,
        origin: base,
        kind: forced ? 'force' : 'advance',
        target: next,
        waypoints: [lead, BASES[next].clone()],
        startTime: start,
        arrival: start + lead.distanceTo(BASES[next]) / RUN.speed,
      });
    } else {
      plans.push({
        id,
        origin: base,
        kind: 'hold',
        target: base,
        waypoints: [lead, BASES[base].clone()],
        startTime: 0.4,
        arrival: 0.4 + RUN.leadOff / RUN.speed,
      });
    }
  }
  return plans;
}

const BASE_NUM: Record<BaseId, string> = { home: '홈', first: '1루', second: '2루', third: '3루' };

// 공을 잡는 순간 동료가 외쳐주는 콜. 안 밀리는 주자가 뛰는지 멈췄는지 알려준다.
export function runnerCalls(scn: ThrowScenario): string[] {
  const calls: string[] = [];
  if (scn.runnerJump) calls.push('주자 스타트 빨라요!');
  for (const r of planRunners(scn)) {
    if (r.id === 'batter' || r.kind === 'force' || r.kind === 'return') continue;
    if (r.kind === 'advance') calls.push(`${BASE_NUM[r.origin]} 주자 ${r.target === 'home' ? '홈으로' : `${BASE_NUM[r.target]}로`} 뛴다!`);
    else calls.push(`${BASE_NUM[r.origin]} 주자 멈춤`);
  }
  return calls;
}

export interface BallSegment {
  from: THREE.Vector3;
  to: THREE.Vector3;
  t0: number;
  t1: number;
  arc: number;
  thrower?: FielderId;
  carry?: boolean; // 공을 들고 직접 밟으러 감
  waited?: number; // 커버가 들어올 때까지 기다렸다 던진 시간
}

export interface PlayEvent {
  base: BaseId;
  runner: RunnerId;
  ballTime: number;
  runnerTime: number;
  out: boolean;
  tag: boolean;
  kind: 'force' | 'tag' | 'return'; // 포스아웃 / 태그아웃 / 직선타 귀루 실패
  at?: THREE.Vector3; // 베이스가 아닌 곳에서 태그했을 때의 위치
}

export interface Outcome {
  choice: Choice;
  decisionDelay: number;
  timedOut: boolean;
  events: PlayEvent[];
  autoOuts: number; // 직선타처럼 잡는 순간 생긴 아웃
  outsMade: number; // 송구로 잡은 아웃
  runs: number;
  value: number;
  segments: BallSegment[];
  resultState: string;
  headline: string;
  noCover: boolean;
}

const GLOVE = 1.2;
const at = (b: BaseId) => BASES[b].clone().setY(GLOVE);

function flight(from: THREE.Vector3, to: THREE.Vector3) {
  const d = from.distanceTo(to);
  const toss = d <= THROW.tossMaxDistance;
  return { dist: d, time: d / (toss ? THROW.tossSpeed : THROW.speed), arc: toss ? 0.6 : Math.min(2.2, d * 0.03) };
}

export function isCarry(scn: ThrowScenario, base: BaseId) {
  return scn.selfBases?.includes(base) ?? false;
}

// 커버 들어가는 수비수의 경로. 판정과 화면이 같은 경로를 쓴다.
// 플레이 시작 때 따로 움직이는 곳(fielderMoves)이 있으면 거기를 거쳐 베이스로 간다.
export function coverPath(scn: ThrowScenario, base: BaseId): { id: FielderId; waypoints: THREE.Vector3[]; startTime: number } | null {
  const id = scn.covers[base];
  if (!id || id === scn.position) return null;
  const bag = bagSpot(base);
  const waypoints = [fieldersOf(scn)[id].clone()];
  const via = scn.fielderMoves?.[id];
  if (via && via.distanceTo(bag) > 0.5) waypoints.push(via.clone());
  waypoints.push(bag);
  return { id, waypoints, startTime: scn.batted.type === 'bunt' ? RUN.buntCoverStart : RUN.coverStart };
}

// 커버가 베이스에 도착하는 시간. 받을 사람이 없거나 내가 받는 곳이면 -Infinity.
export function coverArrival(scn: ThrowScenario, base: BaseId): number {
  const path = coverPath(scn, base);
  if (!path) return -Infinity;
  let dist = 0;
  for (let i = 1; i < path.waypoints.length; i++) dist += path.waypoints[i - 1].distanceTo(path.waypoints[i]);
  return path.startTime + dist / RUN.fielderSpeed;
}

// 결정까지 걸린 시간(게임 시간)이 d일 때 선택지별 결과를 계산한다.
// 액션 모드에서 플레이어가 실제로 한 동작. 없으면 상황에 정해진 위치·시간에 잡고 d초 뒤에 던진 것으로 본다.
export interface ThrowExec {
  catchPos: THREE.Vector3; // 실제로 잡은 위치
  catchT: number;
  releasePos?: THREE.Vector3; // 던진 위치
  releaseT?: number; // 공이 손을 떠난 시간 (송구 준비 시간 포함)
  stepT?: number; // 공을 든 채 베이스를 밟은 시간 (포스 상황에서만 아웃)
  tagT?: number; // 공을 든 채 뛰는 주자를 직접 태그한 시간
  tagRunner?: RunnerId; // 태그한 주자
}

export function evaluate(scn: ThrowScenario, choice: Choice, d: number, timedOut = false, exec?: ThrowExec): Outcome {
  const runners = planRunners(scn);
  const catchT = exec?.catchT ?? scn.batted.travelTime;
  const catchPos = (exec?.catchPos ?? scn.batted.catchPoint).clone().setY(GLOVE);
  const autoOuts = scn.batted.type === 'liner' ? 1 : 0;
  const events: PlayEvent[] = [];
  const segments: BallSegment[] = [];
  const outRunners = new Set<RunnerId>();
  let tagOuts = 0;
  let thrown = 0;
  let noCover = false;

  const playAt = (base: BaseId, arrive: number) => {
    const r = runners.find(
      (x) =>
        !outRunners.has(x.id) &&
        (((x.kind === 'force' || x.kind === 'advance') && x.target === base) || (x.kind === 'return' && x.origin === base)),
    );
    if (!r) return null;
    const tag = r.kind === 'advance';
    const out = arrive + (tag ? THROW.tagTime : 0) < r.arrival;
    events.push({ base, runner: r.id, ballTime: arrive, runnerTime: r.arrival, out, tag, kind: tag ? 'tag' : r.kind === 'return' ? 'return' : 'force' });
    if (out) {
      outRunners.add(r.id);
      if (tag) tagOuts++;
    }
    return out;
  };

  if (choice !== 'hold' && exec?.tagT !== undefined) {
    // 액션 모드: 플레이어가 주자를 직접 태그했다
    const r = runners.find((x) => x.id === exec.tagRunner);
    if (r) {
      const out = exec.tagT < r.arrival;
      events.push({ base: choice, runner: r.id, ballTime: exec.tagT, runnerTime: r.arrival, out, tag: true, kind: 'tag', at: exec.releasePos?.clone().setY(0) });
      if (out) {
        outRunners.add(r.id);
        tagOuts++;
      }
    }
  } else if (choice !== 'hold') {
    // 액션 모드에서는 실제로 밟았을 때만 '직접 밟기'다
    const carry = exec ? exec.stepT !== undefined : isCarry(scn, choice);
    const cover = scn.covers[choice];
    if (!carry && !cover) {
      noCover = true;
    } else {
      let arrive: number;
      if (carry && exec?.stepT !== undefined) {
        arrive = exec.stepT;
        segments.push({ from: at(choice), to: at(choice), t0: arrive, t1: arrive, arc: 0, carry: true });
      } else if (carry) {
        const dist = catchPos.distanceTo(at(choice));
        const t0 = catchT + d;
        arrive = t0 + dist / RUN.carrySpeed;
        segments.push({ from: catchPos, to: at(choice), t0, t1: arrive, arc: 0, carry: true });
      } else {
        const from = exec?.releasePos ? exec.releasePos.clone().setY(GLOVE) : catchPos;
        const f = flight(from, at(choice));
        const ready = exec?.releaseT ?? catchT + d + THROW.transferTime;
        // 커버가 아직 안 들어왔으면 들어올 때까지 기다렸다 던진다
        const t0 = Math.max(ready, coverArrival(scn, choice) - f.time);
        arrive = t0 + f.time;
        thrown += f.dist;
        segments.push({ from, to: at(choice), t0, t1: arrive, arc: f.arc, thrower: scn.position, waited: t0 > ready + 0.01 ? t0 - ready : undefined });
      }
      const out = playAt(choice, arrive);

      // 1루가 아닌 곳에서 포스아웃을 잡으면 1루로 이어 던진다 (병살). 태그 플레이 뒤에는 이어 던지지 않는다.
      const batter = runners.find((r) => r.id === 'batter');
      const outsNow = scn.situation.outs + autoOuts + outRunners.size;
      const relayer = carry ? scn.position : cover;
      const forceOut = out && !events[events.length - 1].tag;
      if (forceOut && choice !== 'first' && batter && outsNow < 3 && scn.covers.first && relayer) {
        const f = flight(at(choice), at('first'));
        const ready = arrive + THROW.pivotTime;
        const t0 = Math.max(ready, coverArrival(scn, 'first') - f.time);
        thrown += f.dist;
        segments.push({ from: at(choice), to: at('first'), t0, t1: t0 + f.time, arc: f.arc, thrower: relayer, waited: t0 > ready + 0.01 ? t0 - ready : undefined });
        playAt('first', t0 + f.time);
      }
    }
  }

  const outs = scn.situation.outs + autoOuts + outRunners.size;
  const occupied = new Set<BaseId>();
  let runs = 0;
  for (const r of runners) {
    if (outRunners.has(r.id)) continue;
    if (r.target === 'home' && (r.kind === 'force' || r.kind === 'advance')) runs++;
    else occupied.add(r.target);
  }
  if (outs >= 3) runs = 0;

  let value = (outRunners.size + autoOuts) * VALUE.out - tagOuts * VALUE.tagPlay - thrown * VALUE.perMeterThrown;
  if (outs < 3) {
    value -= runs * VALUE.run;
    for (const b of occupied) value -= BASE_ORDER.indexOf(b);
  }

  let resultState: string;
  if (outs >= 3) resultState = '3아웃, 이닝 종료';
  else {
    const bases = (['first', 'second', 'third'] as const).filter((b) => occupied.has(b)).map((b) => BASE_LABEL[b]);
    resultState = `${outs}아웃 ${bases.length ? bases.join(', ') : '주자 없음'}${runs ? ` (${runs}점 실점)` : ''}`;
  }

  const totalOuts = outRunners.size + autoOuts;
  let headline: string;
  if (timedOut) headline = '판단이 늦었어요';
  else if (totalOuts >= 2) headline = '병살 성공!';
  else if (outRunners.size === 1) {
    const e = events.find((x) => x.out)!;
    headline = `${BASE_LABEL[e.base]} ${e.kind === 'tag' ? '태그아웃' : e.kind === 'return' ? '아웃 (귀루 실패)' : '포스아웃'}`;
  }
  else if (choice === 'hold') headline = '공을 들고 있었어요';
  else if (noCover) headline = `${BASE_LABEL[choice]}에 받을 사람이 없어요`;
  else if (events.length === 0) headline = `${BASE_LABEL[choice]}엔 승부할 주자가 없어요`;
  else headline = '세이프';

  return {
    choice,
    decisionDelay: d,
    timedOut,
    events,
    autoOuts,
    outsMade: outRunners.size,
    runs,
    value,
    segments,
    resultState,
    headline,
    noCover,
  };
}

// 액션 모드에서 공을 못 잡았을 때: 공이 외야로 빠져 타자는 1루, 주자는 한 베이스씩 간다
export function missOutcome(scn: ThrowScenario): Outcome {
  const s = scn.situation;
  const occupied = new Set<BaseId>(['first']);
  let runs = 0;
  let forced = true;
  for (const base of ['first', 'second', 'third'] as const) {
    if (!s.runners[base]) {
      forced = false;
      continue;
    }
    const act = scn.runnerActs?.[base];
    const moves = forced || scn.batted.type === 'liner' || act === 'advance' || (act === undefined && s.outs === 2);
    const to = moves ? nextBase(base) : base;
    if (to === 'home') runs++;
    else occupied.add(to);
  }
  const bases = (['first', 'second', 'third'] as const).filter((b) => occupied.has(b)).map((b) => BASE_LABEL[b]);
  return {
    choice: 'hold',
    decisionDelay: 0,
    timedOut: false,
    events: [],
    autoOuts: 0,
    outsMade: 0,
    runs,
    value: -10 - runs * VALUE.run,
    segments: [],
    resultState: `${s.outs}아웃 ${bases.join(', ')}${runs ? ` (${runs}점 실점)` : ''}`,
    headline: '포구 실패, 공이 빠졌어요',
    noCover: false,
  };
}

// 모든 주자가 베이스에 도착해서 더 이상 아웃을 잡을 수 없게 되는 결정 시간
export function decisionDeadline(scn: ThrowScenario): number {
  const moving = planRunners(scn).filter((r) => r.kind !== 'hold');
  const last = Math.max(0, ...moving.map((r) => r.arrival));
  return Math.max(1, last - scn.batted.travelTime - THROW.transferTime);
}

// 이 선택으로 아웃을 minOuts개 이상 잡으려면 늦어도 몇 초 안에 결정해야 하는지 (없으면 null)
export function latestDecision(scn: ThrowScenario, choice: Choice, minOuts: number): number | null {
  const ok = (d: number) => evaluate(scn, choice, d).outsMade >= minOuts;
  if (!ok(0)) return null;
  let lo = 0;
  let hi = decisionDeadline(scn);
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// 다른 선택지를 비교할 때 쓰는 실행 정보: 밟거나 태그한 경우도 그 시점에 던진 것으로 바꾼다
export function altExec(exec?: ThrowExec): ThrowExec | undefined {
  if (!exec) return undefined;
  const releaseT = exec.releaseT ?? ((exec.stepT ?? exec.tagT) !== undefined ? (exec.stepT ?? exec.tagT)! + THROW.transferTime : undefined);
  return { catchPos: exec.catchPos, catchT: exec.catchT, releasePos: exec.releasePos ?? exec.catchPos, releaseT };
}

// 상황의 정답: 공을 잡자마자 결정했을 때의 최선. 판단 속도와 상관없이 상황마다 고정이다.
// 공이 주자보다 몇 초 먼저 도착하는지 (음수면 늦음). 고른 베이스의 첫 플레이 기준.
export function playMargin(o: Outcome): number | null {
  const e = o.events[0];
  if (!e) return null;
  return e.runnerTime - e.ballTime - (e.tag ? THROW.tagTime : 0);
}

export interface CloseCall {
  lead: Outcome; // 점수로는 최선이지만 아슬아슬한 플레이
  safe: Outcome; // 여유 있게 잡는 쪽
  margin: number; // lead의 여유 (초)
}

export interface ThrowAnswers {
  answers: Choice[];
  ideal: Outcome;
  immediate: Outcome[]; // 잡자마자 결정했을 때 선택지별 결과
  close?: CloseCall;
}

export function throwAnswers(scn: ThrowScenario): ThrowAnswers {
  const immediate = THROW_CHOICES.map((c) => evaluate(scn, c, 0));
  const best = (xs: Outcome[]) => xs.reduce((a, b) => (b.value > a.value ? b : a));
  const ideal = best(immediate);
  const answers = immediate.filter((o) => o.outsMade > 0 && o.value >= ideal.value - VALUE.bestTolerance).map((o) => o.choice);
  // 최선이 잡자마자 던져도 아슬아슬하면, 여유 있게 아웃을 잡는 쪽도 정답으로 인정한다
  let close: CloseCall | undefined;
  const margin = playMargin(ideal);
  if (ideal.outsMade > 0 && margin !== null && margin < VALUE.closeMargin) {
    const safeOnes = immediate.filter((o) => o.outsMade > 0 && (playMargin(o) ?? -1) >= VALUE.closeMargin);
    if (safeOnes.length) {
      const safe = best(safeOnes);
      for (const o of safeOnes) if (o.value >= safe.value - VALUE.bestTolerance && !answers.includes(o.choice)) answers.push(o.choice);
      close = { lead: ideal, safe, margin };
    }
  }
  return { answers, ideal, immediate, close };
}

// ideal: 정답을 제때 고름 / late: 정답이지만 늦어서 아웃이 줄었음
// fallback: 정답은 아니지만 늦은 시점에선 가장 나은 선택 / other: 그 밖 / timeout: 시간 초과
export type ThrowVerdict = 'ideal' | 'late' | 'fallback' | 'other' | 'timeout' | 'miss';

export interface ThrowGrade {
  grade: Grade;
  verdict: ThrowVerdict;
  answers: Choice[];
  ideal: Outcome; // 정답을 바로 골랐을 때의 결과
  bestNow: Outcome; // 내 판단 시간 기준으로 가장 나은 결과
  immediate: Outcome[];
  close?: CloseCall;
}

export function gradeThrow(scn: ThrowScenario, outcome: Outcome, exec?: ThrowExec, missed = false): ThrowGrade {
  const { answers, ideal, immediate, close } = throwAnswers(scn);
  if (missed) return { grade: 'bad', verdict: 'miss', answers, ideal, bestNow: ideal, immediate, close };
  // 내 판단 시간 기준 최선: 액션 모드면 실제로 잡은 위치와 던진 시점에서 다른 곳으로 던졌다고 친다
  const alt = altExec(exec);
  const bestNow = THROW_CHOICES.map((c) => evaluate(scn, c, outcome.decisionDelay, false, alt)).reduce((a, b) => (b.value > a.value ? b : a));
  const gotOut = outcome.outsMade > 0;
  const base = { answers, ideal, bestNow, immediate, close };
  if (outcome.timedOut) return { ...base, grade: 'bad', verdict: 'timeout' };
  if (answers.includes(outcome.choice)) {
    const planned = evaluate(scn, outcome.choice, 0).outsMade;
    if (outcome.outsMade >= planned) return { ...base, grade: 'best', verdict: 'ideal' };
    return { ...base, grade: gotOut ? 'ok' : 'bad', verdict: 'late' };
  }
  if (gotOut && outcome.value >= bestNow.value - VALUE.bestTolerance) return { ...base, grade: 'ok', verdict: 'fallback' };
  return { ...base, grade: gotOut ? 'ok' : 'bad', verdict: 'other' };
}
