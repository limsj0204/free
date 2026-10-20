import { RUN, RUNNER } from './config';
import { BASES, P, bagSpot, type BaseId } from './coords';
import {
  BASE_PATH,
  PITCH_SEG,
  R,
  TAG_REACH,
  along,
  batterBoxOf,
  batterRun,
  evText,
  expectancy,
  leadSpot,
  outfieldThrow,
  pitchTimes,
  throwArc,
  trackAt,
  walkKeys,
  type BaseState,
  type Key,
  type OptionValue,
  type RunScenario,
  type RunTimeline,
  type Step,
} from './runner';
import { DEFAULT_FIELDERS } from './scenarios';
import { CONTACT_POINT } from './timeline';

// 규칙을 알면 답이 정해지는 상황 (드문 상황 탭). 결과는 시간 계산 대신 정해진 장면으로 보여준다.
// - fullcount: 2사 풀카운트, 1루 주자는 투구와 동시에 스타트
// - dropped3: 낫아웃 (1루가 비어 있으면 타자는 1루로 뛴다)
// - dropped3out: 1루에 주자가 있고 2아웃 전이면 낫아웃이 아니다 (공이 빠져도 타자는 이미 아웃)
// - iff: 인필드 플라이 (타자는 아웃, 주자는 포스가 아니라 공이 떨어져도 뛸 필요가 없다)

export type RuleType = 'fullcount' | 'dropped3' | 'dropped3out' | 'iff';

const REACT = 0.1;
const LEAD0 = RUN.leadOff + RUNNER.secondaryLead;

interface RuleDef {
  prompt: string;
  showAt: number;
  decisionAt: number;
  window: number;
  correct: 'go' | 'stop';
  labels: { stop: string; go: string };
  short: { stop: string; go: string };
  pos: { stop: BaseId | null; go: BaseId | null };
  outcome: (scn: RunScenario) => Record<'go' | 'stop', { headline: string; state: BaseState; line: string }>;
  wrong: string; // 틀린 선택에 붙이는 이유
}

const IFF_T = 3.6; // 인필드 플라이가 떨어지는 시각

const DEFS: Record<RuleType, RuleDef> = {
  fullcount: {
    prompt: '2사 풀카운트! 언제 출발할까?',
    showAt: -2.2,
    decisionAt: -0.55,
    window: 0.7,
    correct: 'go',
    labels: { stop: '공이 맞는 걸 보고 출발', go: '투구와 동시에 스타트' },
    short: { stop: '보고 출발', go: '스타트' },
    pos: { stop: null, go: 'second' },
    outcome: () => ({
      go: { headline: '우전 안타! 3루까지', state: { runs: 0, outs: 2, runners: R(true, false, true) }, line: '투구와 동시에 뛰어서, 우전 안타에 3루까지 갔어요.' },
      stop: { headline: '우전 안타, 2루에서 멈춤', state: { runs: 0, outs: 2, runners: R(true, true, false) }, line: '공이 맞는 걸 보고 출발해서, 우전 안타에 2루까지밖에 못 갔어요.' },
    }),
    wrong: '2아웃 풀카운트에서 포스인 주자는 잃을 게 없어요. 볼이면 볼넷, 스트라이크면 이닝 종료, 파울이면 돌아오면 되니 투구와 동시에 뛰어요.',
  },
  dropped3: {
    prompt: '헛스윙! 공이 빠졌다! 어떻게 할까?',
    showAt: 0,
    decisionAt: 0.3,
    window: 1.0,
    correct: 'go',
    labels: { stop: '타석에서 물러난다', go: '1루로 뛴다' },
    short: { stop: '물러난다', go: '1루로' },
    pos: { stop: null, go: 'first' },
    outcome: (scn) => {
      const o = scn.situation.outs;
      return {
        go: { headline: '낫아웃! 1루 세이프', state: { runs: 0, outs: o, runners: R(true, false, false) }, line: '포수가 공을 쫓는 사이 1루에 먼저 닿았어요.' },
        stop: { headline: '삼진 아웃', state: { runs: 0, outs: o + 1, runners: R(false, false, false) }, line: '그 자리에 서 있어서 그대로 삼진 아웃이에요.' },
      };
    },
    wrong: '1루가 비어 있으면(또는 2아웃이면) 포수가 놓친 세 번째 스트라이크에 타자는 1루로 뛸 수 있어요. 서 있으면 그대로 아웃이에요.',
  },
  dropped3out: {
    prompt: '헛스윙! 공이 빠졌다! 어떻게 할까?',
    showAt: 0,
    decisionAt: 0.3,
    window: 1.0,
    correct: 'stop',
    labels: { stop: '타석에서 물러난다', go: '1루로 뛴다' },
    short: { stop: '물러난다', go: '1루로' },
    pos: { stop: null, go: 'first' },
    outcome: (scn) => {
      const st = { runs: 0, outs: scn.situation.outs + 1, runners: R(true, false, false) };
      return {
        stop: { headline: '삼진 아웃', state: st, line: '1루에 주자가 있어서 낫아웃이 아니에요. 그대로 삼진 아웃이에요.' },
        go: { headline: '이미 삼진 아웃', state: st, line: '1루까지 뛰었지만 이미 아웃이라 소용없어요. 괜히 뛰면 1루 주자가 헷갈려 2루로 뛰다 잡힐 수도 있어요.' },
      };
    },
    wrong: '1루에 주자가 있고 2아웃이 아니면 낫아웃이 아니에요. 포수가 공을 놓쳐도 타자는 그대로 삼진 아웃이라 뛸 수 없어요.',
  },
  iff: {
    prompt: '인필드 플라이! 공이 떨어지면?',
    showAt: 0,
    decisionAt: IFF_T,
    window: 1.2,
    correct: 'stop',
    labels: { stop: '1루에 붙어 있기', go: '2루로 뛴다' },
    short: { stop: '1루에', go: '2루로' },
    pos: { stop: 'first', go: 'second' },
    outcome: (scn) => {
      const o = scn.situation.outs + 1; // 인필드 플라이로 타자는 아웃
      return {
        stop: { headline: '1루에 그대로', state: { runs: 0, outs: o, runners: R(true, true, false) }, line: '인필드 플라이라 타자만 아웃이고, 주자는 그대로예요.' },
        go: { headline: '2루에서 태그아웃', state: { runs: 0, outs: 3, runners: R(false, false, false) }, line: '포스가 아니라서 2루에서 태그로 잡혔어요. 뛸 필요가 없었어요.' },
      };
    },
    wrong: '인필드 플라이가 선언되면 타자는 이미 아웃이라 주자는 밀리지 않아요(포스가 없어져요). 공이 떨어져도 뛸 필요가 없어요.',
  },
};

export function ruleLabel(scn: RunScenario, id: string) {
  return DEFS[scn.rule!].labels[id as 'go' | 'stop'];
}

export function ruleStep(scn: RunScenario): Step {
  const d = DEFS[scn.rule!];
  const out = d.outcome(scn);
  return {
    key: 'rule',
    name: '판단',
    prompt: d.prompt,
    urgent: `지금 정하세요! ${d.prompt}`,
    options: [
      { id: 'stop', key: 'A', label: d.labels.stop, short: d.short.stop, pos: d.pos.stop ? BASES[d.pos.stop] : null },
      { id: 'go', key: 'D', label: d.labels.go, short: d.short.go, pos: d.pos.go ? BASES[d.pos.go] : null },
    ],
    decisionAt: d.decisionAt,
    deadline: d.decisionAt + d.window,
    showAt: d.showAt,
    timeout: 'stop',
    value: () => {
      const ev = (id: 'go' | 'stop') => expectancy(out[id].state);
      const best = Math.max(ev('go'), ev('stop'));
      const options: OptionValue[] = (['go', 'stop'] as const).map((id) => {
        const right = id === d.correct;
        return {
          id,
          // 규칙으로 답이 정해진 상황이라 맞는 선택이 항상 최선이 되게 한다
          ev: right ? best : Math.min(ev(id), best - 0.3),
          lines: [`${out[id].line} → ${evText(out[id].state)}`, ...(right ? [] : [d.wrong])],
          invalid: !right,
        };
      });
      return { options, note: d.wrong.replace(/^([^.]*\.)/, '<b>$1</b>') };
    },
  };
}

export function ruleResult(scn: RunScenario, choice: { id: string; td: number }) {
  const o = DEFS[scn.rule!].outcome(scn)[choice.id as 'go' | 'stop'];
  return { state: o.state, headline: o.headline, lines: [o.line] };
}

// ---------- 장면 ----------

export function ruleTimeline(scn: RunScenario, pitchFlight: number, choice: { id: string; td: number } | null): RunTimeline {
  const { tRelease, tWindup, start } = pitchTimes(pitchFlight);
  const tl: RunTimeline = {
    start,
    tWindup,
    tRelease,
    ball: [PITCH_SEG(tRelease)],
    fielders: {},
    me: [],
    meBatter: scn.me === 'batter',
    meStart: 0,
    others: [],
    calls: [],
    plays: [],
    slides: [],
    end: Infinity,
  };
  if (scn.rule === 'fullcount') fullcount(scn, tl, choice);
  else if (scn.rule === 'dropped3' || scn.rule === 'dropped3out') dropped3(scn, tl, choice);
  else iff(scn, tl, choice);
  return tl;
}

function fullcount(scn: RunScenario, tl: RunTimeline, choice: { id: string; td: number } | null) {
  const v = RUNNER.speed;
  tl.me.push({ t: tl.tWindup, pos: leadSpot('first', RUN.leadOff) });
  // 우전 안타 (땅볼로 빠진다)
  const field = P(23, 56);
  tl.ball.push({ from: CONTACT_POINT, to: field.clone().setY(0.2), t0: 0, t1: 3.0, arc: 0.6, bounces: 3 });
  tl.fielders.RF = [
    { t: 0.15, pos: DEFAULT_FIELDERS.RF.clone() },
    { t: 3.0, pos: field.clone() },
  ];
  tl.others.push(batterRun(scn));
  if (!choice) return;
  const go = choice.id === 'go';
  const leave = go ? Math.max(tl.tRelease, choice.td + REACT) : 0.35;
  const at2 = leave + (BASE_PATH - RUN.leadOff) / v;
  tl.me.push({ t: leave, pos: leadSpot('first', RUN.leadOff) }, { t: at2, pos: BASES.second.clone() });
  let end = at2;
  if (go) {
    end = at2 + RUNNER.roundTime + BASE_PATH / v;
    tl.me.push({ t: end, pos: BASES.third.clone() });
    tl.slides.push({ runner: 'me', base: 'third', t: end });
  }
  // 우익수는 리드 주자 앞 베이스로 던진다
  const target: BaseId = go ? 'third' : 'second';
  const thr = outfieldThrow(field, target, 3.8, 0);
  tl.ball.push({ from: thr.from, to: thr.to, t0: thr.t0, t1: Math.max(thr.t1, end + 0.4), arc: throwArc(thr.from, thr.to), thrower: 'RF' });
  tl.calls.push({ t: end, pos: BASES[target], text: go ? '3루 세이프' : '2루에서 멈춤', good: false });
  tl.end = Math.max(end, thr.t1) + 1.6;
}

function dropped3(scn: RunScenario, tl: RunTimeline, choice: { id: string; td: number } | null) {
  const box = batterBoxOf(scn);
  const out = scn.rule === 'dropped3out';
  tl.me.push({ t: tl.start, pos: box.clone() });
  tl.meStart = Infinity;
  // 낫아웃이면 공이 포수 뒤로 멀리 빠지고, 1루에 주자가 있으면 포수 옆으로 조금 튄다 (1루 주자는 리드 자리에서 돌아간다)
  const spot = out ? P(1.5, -4) : P(-5, -17);
  const tBall = out ? 0.8 : 1.6;
  tl.ball.push({ from: CONTACT_POINT, to: spot.clone().setY(0.1), t0: 0, t1: tBall, arc: 0.6, bounces: 2 });
  const c0 = DEFAULT_FIELDERS.C.clone();
  const reach = Math.max(tBall, RUNNER.catcherReact + c0.distanceTo(spot) / RUN.fielderSpeed);
  if (out) {
    tl.others.push({ keys: [{ t: tl.tWindup, pos: leadSpot('first', RUN.leadOff) }, { t: 0, pos: along('first', LEAD0) }, { t: 0.8, pos: along('first', LEAD0) }, { t: 0.8 + LEAD0 / RUNNER.speed, pos: BASES.first.clone() }], batter: false, start: 0 });
  }
  tl.fielders.C = [
    { t: RUNNER.catcherReact, pos: c0 },
    { t: reach, pos: spot.clone().setY(0) },
  ];
  if (!choice) return;
  if (choice.id !== 'go') {
    tl.calls.push({ t: 1.0, pos: BASES.home, text: '삼진 아웃', good: true });
    tl.end = reach + 1.5;
    return;
  }
  const leave = Math.max(choice.td, 0.3) + REACT;
  const arrive = leave + box.distanceTo(BASES.first) / RUN.speed;
  tl.meStart = leave;
  tl.me.push({ t: leave, pos: box.clone() }, { t: arrive, pos: BASES.first.clone() });
  if (out) {
    // 이미 아웃이라 포수는 공을 줍기만 하고 던지지 않는다
    tl.calls.push({ t: 1.0, pos: BASES.home, text: '삼진 아웃', good: true });
    tl.calls.push({ t: arrive, pos: BASES.first, text: '이미 아웃', good: true });
    tl.end = arrive + 1.4;
    return;
  }
  tl.fielders['1B'] = walkKeys(DEFAULT_FIELDERS['1B'], bagSpot('first'), 0.4);
  const thr = outfieldThrow(spot, 'first', reach + RUNNER.catcherPickup, 0);
  // 송구는 내가 1루에 닿은 뒤에 도착한다 (낫아웃은 공이 멀리 빠진 장면으로 보여준다)
  const t1 = Math.max(thr.t1, arrive + 0.3);
  tl.ball.push({ from: thr.from, to: thr.to, t0: thr.t0, t1, arc: throwArc(thr.from, thr.to), thrower: 'C' });
  tl.calls.push({ t: arrive, pos: BASES.first, text: '1루 세이프!', good: false });
  tl.end = Math.max(arrive, t1) + 1.4;
}

function iff(scn: RunScenario, tl: RunTimeline, choice: { id: string; td: number } | null) {
  const v = RUNNER.speed;
  const T = IFF_T;
  tl.me.push({ t: tl.tWindup, pos: leadSpot('first', RUN.leadOff) }, { t: 0, pos: along('first', LEAD0) });
  // 2루 주자는 리드 자리에서 공을 보다가 베이스로 돌아간다
  tl.others.push({ keys: [{ t: 0, pos: along('second', LEAD0) }, { t: 1.0, pos: along('second', LEAD0) }, { t: 1.0 + LEAD0 / v, pos: BASES.second.clone() }], batter: false, start: 0 });
  tl.others.push(batterRun(scn, 2.0));
  // 유격수 앞 높은 뜬공. 인필드 플라이가 선언되고, 공은 떨어진다
  const at = P(-8, 30);
  tl.ball.push({ from: CONTACT_POINT, to: at.clone().setY(0.1), t0: 0, t1: T, arc: (9.8 * T * T) / 8 });
  const rest = P(-7, 31.5);
  tl.ball.push({ from: at.clone().setY(0.1), to: rest.clone().setY(0.1), t0: T, t1: T + 0.5, arc: 0.4, bounces: 1 });
  tl.fielders.SS = [
    { t: 0.2, pos: DEFAULT_FIELDERS.SS.clone() },
    { t: T - 0.2, pos: at.clone() },
    { t: T + 0.8, pos: rest.clone() },
  ];
  tl.calls.push({ t: 1.6, pos: at, text: '인필드 플라이! 타자 아웃', good: true });
  tl.calls.push({ t: T + 0.05, pos: at, text: '공이 떨어졌다', good: false });
  if (!choice) return;
  if (choice.id !== 'go') {
    const back0 = Math.max(choice.td, T) + REACT;
    tl.me.push({ t: back0, pos: along('first', LEAD0) }, { t: back0 + LEAD0 / v, pos: BASES.first.clone() });
    tl.end = back0 + LEAD0 / v + 1.6;
    return;
  }
  // 2루로 뛰면 유격수가 공을 주워 2루에 던지고, 2루수가 태그한다 (포스가 아니라 태그해야 한다)
  const leave = Math.max(choice.td, T) + REACT;
  const arrive = leave + (BASE_PATH - LEAD0) / v;
  tl.fielders['2B'] = walkKeys(DEFAULT_FIELDERS['2B'], bagSpot('second'), 0.6);
  const thr = outfieldThrow(rest, 'second', T + 0.9, 0);
  tl.ball.push({ from: thr.from, to: thr.to, t0: thr.t0, t1: thr.t1, arc: throwArc(thr.from, thr.to), thrower: 'SS' });
  const outT = Math.max(thr.t1 + 0.2, arrive - TAG_REACH / v);
  const leg: Key[] = [
    { t: leave, pos: along('first', LEAD0) },
    { t: arrive, pos: BASES.second.clone() },
  ];
  tl.me.push({ t: leave, pos: along('first', LEAD0) }, { t: outT, pos: trackAt(leg, outT).pos.clone() });
  tl.calls.push({ t: outT, pos: BASES.second, text: '태그아웃!', good: true });
  tl.plays.push({ t: outT, base: 'second', out: true, receiver: '2B', runner: 'me' });
  tl.end = outT + 1.6;
}
