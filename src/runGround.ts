import { RUN, RUNNER } from './config';
import { BASES, BASE_LABEL, type BaseId } from './coords';
import { BALLS, coversFor, fieldersFor, type Ball } from './generated';
import {
  ORIGIN,
  R,
  bestOptions,
  evText,
  expectancy,
  pathKeys,
  type BaseState,
  type Key,
  type OptionValue,
  type Other,
  type RunMe,
  type RunPlay,
  type RunScenario,
  type RunTimeline,
  type Step,
} from './runner';
import { THROW_CHOICES, evaluate, planRunners, type Base3, type FielderId, type Outcome, type PositionId, type RunnerId, type ThrowScenario } from './scenario';
import { fieldersOf } from './scenarios';
import { buildThrowTimeline } from './timeline';

// 땅볼 진루: 타구 방향이 보이는 순간 진루할지 귀루할지 정한다.
// 포스(의무 진루)면 무조건 뛰어야 하고, 아니면 타구 방향과 아웃 카운트를 보고 정한다.
// 수비는 내야 수비 엔진(scenario.ts)으로 계산하고, 내 행동을 본 수비가 가장 좋은 곳으로 던진다고 본다.

const REACT = 0.1;
const FROZEN = 99; // 아직 안 정한 주자는 리드 자리에 서 있다

export function myBase(scn: RunScenario): Base3 {
  return ORIGIN[scn.me] as Base3;
}

// 뒤 베이스가 모두 차 있으면 포스 (타자부터 밀려 온다)
export function isForced(scn: RunScenario) {
  const s = scn.situation.runners;
  const b = myBase(scn);
  if (b === 'first') return true;
  if (b === 'second') return s.first;
  return s.first && s.second;
}

const NEXT3: Record<Base3, BaseId> = { first: 'second', second: 'third', third: 'home' };

export function groundLabel(scn: RunScenario, id: string) {
  const b = myBase(scn);
  return id === 'go' ? `${NEXT3[b] === 'home' ? '홈으로' : `${BASE_LABEL[NEXT3[b]]}로`} 진루` : `${BASE_LABEL[b]}로 귀루`;
}

const runnerIdOf = (b: Base3): RunnerId => (b === 'first' ? 'r1' : b === 'second' ? 'r2' : 'r3');

// 내 판단(go/back, 정한 시각)을 반영한 내야 수비 상황. choice가 null이면 아직 안 정해서 리드 자리에 서 있다.
export function withChoice(scn: RunScenario, choice: { id: string; td: number } | null): ThrowScenario {
  const base = scn.ground!;
  const b = myBase(scn);
  const forced = isForced(scn);
  const acts = { ...(base.runnerActs ?? {}) };
  const start = { ...(base.runnerStart ?? {}) };
  if (!choice) {
    if (!forced) acts[b] = 'hold';
    start[b] = FROZEN;
  } else {
    const d = Math.max(0, choice.td - RUNNER.groundRead);
    const after = (dflt: number) => (d < 0.01 ? dflt : Math.max(dflt, choice.td + REACT));
    if (forced) start[b] = choice.id === 'go' ? after(RUN.runnerStartDelay) : FROZEN;
    else if (choice.id === 'go') {
      acts[b] = 'advance';
      start[b] = after(scn.situation.outs === 2 ? RUN.runnerStartDelay : RUN.advanceStartDelay);
    } else {
      acts[b] = 'hold';
      start[b] = after(0.4);
    }
  }
  return { ...base, runnerActs: acts, runnerStart: start };
}

// 수비는 내 행동을 보고 가장 좋은 곳으로 던진다 (내야 수비 엔진의 점수 기준)
export function defensePlay(ts: ThrowScenario): Outcome {
  return THROW_CHOICES.map((c) => evaluate(ts, c, 0)).reduce((a, b) => (b.value > a.value ? b : a));
}

export function stateOf(ts: ThrowScenario, o: Outcome): BaseState {
  const out = new Set(o.events.filter((e) => e.out).map((e) => e.runner));
  const outs = ts.situation.outs + o.autoOuts + out.size;
  const occ = { first: false, second: false, third: false };
  let runs = 0;
  for (const r of planRunners(ts)) {
    if (out.has(r.id)) continue;
    if (r.target === 'home' && (r.kind === 'force' || r.kind === 'advance')) runs++;
    else if (r.target !== 'home') occ[r.target] = true;
  }
  if (outs >= 3) return { runs: 0, outs: 3, runners: R(false, false, false) };
  return { runs, outs, runners: occ };
}

function playText(o: Outcome) {
  if (o.choice === 'hold') return '수비가 공을 들고 있어요';
  return `수비는 ${BASE_LABEL[o.choice]} 송구 → ${o.headline}`;
}

export function groundStep(scn: RunScenario): Step {
  const b = myBase(scn);
  const forced = isForced(scn);
  const travel = scn.ground!.batted.travelTime;
  const value = (td: number) => {
    const options: OptionValue[] = (['go', 'back'] as const).map((id) => {
      const ts = withChoice(scn, { id, td });
      const o = defensePlay(ts);
      const st = stateOf(ts, o);
      return { id, ev: expectancy(st), lines: [`${playText(o)}`, evText(st)] };
    });
    if (forced) {
      // 포스면 베이스를 비워 줘야 한다. 병살이 나와 결과가 같아 보여도 귀루는 답이 될 수 없다.
      const go = options[0];
      const back = options[1];
      back.ev = Math.min(back.ev, go.ev - 0.3);
      back.invalid = true;
      back.lines.push('포스라서 돌아갈 곳이 없어요. 남아 있으면 수비는 서두를 필요 없이 다음 베이스만 밟으면 돼요.');
    }
    return {
      options,
      note: forced
        ? '포스(의무 진루) 상황이에요. 뒤에서 주자가 밀고 오니 베이스를 비워 줘야 해요.'
        : `포스가 아니에요. ${BASE_LABEL[b]}에 남아도 돼서, 진루할지 직접 정해요.`,
    };
  };
  return {
    key: 'ground',
    name: '땅볼 진루',
    prompt: '땅볼! 진루할까?',
    urgent: '지금 정하세요! 진루할까?',
    options: [
      { id: 'go', key: 'W', label: groundLabel(scn, 'go'), short: groundLabel(scn, 'go'), pos: BASES[NEXT3[b]] },
      { id: 'back', key: 'S', label: groundLabel(scn, 'back'), short: groundLabel(scn, 'back'), pos: BASES[b] },
    ],
    decisionAt: RUNNER.groundRead,
    deadline: Math.max(RUNNER.groundRead + 0.4, Math.min(RUNNER.groundRead + RUNNER.groundWindow, travel + 0.1)),
    timeout: 'back',
    value,
  };
}

export interface GroundResult {
  state: BaseState;
  headline: string;
  lines: string[];
  play: Outcome;
}

export function groundResult(scn: RunScenario, choice: { id: string; td: number }): GroundResult {
  const ts = withChoice(scn, choice);
  const o = defensePlay(ts);
  const st = stateOf(ts, o);
  const me = runnerIdOf(myBase(scn));
  const myEvent = o.events.find((e) => e.runner === me);
  const forced = isForced(scn);
  let headline: string;
  if (myEvent?.out) headline = `${BASE_LABEL[myEvent.base]}에서 ${myEvent.kind === 'tag' ? '태그아웃' : '포스아웃'}`;
  else if (choice.id === 'go') headline = NEXT3[myBase(scn)] === 'home' ? '홈인!' : `${BASE_LABEL[NEXT3[myBase(scn)]]} 진루 성공`;
  else headline = `${BASE_LABEL[myBase(scn)]}에 남았어요`;
  const lines = [playText(o)];
  if (forced && choice.id !== 'go') lines.push('포스 상황에서 베이스에 남으면, 수비는 다음 베이스를 밟기만 해도 나를 잡아요.');
  return { state: st, headline, lines, play: o };
}

// 내야 수비 타임라인을 주루 화면용으로 바꾼다 (카메라는 내 주자를 따라간다)
export function groundTimeline(scn: RunScenario, pitchFlight: number, choice: { id: string; td: number } | null): RunTimeline {
  const ts = withChoice(scn, choice);
  const outcome = choice ? defensePlay(ts) : undefined;
  const tl = buildThrowTimeline(ts, pitchFlight, outcome);
  const myId = runnerIdOf(myBase(scn));
  const fielders: Partial<Record<FielderId, Key[]>> = {};
  for (const [id, p] of Object.entries(tl.fielders) as [FielderId, NonNullable<(typeof tl.fielders)[FielderId]>][]) fielders[id] = pathKeys(p);
  // 공을 잡는 수비수: 내야 수비에서는 플레이어였던 움직임
  const pk: Key[] = [{ t: -10, pos: tl.playerStart.clone() }];
  for (const m of tl.player) pk.push({ t: m.t0, pos: m.from.clone() }, { t: m.t1, pos: m.to.clone() });
  fielders[ts.position] = pk;

  const ball = [...tl.ball];
  // 공을 들고 직접 베이스를 밟으러 가는 동안 공도 같이 움직인다
  for (const s of outcome?.segments ?? []) if (s.carry && s.t1 > s.t0) ball.push({ from: s.from.clone().setY(1.1), to: s.to.clone().setY(1.1), t0: s.t0, t1: s.t1, arc: 0 });

  let me: Key[] = [];
  const others: Other[] = [];
  const index = new Map<RunnerId, number>();
  for (const [id, p] of tl.runners) {
    const keys = pathKeys(p.startTime >= FROZEN ? { ...p, waypoints: [p.waypoints[0]] } : p);
    if (id === myId) me = keys;
    else {
      index.set(id, others.length);
      others.push({ keys, batter: id === 'batter', start: p.startTime });
    }
  }
  const who = (id: RunnerId): 'me' | number => (id === myId ? 'me' : index.get(id) ?? 0);
  const plays: RunPlay[] = tl.plays.map((p) => ({ t: p.t, base: p.base, out: p.out, receiver: p.receiver === 'player' ? ts.position : p.receiver, runner: who(p.runner) }));
  const slides = tl.plays.filter((p) => p.kind === 'tag').map((p) => ({ runner: who(p.runner), base: p.base, t: p.t }));
  return {
    start: tl.start,
    tWindup: tl.tWindup,
    tRelease: tl.tRelease,
    ball,
    fielders,
    fieldersHome: fieldersOf(ts),
    me,
    meBatter: false,
    meStart: tl.runners.get(myId)?.startTime ?? 0,
    others,
    calls: tl.calls,
    plays,
    slides,
    end: tl.end,
  };
}

// ---------- 상황 만들기 ----------

const RUNNER_SETS: { me: RunMe; set: Base3[] }[] = [
  { me: 'r1', set: ['first'] },
  { me: 'r2', set: ['second'] },
  { me: 'r2', set: ['first', 'second'] },
  { me: 'r3', set: ['third'] },
  { me: 'r3', set: ['first', 'third'] },
  { me: 'r3', set: ['first', 'second', 'third'] },
];

const POS_NAME: Record<PositionId, string> = { P: '투수', '1B': '1루수', '2B': '2루수', SS: '유격수', '3B': '3루수' };

function groundScenario(position: PositionId, ball: Ball, me: RunMe, set: Base3[], outs: number): RunScenario {
  const runners = { first: set.includes('first'), second: set.includes('second'), third: set.includes('third') };
  const situation = { outs, runners, batter: 'R' as const };
  const name = ball.name.startsWith('투수') || ball.name.startsWith('3루 쪽') ? ball.name : `${POS_NAME[position]} ${ball.name}`;
  const ts: ThrowScenario = {
    id: `run-ground-${position}-${ball.key}`,
    kind: 'throw',
    title: name,
    event: name,
    position,
    situation,
    brief: '',
    explanation: '',
    fielders: fieldersFor(position, set, outs),
    batted: { type: ball.type, catchPoint: ball.catchPoint, travelTime: ball.travelTime },
    covers: coversFor(position),
    selfBases: ball.selfBases,
    runnerActs: {},
    generated: true,
  };
  const short = set.length === 3 ? '만루' : `${set.map((b) => (b === 'first' ? '1' : b === 'second' ? '2' : '3')).join(', ')}루`;
  const outsText = outs === 0 ? '무사' : `${outs}사`;
  return {
    id: `run-ground-${me}-${set.map((b) => b[0]).join('')}-${position}-${ball.key}-${outs}`,
    kind: 'ground',
    title: `${outsText} ${short} / ${name}`,
    event: name,
    me,
    situation,
    ground: ts,
    brief: `${me === 'r1' ? '1루' : me === 'r2' ? '2루' : '3루'} 주자예요. 땅볼이 나오면 진루할지 귀루할지 정해요. 포스(의무 진루)인지 먼저 생각하세요.`,
    generated: true,
  };
}

let cache: RunScenario[] | null = null;
export function generatedGroundScenarios() {
  if (cache) return cache;
  cache = [];
  for (const position of Object.keys(BALLS) as PositionId[]) {
    for (const ball of BALLS[position])
      for (const rs of RUNNER_SETS)
        for (const outs of [0, 1, 2]) {
          const scn = groundScenario(position, ball, rs.me, rs.set, outs);
          // 진루하든 귀루하든 결과가 같은 상황(포스 아닌 주자)은 연습 가치가 없어서 뺀다
          const st = groundStep(scn);
          if (!isForced(scn) && bestOptions(st.value(st.decisionAt)).length > 1) continue;
          cache.push(scn);
        }
  }
  return cache;
}

export function groundBasic(id: string, position: PositionId, ballKey: string, me: RunMe, set: Base3[], outs: number, explanation: string): RunScenario {
  const ball = BALLS[position].find((b) => b.key === ballKey)!;
  return { ...groundScenario(position, ball, me, set, outs), id, generated: false, explanation };
}
