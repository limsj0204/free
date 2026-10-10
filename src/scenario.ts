import * as THREE from 'three';
import { GROUNDER, RUN, THROW } from './config';
import { BASES, BASE_LABEL, P, type BaseId } from './coords';

export type FielderId = 'P' | 'C' | '1B' | '2B' | 'SS' | '3B' | 'LF' | 'CF' | 'RF';
export type RunnerId = 'batter' | 'r1' | 'r2' | 'r3';
export type Choice = BaseId | 'hold';

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

export interface Scenario {
  id: string;
  title: string;
  player: FielderId; // 1인칭으로 플레이하는 포지션
  outs: number;
  runners: { first: boolean; second: boolean; third: boolean };
  brief: string; // 투구 전 상황 설명
  fielders: Record<FielderId, THREE.Vector3>; // 투구 전 수비 위치
  catchPoint: THREE.Vector3; // 타구를 잡는 위치
  covers: Partial<Record<BaseId, FielderId>>; // 각 베이스로 들어가는 수비수
  explanation: string; // 결과 화면의 해설
}

// 1사 1루, 유격수 정면 땅볼
export const SS_DOUBLE_PLAY: Scenario = {
  id: 'ss-dp-01',
  title: '1사 1루, 유격수 정면 땅볼',
  player: 'SS',
  outs: 1,
  runners: { first: true, second: false, third: false },
  brief: '1아웃, 주자 1루. 병살 대형으로 조금 앞당겨 서 있어요. 땅볼이 오면 어디로 던질지 미리 생각해 두세요.',
  fielders: {
    P: P(0, 18.44),
    C: P(0, -1.1),
    '1B': P(20.2, 18.4),
    '2B': P(9.5, 34),
    SS: P(-9, 34),
    '3B': P(-21, 23.5),
    LF: P(-30, 66),
    CF: P(0, 76),
    RF: P(30, 66),
  },
  catchPoint: P(-8.2, 31.2),
  covers: { first: '1B', second: '2B', third: '3B', home: 'C' },
  explanation:
    '1루 주자는 타자가 공을 치면 무조건 2루로 뛰어야 해요. 그래서 2루는 태그 없이 베이스만 밟아도 아웃(포스아웃)이에요. ' +
    '2루에서 아웃을 잡고 바로 1루로 이어 던지면 한 번에 아웃 2개, 병살로 이닝이 끝나요. ' +
    '판단이 늦어서 병살이 어려워도 2루에서 앞 주자를 잡는 게 1루보다 나아요. 주자를 득점권(2루)에 남기지 않으니까요. ' +
    '3루와 홈에는 뛰어오는 주자가 없어서 던져도 아웃을 잡을 수 없어요.',
};

const BASE_ORDER: BaseId[] = ['home', 'first', 'second', 'third'];

export interface RunnerPlan {
  id: RunnerId;
  from: THREE.Vector3;
  to: BaseId;
  startTime: number; // 타격 시점 기준
  arrival: number;
}

export interface BallSegment {
  from: THREE.Vector3;
  to: THREE.Vector3;
  t0: number;
  t1: number;
  arc: number; // 포물선 최고 높이 (기본 높이 위로)
  thrower?: FielderId;
}

export interface PlayEvent {
  base: BaseId;
  runner: RunnerId;
  ballTime: number;
  runnerTime: number;
  out: boolean;
}

export interface Outcome {
  choice: Choice;
  decisionDelay: number;
  timedOut: boolean;
  events: PlayEvent[];
  outsMade: number;
  value: number;
  segments: BallSegment[];
  resultState: string;
  headline: string;
}

export const RUNNER_NAME: Record<RunnerId, string> = {
  batter: '타자 주자',
  r1: '1루 주자',
  r2: '2루 주자',
  r3: '3루 주자',
};

function runnerFromBase(base: BaseId): RunnerId {
  return base === 'first' ? 'r1' : base === 'second' ? 'r2' : 'r3';
}

// 땅볼에서 포스 상황인 주자만 다음 베이스로 뛴다고 본다 (0단계 단순화).
export function planRunners(scn: Scenario): RunnerPlan[] {
  const plans: RunnerPlan[] = [];
  const batterFrom = P(-0.9, 0);
  plans.push({
    id: 'batter',
    from: batterFrom,
    to: 'first',
    startTime: RUN.batterStartDelay,
    arrival: RUN.batterStartDelay + batterFrom.distanceTo(BASES.first) / RUN.speed,
  });
  let forced = true;
  for (const base of ['first', 'second', 'third'] as const) {
    const occupied = scn.runners[base];
    forced = forced && occupied;
    if (!occupied || !forced) continue;
    const next = BASE_ORDER[(BASE_ORDER.indexOf(base) + 1) % 4];
    const dir = BASES[next].clone().sub(BASES[base]).normalize();
    const from = BASES[base].clone().addScaledVector(dir, RUN.leadOff);
    plans.push({
      id: runnerFromBase(base),
      from,
      to: next,
      startTime: RUN.runnerStartDelay,
      arrival: RUN.runnerStartDelay + from.distanceTo(BASES[next]) / RUN.speed,
    });
  }
  return plans;
}

function flight(from: THREE.Vector3, to: THREE.Vector3) {
  const d = from.distanceTo(to);
  const toss = d <= THROW.tossMaxDistance;
  const speed = toss ? THROW.tossSpeed : THROW.speed;
  return { time: d / speed, arc: toss ? 0.6 : Math.min(2.2, d * 0.03) };
}

const GLOVE_HEIGHT = 1.2;
const at = (base: BaseId) => BASES[base].clone().setY(GLOVE_HEIGHT);

// 결정까지 걸린 시간(게임 시간)이 d일 때 선택지별 결과를 계산한다.
export function evaluate(scn: Scenario, choice: Choice, d: number, timedOut = false): Outcome {
  const runners = planRunners(scn);
  const catchT = GROUNDER.travelTime;
  const release = catchT + d + THROW.transferTime;
  const catchPos = scn.catchPoint.clone().setY(GLOVE_HEIGHT);
  const events: PlayEvent[] = [];
  const segments: BallSegment[] = [];
  const outRunners = new Set<RunnerId>();

  if (choice !== 'hold') {
    const f = flight(catchPos, at(choice));
    const arrive = release + f.time;
    segments.push({ from: catchPos, to: at(choice), t0: release, t1: arrive, arc: f.arc, thrower: scn.player });
    const target = runners.find((r) => r.to === choice);
    if (target) {
      const out = arrive < target.arrival;
      events.push({ base: choice, runner: target.id, ballTime: arrive, runnerTime: target.arrival, out });
      if (out) outRunners.add(target.id);

      // 2루 포스아웃 후 1루로 이어 던지기 (6-4-3)
      const batter = runners.find((r) => r.id === 'batter')!;
      if (out && choice === 'second' && scn.outs + 1 < 3) {
        const relay = flight(at('second'), at('first'));
        const r0 = arrive + THROW.pivotTime;
        const r1 = r0 + relay.time;
        segments.push({ from: at('second'), to: at('first'), t0: r0, t1: r1, arc: relay.arc, thrower: scn.covers.second });
        const out2 = r1 < batter.arrival;
        events.push({ base: 'first', runner: 'batter', ballTime: r1, runnerTime: batter.arrival, out: out2 });
        if (out2) outRunners.add('batter');
      }
    }
  }

  // 결과 상태: 살아남은 주자가 도착한 베이스
  const occupied = new Set<BaseId>();
  for (const r of runners) if (!outRunners.has(r.id)) occupied.add(r.to);
  for (const base of ['first', 'second', 'third'] as const) {
    if (scn.runners[base] && !runners.some((r) => r.id === runnerFromBase(base))) occupied.add(base);
  }
  const outs = scn.outs + outRunners.size;
  const outsMade = outRunners.size;
  // 아웃이 최우선, 같으면 주자가 덜 나가 있을수록 좋다
  let value = outsMade * 10;
  if (outs < 3) for (const b of occupied) value -= BASE_ORDER.indexOf(b);

  let resultState: string;
  if (outs >= 3) resultState = '3아웃, 이닝 종료';
  else {
    const bases = (['first', 'second', 'third'] as const).filter((b) => occupied.has(b)).map((b) => BASE_LABEL[b]);
    resultState = `${outs}아웃 ${bases.length ? bases.join(', ') : '주자 없음'}`;
  }

  let headline: string;
  if (timedOut) headline = '판단이 늦었어요';
  else if (outsMade === 2) headline = '병살 성공!';
  else if (outsMade === 1) headline = `${BASE_LABEL[events.find((e) => e.out)!.base]} 아웃`;
  else if (choice === 'hold') headline = '공을 들고 있었어요';
  else if (events.length === 0) headline = `${BASE_LABEL[choice]}엔 뛰는 주자가 없어요`;
  else headline = '세이프';

  return { choice, decisionDelay: d, timedOut, events, outsMade, value, segments, resultState, headline };
}

// 모든 주자가 베이스에 도착해서 더 이상 아웃을 잡을 수 없게 되는 결정 시간
export function decisionDeadline(scn: Scenario): number {
  const last = Math.max(...planRunners(scn).map((r) => r.arrival));
  return last - GROUNDER.travelTime - THROW.transferTime;
}

// 이 선택으로 아웃을 minOuts개 이상 잡으려면 늦어도 몇 초 안에 결정해야 하는지 (없으면 null)
export function latestDecision(scn: Scenario, choice: Choice, minOuts: number): number | null {
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

export const CHOICES: Choice[] =['first', 'second', 'third', 'home', 'hold'];

export type Grade = 'best' | 'ok' | 'bad';

export function grade(scn: Scenario, outcome: Outcome): { grade: Grade; best: Outcome } {
  const all = CHOICES.map((c) => evaluate(scn, c, outcome.decisionDelay));
  const best = all.reduce((a, b) => (b.value > a.value ? b : a));
  if (outcome.timedOut) return { grade: 'bad', best };
  if (outcome.value >= best.value && outcome.outsMade > 0) return { grade: 'best', best };
  if (outcome.outsMade > 0) return { grade: 'ok', best };
  return { grade: 'bad', best };
}
