import { extraResult, extraStep, extraTimeline } from './runExtra';
import { autoTagup, flyResult, flyTimeline, needsTagup, readStep, tagupStep, type ReadChoice } from './runFly';
import { groundResult, groundStep, groundTimeline } from './runGround';
import type { BaseState, RunScenario, RunTimeline, Step } from './runner';
import { wildResult, wildStep, wildTimeline } from './runWild';
import { ruleResult, ruleStep, ruleTimeline } from './runRule';

// 한 번의 주루 플레이: 단계별 판단을 모으고, 지금까지의 판단으로 타임라인과 결과를 만든다.

export interface Decided {
  step: Step;
  id: string;
  td: number; // 정한 시각 (게임 시간)
  timedOut: boolean;
  reactionReal: number; // 화면에서 고민한 시간 (실제 초)
}

export interface Play {
  scn: RunScenario;
  pitchFlight: number;
  noise: number; // 이번 송구의 오차
  caught: boolean; // 플라이: 이번 타구가 잡히는지
  decided: Decided[];
}

export function firstStep(scn: RunScenario): Step {
  return scn.kind === 'extra' ? extraStep(scn) : scn.kind === 'fly' ? readStep(scn) : scn.kind === 'wild' ? wildStep(scn) : scn.kind === 'rule' ? ruleStep(scn) : groundStep(scn);
}

// 다음 판단 (없으면 null). 플라이에서 베이스를 밟고 있으면 태그업 판단이 이어진다.
// 선택지는 공이 잡히기 전부터 뜨므로, 잡힐지와 상관없이 만든다 (떨어지면 게임에서 지운다). 그래야 선택지가 뜨는 것만으로 잡힐지 알 수 없다.
export function nextStep(play: Play): Step | null {
  const d = play.decided;
  if (play.scn.kind !== 'fly' || d.length !== 1) return null;
  return needsTagup(play.scn, d[0].id as ReadChoice, d[0].td, true) ? tagupStep(play.scn) : null;
}

export function playTimeline(play: Play): RunTimeline {
  const { scn, pitchFlight, noise, decided } = play;
  const c = (i: number) => (decided[i] ? { id: decided[i].id, td: decided[i].td } : null);
  if (scn.kind === 'extra') return extraTimeline(scn, pitchFlight, c(0), noise);
  if (scn.kind === 'fly') return flyTimeline(scn, pitchFlight, c(0), play.caught, c(1) ?? autoTagup(scn, c(0), play.caught), noise);
  if (scn.kind === 'wild') return wildTimeline(scn, pitchFlight, c(0), noise);
  if (scn.kind === 'rule') return ruleTimeline(scn, pitchFlight, c(0));
  return groundTimeline(scn, pitchFlight, c(0));
}

export interface PlayResult {
  state: BaseState;
  headline: string;
  lines: string[];
  timing?: { base: string; arrival: number; ball: number; safe: boolean; label: string };
}

export function playResult(play: Play): PlayResult {
  const { scn, decided, noise } = play;
  const first = { id: decided[0].id, td: decided[0].td };
  if (scn.kind === 'extra') {
    const r = extraResult(scn, first.id, first.td, noise);
    const headline =
      first.id !== 'go' ? '멈췄어요' : r.safe ? (r.target === 'home' ? '홈인! 득점' : '세이프!') : '태그아웃';
    const lines: string[] = [];
    if (r.hesitated > 0.01) lines.push(`늦게 정해서 베이스에서 <b>${r.hesitated.toFixed(2)}초</b> 머뭇거렸어요.`);
    return {
      state: r.state,
      headline,
      lines,
      timing: r.arrival !== null ? { base: r.target, arrival: r.arrival, ball: r.tagAt, safe: !!r.safe, label: '태그' } : undefined,
    };
  }
  if (scn.kind === 'fly') {
    const tag = decided[1] ? { id: decided[1].id, td: decided[1].td } : autoTagup(scn, first, play.caught);
    const r = flyResult(scn, first, play.caught, tag, noise);
    if (tag && !decided[1]) r.lines.unshift(tag.id === 'go' ? '잡혔을 때 베이스에 있어서 그대로 태그업했어요.' : '잡혔을 때 베이스에 있었지만 태그업할 거리가 아니라 머물렀어요.');
    return { state: r.state, headline: r.headline, lines: r.lines, timing: r.timing };
  }
  if (scn.kind === 'rule') return ruleResult(scn, first);
  if (scn.kind === 'wild') {
    const r = wildResult(scn, first, noise);
    return { state: r.state, headline: r.headline, lines: [], timing: r.timing };
  }
  const r = groundResult(scn, first);
  return { state: r.state, headline: r.headline, lines: r.lines };
}
