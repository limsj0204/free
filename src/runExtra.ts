import { RUN, RUNNER } from './config';
import { BASES, BASE_LABEL, type BaseId } from './coords';
import {
  BASE_PATH,
  NEXT,
  ORIGIN,
  PITCH_SEG,
  R,
  TAG_REACH,
  TAG_TIME,
  batterBoxOf,
  batterRun,
  evText,
  expectancy,
  hitSegments,
  isCoach,
  leadSpot,
  outfieldDefense,
  outfieldThrow,
  pct,
  pitchTimes,
  safeProb,
  tagCall,
  throwArc,
  trackAt,
  type BaseState,
  type Key,
  type RunScenario,
  type RunTimeline,
  type Step,
  type StepValue,
} from './runner';

// 한 베이스 더: 외야 안타 때 1루 주자는 3루, 2루 주자는 홈, 타자는 2루까지 갈지 정한다.
// 베이스를 돌기 전(RUNNER.commit초 전)까지 정해야 속도를 줄이지 않고 돈다.

export function extraRoute(scn: RunScenario) {
  const origin = ORIGIN[scn.me];
  const mid = NEXT[origin];
  return { origin, mid, target: NEXT[mid] };
}

export function extraLabel(scn: RunScenario, id: string) {
  const r = extraRoute(scn);
  return id === 'go' ? (r.target === 'home' ? '홈으로' : `${BASE_LABEL[r.target]}까지`) : `${BASE_LABEL[r.mid]}에서 멈춤`;
}

// 타격 순간 주자의 출발 위치와 출발 시간
function startOf(scn: RunScenario) {
  if (scn.me === 'batter') return { pos: batterBoxOf(scn), t: RUN.batterStartDelay };
  const pos = leadSpot(ORIGIN[scn.me], RUN.leadOff + RUNNER.secondaryLead);
  if (scn.me === 'r1' || scn.situation.outs === 2) return { pos, t: RUN.runnerStartDelay };
  // 2루 주자는 밀려서 뛰는 게 아니라서, 타구가 빠지는(잡히지 않는) 걸 보고 출발한다
  return { pos, t: scn.hit!.type === 'liner' ? RUNNER.liner2Delay : RUNNER.grounder2Delay };
}

export function extraTiming(scn: RunScenario) {
  const r = extraRoute(scn);
  const s = startOf(scn);
  const hit = scn.hit!;
  const release = hit.fieldT + RUNNER.release[hit.release];
  const thr = outfieldThrow(hit.field, r.target, release, 0);
  const tagAt = thr.t1 + TAG_TIME;
  const tBase = s.t + s.pos.distanceTo(BASES[r.mid]) / (scn.me === 'batter' ? RUN.speed : RUNNER.speed);
  return { decisionAt: Math.min(hit.fieldT, tBase - RUNNER.commit), deadline: tBase + RUNNER.window, tBase, release, tagAt, start: s };
}

// td에 간다고 정했을 때 노리는 베이스에 도착하는 시간. 늦게 정하면 늦은 만큼 베이스에서 머뭇거린다.
export function extraArrival(scn: RunScenario, td: number) {
  const tm = extraTiming(scn);
  const late = Math.max(0, td - (tm.tBase - RUNNER.commit));
  const leave = tm.tBase + late;
  return { leave, arrival: leave + RUNNER.roundTime + BASE_PATH / RUNNER.speed, late };
}

// 판단 결과의 상황. 리드 주자가 송구 승부를 하면 타자 주자는 송구 사이에 2루까지 간다.
function states(scn: RunScenario): { safe: BaseState; out: BaseState; stay: BaseState } {
  const o = scn.situation.outs;
  if (scn.me === 'batter') {
    return {
      stay: { runs: 0, outs: o, runners: R(true, false, false) },
      safe: { runs: 0, outs: o, runners: R(false, true, false) },
      out: { runs: 0, outs: o + 1, runners: R(false, false, false) },
    };
  }
  if (scn.me === 'r1') {
    return {
      stay: { runs: 0, outs: o, runners: R(true, true, false) },
      safe: { runs: 0, outs: o, runners: R(false, true, true) },
      out: { runs: 0, outs: o + 1, runners: R(false, true, false) },
    };
  }
  return {
    stay: { runs: 0, outs: o, runners: R(true, false, true) },
    safe: { runs: 1, outs: o, runners: R(false, true, false) },
    out: { runs: 0, outs: o + 1, runners: R(false, true, false) },
  };
}

// 세이프 확률과 기대 득점으로 '간다 / 멈춘다'를 비교한다
export function goStopValue(margin: number, st: { safe: BaseState; out: BaseState; stay: BaseState }, goId = 'go', stopId = 'stop'): StepValue {
  const p = safeProb(margin);
  const vs = expectancy(st.safe);
  const vo = expectancy(st.out);
  const vk = expectancy(st.stay);
  const breakEven = vs > vo ? Math.min(1, Math.max(0, (vk - vo) / (vs - vo))) : 1;
  return {
    options: [
      { id: goId, ev: p * vs + (1 - p) * vo, lines: [`세이프 ${pct(p)} → ${evText(st.safe)}`, `아웃 ${pct(1 - p)} → ${evText(st.out)}`] },
      { id: stopId, ev: vk, lines: [evText(st.stay)] },
    ],
    note: `세이프 확률은 <b>${pct(p)}</b>. 이 상황에선 <b>${pct(breakEven)}</b>보다 높아야 가는 게 이득이에요.`,
  };
}

// 코치 콜: 속도를 줄이지 않고 베이스를 돌 수 있는 마지막 순간의 계산으로 3루 코치가 '돌려 / 멈춰'를 정한다
export function coachCall(scn: RunScenario) {
  const r = extraRoute(scn);
  const tm = extraTiming(scn);
  const commitAt = tm.tBase - RUNNER.commit;
  const v = goStopValue(tm.tagAt - extraArrival(scn, commitAt).arrival, states(scn));
  const go = v.options[0].ev > v.options[1].ev;
  return { go, text: go ? `돌려! ${r.target === 'home' ? '홈까지' : '3루까지'}` : `멈춰! ${BASE_LABEL[r.mid]}에서`, commitAt };
}

// 1루→3루, 2루→홈: 콜이 나오는 순간 선택지가 뜨고, 콜대로 바로 반응하는 게 답이다 (늦으면 베이스에서 머뭇거린다)
function coachStep(scn: RunScenario): Step {
  const tm = extraTiming(scn);
  const st = states(scn);
  const call = coachCall(scn);
  const callId = call.go ? 'go' : 'stop';
  return {
    key: 'extra',
    name: '코치 콜',
    prompt: `3루 코치: ${call.text}`,
    urgent: `지금! 3루 코치: ${call.text}`,
    options: [
      { id: 'stop', key: 'A', label: extraLabel(scn, 'stop'), short: extraLabel(scn, 'stop'), pos: BASES[extraRoute(scn).mid] },
      { id: 'go', key: 'D', label: extraLabel(scn, 'go'), short: extraLabel(scn, 'go'), pos: BASES[extraRoute(scn).target] },
    ],
    decisionAt: call.commitAt,
    deadline: tm.deadline,
    showAt: Math.max(0.2, call.commitAt - RUNNER.coachLead),
    call: { text: call.text, go: call.go },
    timeout: 'stop',
    value: (td) => {
      const v = goStopValue(tm.tagAt - extraArrival(scn, td).arrival, st);
      const mine = v.options.find((o) => o.id === callId)!;
      const other = v.options.find((o) => o.id !== callId)!;
      other.ev = Math.min(other.ev, mine.ev - 0.3);
      other.invalid = true;
      other.lines.push(`코치 콜은 <b>${call.text}</b>였어요. 공이 등 뒤에 있는 주루는 코치 콜을 따라요.`);
      return { ...v, note: `3루 코치 콜: <b>${call.text}</b> 콜이 나오면 바로 반응해야 속도를 줄이지 않고 베이스를 돌아요.` };
    },
  };
}

export function extraStep(scn: RunScenario): Step {
  if (isCoach(scn)) return coachStep(scn);
  const r = extraRoute(scn);
  const tm = extraTiming(scn);
  const st = states(scn);
  const prompt = r.target === 'home' ? '홈까지 갈까?' : `${BASE_LABEL[r.target]}까지 갈까?`;
  return {
    key: 'extra',
    name: '한 베이스 더',
    prompt,
    urgent: `지금 정하세요! ${prompt}`,
    options: [
      { id: 'stop', key: 'A', label: extraLabel(scn, 'stop'), short: extraLabel(scn, 'stop'), pos: BASES[r.mid] },
      { id: 'go', key: 'D', label: extraLabel(scn, 'go'), short: extraLabel(scn, 'go'), pos: BASES[r.target] },
    ],
    decisionAt: tm.decisionAt,
    deadline: tm.deadline,
    timeout: 'stop',
    value: (td) => goStopValue(tm.tagAt - extraArrival(scn, td).arrival, st),
  };
}

export interface ExtraResult {
  safe: boolean | null;
  arrival: number | null;
  tagAt: number;
  hesitated: number;
  state: BaseState;
  target: BaseId;
}

export function extraResult(scn: RunScenario, choice: string, td: number, noise: number): ExtraResult {
  const tm = extraTiming(scn);
  const st = states(scn);
  const tagAt = tm.tagAt + noise;
  const r = extraRoute(scn);
  if (choice !== 'go') return { safe: null, arrival: null, tagAt, hesitated: 0, state: st.stay, target: r.target };
  const go = extraArrival(scn, td);
  const safe = go.arrival < tagAt;
  return { safe, arrival: go.arrival, tagAt, hesitated: go.late, state: safe ? st.safe : st.out, target: r.target };
}

export function extraTimeline(scn: RunScenario, pitchFlight: number, choice: { id: string; td: number } | null, noise: number): RunTimeline {
  const { tRelease, tWindup, start } = pitchTimes(pitchFlight);
  const r = extraRoute(scn);
  const tm = extraTiming(scn);
  const hit = scn.hit!;
  const thr = outfieldThrow(hit.field, r.target, tm.release, noise);
  const ball = [PITCH_SEG(tRelease), ...hitSegments(hit), { from: thr.from, to: thr.to, t0: thr.t0, t1: thr.t1, arc: throwArc(thr.from, thr.to), thrower: scn.fielder }];
  const def = outfieldDefense(scn.fielder!, hit.field, hit.fieldT, r.target, r.mid);

  const me: Key[] = [];
  const s = tm.start;
  if (scn.me === 'batter') me.push({ t: s.t, pos: s.pos.clone() }, { t: tm.tBase, pos: BASES[r.mid].clone() });
  else me.push({ t: tWindup, pos: leadSpot(r.origin, RUN.leadOff) }, { t: 0, pos: s.pos.clone() }, { t: s.t, pos: s.pos.clone() }, { t: tm.tBase, pos: BASES[r.mid].clone() });

  const tl: RunTimeline = {
    start,
    tWindup,
    tRelease,
    ball,
    fielders: def.moves,
    me,
    meBatter: scn.me === 'batter',
    meStart: s.t,
    others: [],
    calls: [],
    plays: [],
    slides: [],
    end: Infinity,
  };
  let batterGoes = false;
  if (choice) {
    const res = extraResult(scn, choice.id, choice.td, noise);
    if (choice.id === 'go') {
      const go = extraArrival(scn, choice.td);
      // 아웃이면 태그되는 순간 그 자리에 멈춘다 (주자가 베이스 앞 TAG_REACH까지 와야 태그된다)
      const tEnd = res.safe ? go.arrival : Math.max(res.tagAt, go.arrival - TAG_REACH / RUNNER.speed);
      const leg: Key[] = [
        { t: go.leave, pos: BASES[r.mid].clone() },
        { t: go.arrival, pos: BASES[r.target].clone() },
      ];
      me.push({ t: go.leave, pos: BASES[r.mid].clone() }, { t: tEnd, pos: trackAt(leg, tEnd).pos.clone() });
      tl.calls.push(tagCall(r.target, tEnd, !!res.safe));
      tl.plays.push({ t: tEnd, base: r.target, out: !res.safe, receiver: def.receiver, runner: 'me' });
      tl.slides.push({ runner: 'me', base: r.target, t: tEnd });
      batterGoes = scn.me !== 'batter';
      tl.end = Math.max(tEnd, thr.t1) + 1.6;
    } else tl.end = Math.max(tm.tBase, thr.t1) + 1.4;
  }
  if (scn.me !== 'batter') tl.others.push(batterRun(scn, undefined, batterGoes));
  return tl;
}
