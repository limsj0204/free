import { BASE_LABEL } from './coords';
import { josa } from './explain';
import { ARM_LABEL, ME_NAME, OF_NAME, decisionLabel, route, stateLabel, expectancy, type BaseState, type RunDecision, type RunGrade, type RunScenario, type RunVerdict } from './runner';
import { armsOf, explainRun } from './runExplain';
import type { UI } from './ui';

// 주루 판단의 브리핑과 결과 화면. 수비 화면과 같은 카드·표 스타일을 쓴다.

const $ = (id: string) => document.getElementById(id)!;
const sec = (s: number) => `${s.toFixed(2)}초`;
// 99.6%를 100%로 쓰면 '확실'처럼 보여서 양 끝은 따로 쓴다
const pct = (p: number) => (p > 0.99 ? '99% 이상' : p < 0.01 ? '1% 미만' : `${Math.round(p * 100)}%`);

export function runPrompt(scn: RunScenario) {
  if (scn.kind === 'tagup') return `잡히면 ${josa(BASE_LABEL[route(scn).target], '으로', '로')} 뛸까?`;
  const r = route(scn);
  return r.target === 'home' ? '홈까지 갈까?' : `${BASE_LABEL[r.target]}까지 갈까?`;
}

export function showRunBriefing(ui: UI, scn: RunScenario, eyebrow: string | null) {
  ui.hideAll();
  ui.setHelp('마우스: 고개 돌리기 · W: 간다 · S: 멈춘다 · 클릭: 바라보는 베이스 · Esc: 마우스 풀기');
  document.getElementById('hud')!.classList.remove('hidden');
  const sit = scn.situation;
  const outsLabel = sit.outs === 0 ? '무사' : `${sit.outs}아웃`;
  const bases = (['first', 'second', 'third'] as const).filter((b) => sit.runners[b]);
  const runnersLabel = bases.length ? `주자 ${bases.map((b) => BASE_LABEL[b].replace('루', '')).join(', ')}루` : '주자 없음';
  const arms = armsOf(scn);
  const armRow = (['LF', 'CF', 'RF'] as const).map((f) => `${OF_NAME[f]} <b>${ARM_LABEL[arms[f]]}</b>`).join(' · ');
  const el = $('briefing');
  el.innerHTML = `
    <div class="card">
      <div class="eyebrow">${[eyebrow, scn.kind === 'tagup' ? '태그업 판단' : '한 베이스 더'].filter(Boolean).join(' · ')}</div>
      <div class="brief-grid">
        <section class="brief-box">
          <div class="brief-label">카운트 · 주자</div>
          <div class="brief-sit">
            <svg class="brief-bases" viewBox="0 0 60 44" aria-hidden="true">
              <rect class="${sit.runners.second ? 'on' : ''}" x="23" y="2" width="14" height="14" transform="rotate(45 30 9)" />
              <rect class="${sit.runners.first ? 'on' : ''}" x="39" y="18" width="14" height="14" transform="rotate(45 46 25)" />
              <rect class="${sit.runners.third ? 'on' : ''}" x="7" y="18" width="14" height="14" transform="rotate(45 14 25)" />
            </svg>
            <div class="brief-sit-text">
              <b>${outsLabel}<span class="brief-outs">${[0, 1].map((i) => `<i class="${i < sit.outs ? 'on' : ''}"></i>`).join('')}</span></b>
              <span>${runnersLabel}</span>
            </div>
          </div>
        </section>
        <section class="brief-box">
          <div class="brief-label">나</div>
          <b class="brief-main">${ME_NAME[scn.me]}</b>
          <span class="brief-sub">${scn.event}</span>
        </section>
      </div>
      <p>${scn.brief}</p>
      <p class="arms">외야수 어깨: ${armRow}</p>
      <p class="note">타격 순간부터 선택지가 떠요. <kbd>W</kbd> 간다, <kbd>S</kbd> 멈춘다. 미리 고르면 판단 순간 바로 실행되고, 안 고르면 판단 순간 화면이 느려져요.
        시점은 공을 따라가고, 마우스로 직접 돌리면 그때부터는 내가 보는 대로 둬요.</p>
      <div class="actions">
        <button class="secondary" id="brief-menu-btn">목록</button>
        <button class="primary" id="start-btn"><kbd>Enter</kbd>시작</button>
      </div>
    </div>`;
  $('start-btn').addEventListener('click', () => ui.onStart());
  $('brief-menu-btn').addEventListener('click', () => ui.onMenu());
  el.classList.remove('hidden');
}

const VERDICT: Record<RunVerdict, (g: RunGrade) => string> = {
  ideal: (g) => (g.best.length > 1 ? '좋은 판단' : '최선의 판단'),
  late: (g) => (g.grade === 'ok' ? '판단은 맞았지만 늦었어요' : '판단은 맞았지만 너무 늦었어요'),
  fallback: () => '최선은 아니지만, 늦은 시점에선 더 나은 선택',
  other: (g) => (g.grade === 'ok' ? '나쁘지 않지만 더 좋은 선택이 있었어요' : '다시 생각해 봐요'),
  timeout: () => '시간 안에 정하지 못했어요',
};

export interface RunResultData {
  scenario: RunScenario;
  decision: RunDecision;
  delay: number;
  timedOut: boolean;
  grade: RunGrade;
  safe: boolean | null; // 갔을 때만 (세이프면 true)
  noise: number; // 이번 송구 오차
  arrival: number | null; // 갔을 때 내가 도착한 시간
  tagAt: number; // 이번 송구로 태그한 시간
  hesitated: number; // 늦게 정해서 베이스에서 머뭇거린 시간
  reactionReal: number;
  timeScale: number;
}

const evText = (st: BaseState) => `${stateLabel(st)} <small>(기대 ${expectancy(st).toFixed(2)}점)</small>`;

export function showRunResult(ui: UI, r: RunResultData) {
  const scn = r.scenario;
  const g = r.grade;
  const rt = route(scn);
  const im = g.immediate;
  const label = (d: RunDecision) => decisionLabel(scn, d);
  const actual = r.decision === 'go' ? (r.safe ? im.safe : im.out) : im.stay;

  const headline =
    r.decision === 'stop'
      ? scn.kind === 'tagup'
        ? `${BASE_LABEL[rt.stay]}에 머물렀어요`
        : `${BASE_LABEL[rt.stay]}에서 멈췄어요`
      : r.safe
        ? rt.target === 'home'
          ? '홈인! 득점'
          : `${BASE_LABEL[rt.target]} 세이프!`
        : `${BASE_LABEL[rt.target]}에서 태그아웃`;

  // 판단 근거와 이번 플레이
  const bestLabels = g.best.map(label);
  const notes: string[] = [];
  notes.push(
    g.best.length > 1
      ? `<b>${bestLabels.join('</b>, <b>')}</b> 둘 다 좋은 판단이에요. 기대 득점 차이가 거의 없어요.`
      : `최선은 <b>${bestLabels[0]}</b>예요.`,
  );
  notes.push(
    `판단 순간 바로 정했다면 세이프 확률은 <b>${pct(im.pSafe)}</b>. 이 상황에선 <b>${pct(im.breakEven)}</b>보다 높아야 가는 게 이득이에요.`,
  );
  if (r.decision === 'go' && r.hesitated > 0.01) {
    notes.push(
      `늦게 정해서 ${scn.kind === 'tagup' ? '베이스를 늦게 떠났고' : `${BASE_LABEL[rt.stay]}에서 <b>${sec(r.hesitated)}</b> 머뭇거렸고`}, 세이프 확률이 <b>${pct(im.pSafe)}</b>에서 <b>${pct(g.mine.pSafe)}</b>로 떨어졌어요.`,
    );
  } else if (r.decision === 'go' && scn.kind === 'tagup' && r.delay > 0.01) {
    notes.push(`포구 뒤 <b>${sec(r.delay)}</b> 늦게 출발해서 세이프 확률이 <b>${pct(im.pSafe)}</b>에서 <b>${pct(g.mine.pSafe)}</b>로 떨어졌어요.`);
  }
  if (r.decision === 'go' && r.safe !== null) {
    if (r.safe && g.mine.pSafe < 0.5) notes.push('이번엔 송구가 늦어서 살았지만, 보통은 아웃되는 승부예요.');
    if (!r.safe && g.mine.pSafe >= 0.5) notes.push('이번엔 송구가 좋아서 아웃됐지만, 확률로는 해볼 만한 승부였어요. 결과보다 판단을 보세요.');
  }
  if (r.timedOut) notes.push('정하지 못하면 멈춘 것으로 처리돼요. 공이 외야로 가는 순간부터 미리 생각해 두세요.');

  const throwNote =
    r.noise > 0.15
      ? `이번 송구는 빗나가서 평소보다 <b>${sec(r.noise)}</b> 늦었어요.`
      : r.noise < -0.08
        ? `이번 송구는 평소보다 <b>${sec(-r.noise)}</b> 빨랐어요.`
        : '이번 송구는 평소 수준이었어요.';

  const timing =
    r.decision === 'go' && r.arrival !== null
      ? `<div class="table-wrap"><table class="timing">
          <tr><th>베이스</th><th>내 도착</th><th>태그</th><th>판정</th></tr>
          <tr><td>${BASE_LABEL[rt.target]}</td><td>${sec(r.arrival)}</td><td>${sec(r.tagAt)}</td>
          <td class="${r.safe ? 'safe' : 'out'}">${r.safe ? '세이프' : '아웃'} (${Math.abs(r.tagAt - r.arrival).toFixed(2)}초 ${r.safe ? '먼저' : '늦게'})</td></tr>
        </table></div>`
      : '';

  const choiceRow = (d: RunDecision) => {
    const mine = d === r.decision && !r.timedOut;
    const isBest = g.best.includes(d);
    const badge = isBest ? `<span class="badge">${g.best.length > 1 ? '좋은 판단' : '최선'}</span>` : '';
    const body =
      d === 'go'
        ? `세이프 ${pct(im.pSafe)} → ${evText(im.safe)}<br/>아웃 ${pct(1 - im.pSafe)} → ${evText(im.out)}<br/>평균 <b>${im.evGo.toFixed(2)}점</b>`
        : `${evText(im.stay)}<br/>평균 <b>${im.evStop.toFixed(2)}점</b>`;
    return `<div class="alt col ${mine ? 'chosen' : ''}">
      <span class="alt-name">${label(d)}${mine ? ' (내 선택)' : ''}${badge}</span>
      <span class="alt-res">${body}</span>
    </div>`;
  };

  ui.openResult(
    `
    <span class="grade ${g.grade}">${VERDICT[g.verdict](g)}</span>
    <h1>${headline}</h1>
    <div class="result-state">${r.timedOut ? '시간 안에 정하지 못함 · ' : ''}${label(r.decision)} → ${stateLabel(actual)}</div>
    <div class="stat-row">
      <div class="stat"><small>실제 경기 기준 판단 시간</small><b>${r.timedOut ? '시간 초과' : sec(r.delay)}</b></div>
      <div class="stat"><small>화면에서 고민한 시간 (슬로모션 ${r.timeScale}배)</small><b>${sec(r.reactionReal)}</b></div>
    </div>
    <p class="note">${notes.join('<br/>')}</p>
    ${timing}
    <p class="note">${throwNote} (${OF_NAME[scn.fielder]} 어깨: ${ARM_LABEL[scn.arm]})</p>
    <h2>판단 기준: 기대 득점 (판단 순간 바로 정했다면)</h2>
    ${choiceRow('go')}
    ${choiceRow('stop')}`,
    `
    <h2>해설</h2>
    <p class="explain">${explainRun(scn)}</p>
    <h2>기대 득점이란?</h2>
    <p class="explain">아웃 카운트와 주자 상황에서 이닝이 끝날 때까지 평균 몇 점이 나는지예요 (MLB 평균). 가서 세이프면 얻는 것과 아웃이면 잃는 것을 세이프 확률로 따져서, 평균이 더 높은 쪽이 최선이에요.
    그래서 같은 타구라도 아웃 카운트에 따라 판단이 달라져요.</p>`,
  );
}
