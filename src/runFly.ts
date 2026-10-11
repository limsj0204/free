import { RUN, RUNNER } from './config';
import { BASES, BASE_LABEL, type BaseId } from './coords';
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
  batterRun,
  evText,
  expectancy,
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
  type OptionValue,
  type RunScenario,
  type RunTimeline,
  type Step,
} from './runner';
import type { FielderId } from './scenario';
import { CONTACT_POINT, type BallSeg } from './timeline';

// 외야 플라이. 판단이 두 번 있다.
// 1단계(타구 판단): 공이 뜨는 순간 스타트 / 하프웨이 / 베이스로(태그업 준비) 중 고른다.
//   잡히면 베이스에서 떨어져 있던 주자는 귀루해야 하고(늦으면 더블아웃), 태그업을 하려면 잡히는 순간 베이스를 밟고 있어야 한다.
//   떨어지면(안타) 1루 주자는 포스라 2루까지 가야 하고, 그 밖의 주자는 갈 수 있는 데까지 간다.
// 2단계(태그업): 베이스를 밟고 있다가 잡히면 다음 베이스로 뛸지 정한다.

const REACT = 0.1; // 판단 뒤 첫발까지
const LEAD0 = RUN.leadOff + RUNNER.secondaryLead; // 타격 순간 리드 거리
const BASE_INDEX: Record<BaseId, number> = { home: 0, first: 1, second: 2, third: 3 };

export type ReadChoice = 'go' | 'half' | 'tag';

export function flyBases(scn: RunScenario) {
  const origin = ORIGIN[scn.me];
  return { origin, next: NEXT[origin] };
}

const READ_LABEL = (scn: RunScenario): Record<ReadChoice, string> => ({
  go: `스타트 (${BASE_LABEL[NEXT[ORIGIN[scn.me]]]} 쪽으로)`,
  half: '하프웨이',
  tag: '베이스로 (태그업 준비)',
});

export function readLabel(scn: RunScenario, id: string) {
  return READ_LABEL(scn)[id as ReadChoice];
}

export function tagupLabel(scn: RunScenario, id: string) {
  const b = flyBases(scn);
  return id === 'go' ? `태그업, ${baseLabelTo(b.next)}` : `${BASE_LABEL[b.origin]}에 머묾`;
}

// 1단계 선택에 따른 위치: 베이스에서 다음 베이스 쪽으로 몇 m 나가 있는지
export function progress(choice: ReadChoice | null, td: number, t: number) {
  const tm = td + REACT;
  if (choice === null || t <= tm) return LEAD0;
  const v = RUNNER.speed;
  if (choice === 'tag') return Math.max(0, LEAD0 - v * (t - tm));
  if (choice === 'half') return Math.min(RUNNER.halfway * BASE_PATH, LEAD0 + v * (t - tm));
  return LEAD0 + v * (t - tm);
}

const ON_BASE = 0.3; // 이 거리 안이면 베이스를 밟고 있는 것으로 본다

interface Caught {
  state: BaseState; // 기대 득점 계산용 (반환 가능한 경우 확률 반영 전 '세이프' 쪽)
  ev: number;
  onBase: boolean;
  returnT?: number;
  ballAt?: number;
  pSafe?: number;
  safeState?: BaseState;
  outState?: BaseState;
  lines: string[];
}

function single(base: BaseId): BaseState['runners'] {
  return R(base === 'first', base === 'second', base === 'third');
}

// ---------- 2단계: 태그업 ----------

export function tagupTiming(scn: RunScenario) {
  const hit = scn.hit!;
  const b = flyBases(scn);
  const release = hit.fieldT + RUNNER.release[hit.release];
  const thr = outfieldThrow(hit.field, b.next, release, 0);
  return { release, tagAt: thr.t1 + TAG_TIME };
}

export function tagupArrival(scn: RunScenario, td: number) {
  const leave = Math.max(td, scn.hit!.fieldT) + RUNNER.tagupReaction;
  return { leave, arrival: leave + BASE_PATH / RUNNER.speed };
}

function tagupStates(scn: RunScenario) {
  const b = flyBases(scn);
  const o = scn.situation.outs + 1; // 플라이가 잡혀서 타자는 아웃
  const scored = b.next === 'home';
  return {
    stay: { runs: 0, outs: o, runners: single(b.origin) },
    safe: { runs: scored ? 1 : 0, outs: o, runners: scored ? R(false, false, false) : single(b.next) },
    out: { runs: 0, outs: o + 1, runners: R(false, false, false) },
  };
}

export function tagupStep(scn: RunScenario): Step {
  const b = flyBases(scn);
  const T = scn.hit!.fieldT;
  const tm = tagupTiming(scn);
  return {
    key: 'tagup',
    name: '태그업',
    prompt: `잡혔다! ${baseLabelTo(b.next)} 뛸까?`,
    urgent: `잡혔다! ${baseLabelTo(b.next)} 뛸까?`,
    options: [
      { id: 'go', key: 'W', label: tagupLabel(scn, 'go'), short: tagupLabel(scn, 'go'), pos: BASES[b.next] },
      { id: 'stop', key: 'S', label: tagupLabel(scn, 'stop'), short: tagupLabel(scn, 'stop'), pos: null },
    ],
    decisionAt: T,
    deadline: T + RUNNER.tagupWindow,
    timeout: 'stop',
    value: (td) => goStopValue(tm.tagAt - tagupArrival(scn, td).arrival, tagupStates(scn)),
  };
}

// ---------- 1단계: 타구 판단 ----------

function caughtValue(scn: RunScenario, choice: ReadChoice, td: number): Caught {
  const hit = scn.hit!;
  const b = flyBases(scn);
  const T = hit.fieldT;
  const o = scn.situation.outs;
  if (o + 1 >= 3) {
    const st = { runs: 0, outs: 3, runners: R(false, false, false) };
    return { state: st, ev: 0, onBase: progress(choice, td, T) <= ON_BASE, lines: ['잡히면 3아웃, 이닝 종료 (무엇을 했든 같아요)'] };
  }
  const x = progress(choice, td, T);
  if (x <= ON_BASE) {
    // 베이스를 밟고 있다: 태그업 판단으로 이어진다 (최선의 2단계를 했다고 보고 계산)
    const v = tagupStep(scn).value(T);
    const best = v.options.reduce((a, c) => (c.ev > a.ev ? c : a));
    const st = tagupStates(scn);
    return {
      state: best.id === 'go' ? st.safe : st.stay,
      ev: best.ev,
      onBase: true,
      lines: [`잡히면: 베이스를 밟고 있어서 태그업 가능 → ${best.id === 'go' ? `${baseLabelTo(b.next)} 뛰는 게 이득` : '머무는 게 이득'} (기대 ${best.ev.toFixed(2)}점)`],
    };
  }
  // 베이스에서 떨어져 있다: 귀루해야 하고, 송구보다 늦으면 더블아웃
  const returnT = T + RUNNER.returnReaction + x / RUNNER.speed;
  const release = T + RUNNER.release[hit.release];
  const ballAt = outfieldThrow(hit.field, b.origin, release, 0).t1;
  const p = safeProb(ballAt - returnT);
  const safeState = { runs: 0, outs: o + 1, runners: single(b.origin) };
  const outState = { runs: 0, outs: o + 2, runners: R(false, false, false) };
  return {
    state: safeState,
    ev: p * expectancy(safeState) + (1 - p) * expectancy(outState),
    onBase: false,
    returnT,
    ballAt,
    pSafe: p,
    safeState,
    outState,
    lines: [`잡히면: ${x.toFixed(0)}m 나가 있어서 귀루 → 세이프 ${pct(p)} ${evText(safeState)} / 더블아웃 ${pct(1 - p)}`],
  };
}

export interface Drop {
  state: BaseState;
  final: BaseId | null; // 마지막에 선 베이스 (null: 득점 또는 아웃)
  scored: boolean;
  forcedOut: boolean;
  start: { t: number; x: number }; // 다음 베이스로 출발한 시각과 위치
  arrivals: number[]; // 베이스 k(1..)에 도착하는 시간
  playBase: BaseId; // 외야수가 던지는 베이스
  playT: number; // 그 베이스에 공이 도착하는 시간 (오차 없이)
}

// 공이 떨어졌을 때: 1루 주자는 포스라 2루까지 가야 하고, 다른 주자는 송구보다 여유 있게 도착할 수 있는 데까지 간다
export function dropOutcome(scn: RunScenario, choice: ReadChoice, td: number): Drop {
  const hit = scn.hit!;
  const drop = hit.drop!;
  const b = flyBases(scn);
  const T = hit.fieldT;
  const v = RUNNER.speed;
  const x = progress(choice, td, T);
  const start = choice === 'go' ? { t: T, x } : { t: T + RUNNER.dropReaction, x };
  const idx = BASE_INDEX[b.origin];
  const kmax = 4 - idx;
  const release = drop.t + RUNNER.release.charging;
  const baseAt = (k: number): BaseId => (['home', 'first', 'second', 'third'] as BaseId[])[(idx + k) % 4];
  const arrivals: number[] = [0];
  for (let k = 1; k <= kmax; k++) arrivals.push(start.t + (k * BASE_PATH - start.x) / v + RUNNER.roundTime * Math.max(0, k - 1 - Math.floor(start.x / BASE_PATH)));
  const forced = scn.me === 'r1';
  const ballAt = (k: number) => outfieldThrow(drop.field, baseAt(k), release, 0).t1 + (forced && k === 1 ? 0 : TAG_TIME);
  let k = forced ? 1 : 0;
  const o = scn.situation.outs;
  if (forced && arrivals[1] >= ballAt(1)) {
    return { state: { runs: 0, outs: o + 1, runners: R(true, false, false) }, final: null, scored: false, forcedOut: true, start, arrivals, playBase: baseAt(1), playT: ballAt(1) - 0 };
  }
  while (k < kmax && arrivals[k + 1] + RUNNER.advanceMargin < ballAt(k + 1)) k++;
  const scored = k === kmax;
  const final = scored ? null : baseAt(k);
  const runners = R(true, final === 'second', final === 'third');
  const playK = Math.min(kmax, k + 1);
  return { state: { runs: scored ? 1 : 0, outs: o, runners }, final, scored, forcedOut: false, start, arrivals, playBase: baseAt(playK), playT: ballAt(playK) };
}

function dropLine(scn: RunScenario, d: Drop) {
  const b = flyBases(scn);
  const where = d.forcedOut ? `${BASE_LABEL[d.playBase]}에서 포스아웃` : d.scored ? '홈인' : d.final === b.origin ? `${BASE_LABEL[b.origin]}에 그대로` : `${BASE_LABEL[d.final!]}까지`;
  return `떨어지면: ${where} → ${evText(d.state)}`;
}

export function readStep(scn: RunScenario): Step {
  const hit = scn.hit!;
  const pc = hit.catchProb ?? 1;
  const labels = READ_LABEL(scn);
  const b = flyBases(scn);
  const value = (td: number) => {
    const options: OptionValue[] = (['go', 'half', 'tag'] as ReadChoice[]).map((c) => {
      const caught = caughtValue(scn, c, td);
      const drop = dropOutcome(scn, c, td);
      const ev = pc * caught.ev + (1 - pc) * expectancy(drop.state);
      return { id: c, ev, lines: [`${caught.lines[0]} (${pct(pc)})`, `${dropLine(scn, drop)} (${pct(1 - pc)})`] };
    });
    if (scn.situation.outs === 2) {
      // 2아웃이면 잡히는 순간 이닝이 끝나서 돌아올 이유가 없다. 결과가 비슷해 보여도 스타트만 답이다.
      const go = options.find((o) => o.id === 'go')!;
      for (const o of options) {
        if (o.id === 'go') continue;
        o.ev = Math.min(o.ev, go.ev - 0.3);
        o.invalid = true;
        o.lines.push('2아웃이면 잡혀도 이닝이 끝나서 베이스로 돌아올 이유가 없어요. 무조건 스타트예요.');
      }
      return { options, note: '<b>2아웃</b>이에요. 공이 잡히면 이닝이 끝나니, 타격과 동시에 무조건 스타트해요.' };
    }
    return { options, note: `이 타구가 잡힐 확률은 <b>${pct(pc)}</b>예요. 잡혔을 때와 떨어졌을 때를 함께 따져서 정해요.` };
  };
  return {
    key: 'read',
    name: '타구 판단',
    prompt: '플라이! 어떻게 할까?',
    urgent: '지금 정하세요! 플라이를 보고 어떻게 할까?',
    options: [
      { id: 'go', key: 'W', label: labels.go, short: '스타트', pos: BASES[b.next] },
      { id: 'half', key: 'D', label: labels.half, short: '하프웨이', pos: along(b.origin, RUNNER.halfway * BASE_PATH) },
      { id: 'tag', key: 'S', label: labels.tag, short: '베이스로', pos: BASES[b.origin] },
    ],
    decisionAt: RUNNER.flyRead,
    deadline: RUNNER.flyRead + RUNNER.flyWindow,
    timeout: 'tag',
    value,
  };
}

// 1단계에서 베이스를 밟고 있어서 공이 잡히면 2단계(태그업)로 가는지
export function needsTagup(scn: RunScenario, choice: ReadChoice, td: number, caught: boolean) {
  return caught && scn.situation.outs + 1 < 3 && progress(choice, td, scn.hit!.fieldT) <= ON_BASE;
}

// ---------- 결과 ----------

export interface FlyResult {
  caught: boolean;
  state: BaseState;
  headline: string;
  lines: string[];
  timing?: { base: BaseId; arrival: number; ball: number; safe: boolean; label: string };
}

export function flyResult(scn: RunScenario, read: { id: string; td: number }, caught: boolean, tag: { id: string; td: number } | null, noise: number): FlyResult {
  const b = flyBases(scn);
  const choice = read.id as ReadChoice;
  const o = scn.situation.outs;
  if (caught) {
    if (o + 1 >= 3) return { caught, state: { runs: 0, outs: 3, runners: R(false, false, false) }, headline: '잡혔어요, 이닝 종료', lines: ['2아웃이라 잡히면 이닝이 끝나요.'] };
    if (tag) {
      const st = tagupStates(scn);
      if (tag.id !== 'go') return { caught, state: st.stay, headline: `${BASE_LABEL[b.origin]}에 머물렀어요`, lines: [] };
      const tm = tagupTiming(scn);
      const go = tagupArrival(scn, tag.td);
      const tagAt = tm.tagAt + noise;
      const safe = go.arrival < tagAt;
      return {
        caught,
        state: safe ? st.safe : st.out,
        headline: safe ? (b.next === 'home' ? '희생플라이, 득점!' : `태그업 ${BASE_LABEL[b.next]} 세이프!`) : `${BASE_LABEL[b.next]}에서 태그아웃`,
        lines: [],
        timing: { base: b.next, arrival: go.arrival, ball: tagAt, safe, label: '태그' },
      };
    }
    const c = caughtValue(scn, choice, read.td);
    if (c.onBase) {
      // 늦게 정해서 2단계를 못 했다 (시간 초과로 처리된 경우)
      const st = tagupStates(scn);
      return { caught, state: st.stay, headline: `${BASE_LABEL[b.origin]}에 머물렀어요`, lines: [] };
    }
    const ballAt = c.ballAt! + noise;
    const safe = c.returnT! < ballAt;
    return {
      caught,
      state: safe ? c.safeState! : c.outState!,
      headline: safe ? '귀루 세이프' : '더블아웃!',
      lines: [safe ? '베이스에서 떨어져 있어서 태그업은 못 했어요.' : '베이스에서 너무 멀리 나가 있어서 돌아오기 전에 공이 왔어요.'],
      timing: { base: b.origin, arrival: c.returnT!, ball: ballAt, safe, label: '송구' },
    };
  }
  const d = dropOutcome(scn, choice, read.td);
  const headline = d.forcedOut ? `${BASE_LABEL[d.playBase]}에서 포스아웃` : d.scored ? '안타! 홈인' : d.final === b.origin ? `안타! ${BASE_LABEL[b.origin]}에 그대로` : `안타! ${BASE_LABEL[d.final!]}까지`;
  const lines = d.forcedOut ? ['1루 주자는 타자가 1루로 오니 무조건 2루까지 가야 해요(포스). 베이스에 붙어 있다 늦게 출발해서 2루에서 잡혔어요.'] : [];
  return { caught, state: d.state, headline, lines };
}

// ---------- 타임라인 ----------

export function flyTimeline(
  scn: RunScenario,
  pitchFlight: number,
  read: { id: string; td: number } | null,
  caught: boolean,
  tag: { id: string; td: number } | null,
  noise: number,
): RunTimeline {
  const { tRelease, tWindup, start } = pitchTimes(pitchFlight);
  const hit = scn.hit!;
  const b = flyBases(scn);
  const T = hit.fieldT;
  const o = scn.situation.outs;
  const choice = (read?.id ?? null) as ReadChoice | null;
  const td = read?.td ?? Infinity;
  const ball: BallSeg[] = [PITCH_SEG(tRelease)];
  const drop = hit.drop!;
  const playBase = caught ? (tag ? b.next : b.origin) : b.next;
  const def = outfieldDefense(scn.fielder!, caught ? hit.field : drop.field, caught ? T - 0.4 : drop.t, playBase, b.origin);

  if (caught) ball.push({ from: CONTACT_POINT, to: hit.field.clone().setY(1.9), t0: 0, t1: T, arc: (9.8 * T * T) / 8 });
  else {
    ball.push({ from: CONTACT_POINT, to: hit.field.clone().setY(0.1), t0: 0, t1: T, arc: (9.8 * T * T) / 8 });
    ball.push({ from: hit.field.clone().setY(0.1), to: drop.field.clone().setY(0.3), t0: T, t1: drop.t, arc: 0.8, bounces: 2 });
  }

  // 나: 투구 때 리드, 타격 순간 세컨드 리드, 판단할 때까지 그 자리에서 타구를 본다
  const x = (t: number) => progress(choice, td, t);
  const me: Key[] = [
    { t: tWindup, pos: along(b.origin, RUN.leadOff) },
    { t: 0, pos: along(b.origin, LEAD0) },
  ];
  const tl: RunTimeline = {
    start,
    tWindup,
    tRelease,
    ball,
    fielders: def.moves,
    me,
    meBatter: false,
    meStart: 0,
    others: [],
    calls: [],
    plays: [],
    slides: [],
    end: Infinity,
  };
  const pushTo = (t: number, dist: number) => me.push({ t, pos: along(b.origin, dist) });

  if (!read) {
    tl.others.push(batterRun(scn, caught ? T + 0.3 : undefined));
    return tl;
  }
  // 판단까지 1단계 움직임을 잘게 나눠 넣는다 (스타트는 베이스를 지나며 꺾인다)
  const tEnd1 = T;
  for (let t = td + REACT; t < tEnd1; t += 0.25) pushTo(t, x(t));
  pushTo(tEnd1, x(tEnd1));
  const xT = x(T);

  if (caught) {
    tl.calls.push({ t: T, pos: hit.field, text: '잡았다! 플라이 아웃', good: true });
    tl.others.push(batterRun(scn, T + 0.3));
    if (o + 1 >= 3) {
      tl.end = T + 2;
      return tl;
    }
    const release = T + RUNNER.release[hit.release];
    if (xT <= ON_BASE) {
      // 베이스를 밟고 있다: 2단계 (태그업)
      if (!tag) return tl;
      if (tag.id === 'go') {
        const tm = tagupTiming(scn);
        const go = tagupArrival(scn, tag.td);
        const thr = outfieldThrow(hit.field, b.next, release, noise);
        ball.push({ from: thr.from, to: thr.to, t0: thr.t0, t1: thr.t1, arc: throwArc(thr.from, thr.to), thrower: scn.fielder });
        const tagAt = tm.tagAt + noise;
        const safe = go.arrival < tagAt;
        const outT = Math.max(tagAt, go.arrival - TAG_REACH / RUNNER.speed);
        const tE = safe ? go.arrival : outT;
        const leg: Key[] = [
          { t: go.leave, pos: BASES[b.origin].clone() },
          { t: go.arrival, pos: BASES[b.next].clone() },
        ];
        me.push({ t: go.leave, pos: BASES[b.origin].clone() }, { t: tE, pos: trackAt(leg, tE).pos.clone() });
        tl.calls.push(tagCall(b.next, tE, safe));
        tl.plays.push({ t: tE, base: b.next, out: !safe, receiver: def.receiver, runner: 'me' });
        tl.slides.push({ runner: 'me', base: b.next, t: tE });
        tl.end = Math.max(tE, thr.t1) + 1.6;
      } else {
        const thr = outfieldThrow(hit.field, 'second', release, 0);
        ball.push({ from: thr.from, to: thr.to, t0: thr.t0, t1: thr.t1, arc: throwArc(thr.from, thr.to), thrower: scn.fielder });
        tl.end = thr.t1 + 1.2;
      }
      return tl;
    }
    // 귀루: 송구보다 늦으면 더블아웃
    const thr = outfieldThrow(hit.field, b.origin, release, noise);
    ball.push({ from: thr.from, to: thr.to, t0: thr.t0, t1: thr.t1, arc: throwArc(thr.from, thr.to), thrower: scn.fielder });
    const back0 = T + RUNNER.returnReaction;
    const backT = back0 + xT / RUNNER.speed;
    const safe = backT < thr.t1;
    const leg: Key[] = [];
    for (let t = back0; t < backT; t += 0.25) leg.push({ t, pos: along(b.origin, xT - (t - back0) * RUNNER.speed) });
    leg.push({ t: backT, pos: BASES[b.origin].clone() });
    const tE = safe ? backT : thr.t1;
    me.push(...leg.filter((k) => k.t < tE), { t: tE, pos: trackAt([{ t: back0, pos: along(b.origin, xT) }, ...leg], tE).pos.clone() });
    tl.calls.push({ t: tE, pos: BASES[b.origin], text: safe ? '귀루 세이프' : '더블아웃!', good: !safe });
    tl.plays.push({ t: tE, base: b.origin, out: !safe, receiver: receiverOfBase(b.origin), runner: 'me' });
    tl.end = Math.max(tE, thr.t1) + 1.6;
    return tl;
  }

  // 떨어졌다: 안타
  tl.calls.push({ t: T + 0.1, pos: hit.field, text: '떨어졌다! 안타', good: false });
  tl.others.push(batterRun(scn));
  const d = dropOutcome(scn, choice!, td);
  const release = drop.t + RUNNER.release.charging;
  const thr = outfieldThrow(drop.field, d.playBase, release, noise);
  ball.push({ from: thr.from, to: thr.to, t0: thr.t0, t1: thr.t1, arc: throwArc(thr.from, thr.to), thrower: scn.fielder });
  if (choice !== 'go') me.push({ t: d.start.t, pos: along(b.origin, d.start.x) });
  const idx = BASE_INDEX[b.origin];
  const kFinal = d.forcedOut ? 1 : d.scored ? 4 - idx : BASE_INDEX[d.final!] - idx;
  if (d.forcedOut) {
    const outT = thr.t1;
    const leg: Key[] = [
      { t: d.start.t, pos: along(b.origin, d.start.x) },
      { t: d.arrivals[1], pos: BASES[b.next].clone() },
    ];
    me.push({ t: outT, pos: trackAt(leg, outT).pos.clone() });
    tl.calls.push({ t: outT, pos: BASES[b.next], text: '포스아웃', good: true });
    tl.plays.push({ t: outT, base: b.next, out: true, receiver: receiverOfBase(b.next), runner: 'me' });
    tl.end = outT + 1.6;
    return tl;
  }
  for (let k = 1; k <= kFinal; k++) {
    if (k * BASE_PATH > d.start.x) me.push({ t: d.arrivals[k], pos: along(b.origin, k * BASE_PATH) });
  }
  if (kFinal === 0) me.push({ t: d.start.t + d.start.x / RUNNER.speed, pos: BASES[b.origin].clone() });
  const lastT = kFinal > 0 ? d.arrivals[kFinal] : d.start.t + d.start.x / RUNNER.speed;
  tl.calls.push({ t: Math.max(lastT, T + 0.5), pos: d.scored ? BASES.home : BASES[d.final!], text: d.scored ? '홈인!' : '세이프', good: false });
  tl.end = Math.max(lastT, thr.t1) + 1.6;
  return tl;
}

function receiverOfBase(base: BaseId): FielderId {
  return base === 'first' ? '1B' : base === 'second' ? 'SS' : base === 'third' ? '3B' : 'C';
}
