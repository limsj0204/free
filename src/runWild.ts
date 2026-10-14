import { RUN, RUNNER } from './config';
import { BASES, BASE_LABEL, MOUND, P, bagSpot, type BaseId } from './coords';
import { goStopValue } from './runExtra';
import {
  BASE_PATH,
  NEXT,
  ORIGIN,
  PITCH_SEG,
  R,
  TAG_REACH,
  TAG_TIME,
  along,
  baseLabelTo,
  batterBoxOf,
  leadSpot,
  outfieldThrow,
  pitchTimes,
  tagCall,
  throwArc,
  trackAt,
  walkKeys,
  type BaseState,
  type Key,
  type RunScenario,
  type RunTimeline,
  type Step,
} from './runner';
import type { FielderId } from './scenario';
import { DEFAULT_FIELDERS } from './scenarios';
import { CONTACT_POINT, type BallSeg } from './timeline';

// 폭투·패스트볼: 투구가 포수 뒤로 빠지면 다음 베이스로 갈지 정한다.
// 포수가 공을 쫓아가 주워서 던지는 시간과, 리드 자리에서 다음 베이스까지 뛰는 시간을 비교한다.
// 3루 주자가 홈으로 뛰면 투수가 홈 커버로 들어온다.

const REACT = 0.1;
const LEAD0 = RUN.leadOff + RUNNER.secondaryLead;

export function wildBases(scn: RunScenario) {
  const origin = ORIGIN[scn.me];
  return { origin, next: NEXT[origin] };
}

// 공을 받는 수비수와 그 수비수가 베이스에 들어오는 시간
function receiver(base: BaseId): { id: FielderId; keys: Key[]; ready: number } {
  const id: FielderId = base === 'second' ? 'SS' : base === 'third' ? '3B' : 'P';
  const from = id === 'P' ? MOUND.clone() : DEFAULT_FIELDERS[id].clone();
  const to = base === 'home' ? BASES.home.clone().add(P(0.6, 0.8)) : bagSpot(base);
  const keys = walkKeys(from, to, 0.4);
  return { id, keys, ready: keys[keys.length - 1].t };
}

// 포수가 공을 주워 던지는 시각과, 다음 베이스에서 태그할 수 있는 시각
export function wildTiming(scn: RunScenario) {
  const w = scn.wild!;
  const b = wildBases(scn);
  const c0 = DEFAULT_FIELDERS.C.clone();
  const reach = Math.max(w.t, RUNNER.catcherReact + c0.distanceTo(w.spot) / RUN.fielderSpeed);
  const release = reach + RUNNER.catcherPickup;
  const thr = outfieldThrow(w.spot, b.next, release, 0);
  const rec = receiver(b.next);
  return { reach, release, rec, tagAt: Math.max(thr.t1, rec.ready) + TAG_TIME };
}

export function wildArrival(td: number) {
  const leave = Math.max(td, RUNNER.wildRead) + REACT;
  return { leave, arrival: leave + (BASE_PATH - LEAD0) / RUNNER.speed };
}

function wildStates(scn: RunScenario): { safe: BaseState; out: BaseState; stay: BaseState } {
  const b = wildBases(scn);
  const o = scn.situation.outs;
  const one = (base: BaseId) => R(base === 'first', base === 'second', base === 'third');
  return {
    stay: { runs: 0, outs: o, runners: one(b.origin) },
    safe: b.next === 'home' ? { runs: 1, outs: o, runners: R(false, false, false) } : { runs: 0, outs: o, runners: one(b.next) },
    out: { runs: 0, outs: o + 1, runners: R(false, false, false) },
  };
}

export function wildLabel(scn: RunScenario, id: string) {
  const b = wildBases(scn);
  return id === 'go' ? `${baseLabelTo(b.next)} 진루` : `${BASE_LABEL[b.origin]}에 머묾`;
}

export function wildStep(scn: RunScenario): Step {
  const b = wildBases(scn);
  const tm = wildTiming(scn);
  const prompt = `${scn.wild!.label}! ${baseLabelTo(b.next)} 갈까?`;
  return {
    key: 'wild',
    name: '진루 판단',
    prompt,
    urgent: `지금 정하세요! ${prompt}`,
    options: [
      { id: 'stop', key: 'A', label: wildLabel(scn, 'stop'), short: '머문다', pos: BASES[b.origin] },
      { id: 'go', key: 'D', label: wildLabel(scn, 'go'), short: '간다', pos: BASES[b.next] },
    ],
    decisionAt: RUNNER.wildRead,
    deadline: RUNNER.wildRead + RUNNER.wildWindow,
    timeout: 'stop',
    value: (td) => goStopValue(tm.tagAt - wildArrival(td).arrival, wildStates(scn)),
  };
}

export interface WildResult {
  state: BaseState;
  headline: string;
  timing?: { base: BaseId; arrival: number; ball: number; safe: boolean; label: string };
}

export function wildResult(scn: RunScenario, choice: { id: string; td: number }, noise: number): WildResult {
  const b = wildBases(scn);
  const st = wildStates(scn);
  if (choice.id !== 'go') return { state: st.stay, headline: `${BASE_LABEL[b.origin]}에 머물렀어요` };
  const go = wildArrival(choice.td);
  const tagAt = wildTiming(scn).tagAt + noise;
  const safe = go.arrival < tagAt;
  return {
    state: safe ? st.safe : st.out,
    headline: safe ? (b.next === 'home' ? '홈인! 득점' : `${BASE_LABEL[b.next]} 세이프!`) : `${BASE_LABEL[b.next]}에서 태그아웃`,
    timing: { base: b.next, arrival: go.arrival, ball: tagAt, safe, label: '태그' },
  };
}

export function wildTimeline(scn: RunScenario, pitchFlight: number, choice: { id: string; td: number } | null, noise: number): RunTimeline {
  const { tRelease, tWindup, start } = pitchTimes(pitchFlight);
  const w = scn.wild!;
  const b = wildBases(scn);
  const tm = wildTiming(scn);
  const ball: BallSeg[] = [PITCH_SEG(tRelease), { from: CONTACT_POINT, to: w.spot.clone().setY(0.1), t0: 0, t1: w.t, arc: 0.7, bounces: 2 }];
  const c0 = DEFAULT_FIELDERS.C.clone();
  const fielders: RunTimeline['fielders'] = {
    C: [
      { t: RUNNER.catcherReact, pos: c0 },
      { t: tm.reach, pos: w.spot.clone().setY(0) },
    ],
  };
  const me: Key[] = [
    { t: tWindup, pos: leadSpot(b.origin, RUN.leadOff) },
    { t: 0, pos: along(b.origin, LEAD0) },
  ];
  const box = batterBoxOf(scn);
  const tl: RunTimeline = {
    start,
    tWindup,
    tRelease,
    ball,
    fielders,
    me,
    meBatter: false,
    meStart: 0,
    // 타자는 치지 않고 타석에 그대로 있다
    others: [{ keys: [{ t: start, pos: box }], batter: true, start: Infinity }],
    calls: [],
    plays: [],
    slides: [],
    end: Infinity,
    noSwing: true,
  };
  if (!choice) return tl;
  if (choice.id === 'go') {
    const go = wildArrival(choice.td);
    const thr = outfieldThrow(w.spot, b.next, tm.release, noise);
    ball.push({ from: thr.from, to: thr.to, t0: thr.t0, t1: thr.t1, arc: throwArc(thr.from, thr.to), thrower: 'C' });
    fielders[tm.rec.id] = tm.rec.keys;
    const tagAt = tm.tagAt + noise;
    const safe = go.arrival < tagAt;
    const tEnd = safe ? go.arrival : Math.max(tagAt, go.arrival - TAG_REACH / RUNNER.speed);
    const leg: Key[] = [
      { t: go.leave, pos: along(b.origin, LEAD0) },
      { t: go.arrival, pos: BASES[b.next].clone() },
    ];
    me.push({ t: go.leave, pos: along(b.origin, LEAD0) }, { t: tEnd, pos: trackAt(leg, tEnd).pos.clone() });
    tl.calls.push(tagCall(b.next, tEnd, safe));
    tl.plays.push({ t: tEnd, base: b.next, out: !safe, receiver: tm.rec.id, runner: 'me' });
    tl.slides.push({ runner: 'me', base: b.next, t: tEnd });
    tl.end = Math.max(tEnd, thr.t1) + 1.6;
  } else {
    // 머문다: 리드 자리에서 베이스로 돌아간다. 포수는 공을 줍고 끝난다.
    const back0 = Math.max(choice.td, RUNNER.wildRead) + REACT;
    me.push({ t: back0, pos: along(b.origin, LEAD0) }, { t: back0 + LEAD0 / RUNNER.speed, pos: BASES[b.origin].clone() });
    tl.end = Math.max(tm.release, back0 + LEAD0 / RUNNER.speed) + 1.2;
  }
  return tl;
}
