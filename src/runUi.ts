import { BASE_LABEL, type BaseId } from './coords';
import type { Play, PlayResult } from './runPlay';
import { ME_NAME, RUN_TAB_LABEL, isCoach, kindLabel, stateLabel, tabOf, type RunScenario, type RunVerdict, type StepGrade } from './runner';
import { explainRun } from './runExplain';
import { annotateRun } from './runGlossary';
import { showRunPrinciples } from './runMenu';
import type { Grade } from './scenario';
import type { UI } from './ui';

// 주루 판단의 브리핑과 결과 화면. 수비 화면과 같은 카드·표 스타일을 쓴다.

const $ = (id: string) => document.getElementById(id)!;
const sec = (s: number) => `${s.toFixed(2)}초`;

const KEY_HELP: Record<RunScenario['kind'], string> = {
  extra: '<kbd>A</kbd> 멈춘다, <kbd>D</kbd> 간다',
  // 코치 콜은 keyHelp에서 따로
  fly: '<kbd>A</kbd> 내 베이스로 돌아가기(태그업 준비), <kbd>S</kbd> 중간까지(하프웨이), <kbd>D</kbd> 스타트. 베이스에 있으면 공이 잡히기 1초쯤 전에 태그업 판단이 떠요(떨어지면 사라져요): <kbd>A</kbd> 머문다, <kbd>D</kbd> 뛴다',
  ground: '<kbd>A</kbd> 귀루, <kbd>D</kbd> 진루',
  wild: '<kbd>A</kbd> 머문다, <kbd>D</kbd> 진루',
  rule: '<kbd>A</kbd> 머문다(물러난다), <kbd>D</kbd> 뛴다',
};

const keyHelp = (scn: RunScenario) =>
  scn.kind === 'fly' && scn.hit?.infielder
    ? scn.hit.type === 'liner'
      ? '<kbd>A</kbd> 내 베이스로 돌아가기(귀루), <kbd>S</kbd> 그 자리에 멈춤, <kbd>D</kbd> 스타트'
      : '<kbd>A</kbd> 내 베이스로 돌아가기(귀루), <kbd>S</kbd> 중간까지(하프웨이), <kbd>D</kbd> 스타트'
    : isCoach(scn)
      ? '3루 코치 콜이 화면에 크게 떠요. <kbd>D</kbd> 돌려(간다), <kbd>A</kbd> 멈춰(멈춘다)'
      : KEY_HELP[scn.kind];

// 타구를 숨겼을 때 브리핑에 보여주는 조작 안내 (어떤 판단이 나올지 모르니 다 보여준다)
const KEY_HELP_ALL = '<kbd>A</kbd> 뒤로(멈춤·베이스로·귀루, 코치 콜 멈춰), <kbd>S</kbd> 중간까지(하프웨이, 플라이일 때), <kbd>D</kbd> 앞으로(간다·스타트·진루, 코치 콜 돌려)';

export function showRunBriefing(ui: UI, scn: RunScenario, eyebrow: string | null, hidden: boolean) {
  ui.hideAll();
  ui.setHelp('마우스: 고개 돌리기 · A: 뒤로(멈춤·베이스로) · S: 중간까지(하프웨이) · D: 앞으로(간다) · 클릭: 바라보는 곳 · Esc: 마우스 풀기');
  document.getElementById('hud')!.classList.remove('hidden');
  const sit = scn.situation;
  const outsLabel = sit.outs === 0 ? '무사' : `${sit.outs}아웃`;
  const bases = (['first', 'second', 'third'] as const).filter((b) => sit.runners[b]);
  const runnersLabel = bases.length === 3 ? '만루' : bases.length ? `주자 ${bases.map((b) => BASE_LABEL[b].replace('루', '')).join(', ')}루` : '주자 없음';
  const el = $('briefing');
  el.innerHTML = `
    <div class="card">
      <div class="eyebrow">${[eyebrow, hidden ? '타구 숨김' : kindLabel(scn)].filter(Boolean).join(' · ')}</div>
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
          <span class="brief-sub">${hidden ? '타구는 공이 맞는 순간 공개돼요' : scn.event}</span>
        </section>
      </div>
      <p>${hidden ? `${ME_NAME[scn.me]}예요. 공이 맞는 순간 타구를 보고 판단해요. 외야 안타면 한 베이스 더(1·2루 주자는 3루 코치 콜을 따라요), 플라이면 베이스로·중간까지·스타트, 땅볼이면 진루·귀루예요.` : scn.brief}</p>
      <p class="note">타격 순간부터 선택지가 떠요. ${hidden ? KEY_HELP_ALL : keyHelp(scn)}. 미리 고르면 판단 순간 바로 실행되고, 안 고르면 판단 순간 화면이 느려져요.
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

const VERDICT: Record<RunVerdict, (g: StepGrade) => string> = {
  ideal: (g) => (g.best.length > 1 ? '좋은 판단' : '최선의 판단'),
  late: (g) => (g.grade === 'ok' ? '판단은 맞았지만 늦었어요' : '판단은 맞았지만 너무 늦었어요'),
  fallback: () => '최선은 아니지만, 늦은 시점에선 더 나은 선택',
  other: (g) => (g.grade === 'ok' ? '나쁘지 않지만 더 좋은 선택이 있었어요' : '다시 생각해 봐요'),
  timeout: () => '시간 안에 정하지 못했어요',
};

const GRADE_HEAD: Record<Grade, string> = { best: '최선의 판단', ok: '아쉬운 판단이 있었어요', bad: '다시 생각해 봐요' };

export interface RunResultData {
  scenario: RunScenario;
  play: Play;
  grades: StepGrade[];
  grade: Grade;
  result: PlayResult;
  timeScale: number;
}

// 판단 단계마다 판정과 이유 (늘 보인다)
function stepHead(g: StepGrade, multi: boolean) {
  const im = g.immediate;
  const labelOf = (id: string) => g.step.options.find((o) => o.id === id)!.label;
  const notes: string[] = [];
  if (g.verdict !== 'ideal') {
    notes.push(g.best.length > 1 ? `<b>${g.best.map(labelOf).join('</b>, <b>')}</b> 모두 좋은 판단이에요.` : `최선은 <b>${labelOf(g.best[0])}</b>예요.`);
  }
  notes.push(im.note);
  if (g.timedOut) notes.push(`정하지 못해서 <b>${labelOf(g.choice)}</b>로 처리했어요.`);
  else if (g.delay > 0.01 && g.loss > 0.01 && g.best.includes(g.choice)) notes.push(`판단 순간보다 <b>${sec(g.delay)}</b> 늦게 정해서 손해를 봤어요.`);
  return `
    <h2>${multi ? `${g.step.name}: ` : '판단 기준: '}${VERDICT[g.verdict](g)}</h2>
    <p class="note">${notes.join('<br/>')}</p>`;
}

// 선택지마다 결과와 점수 (자세히 보기 안에 접어 둔다). 선택지 하나가 한 덩어리라 왼쪽·오른쪽 칸에 나눠 넣을 수 있다.
// 단계 제목은 첫 선택지에 붙이고, 나머지 선택지에는 오른쪽 칸 맨 위로 넘어갔을 때만 보이는 '(이어서)' 제목을 둔다
function stepRows(g: StepGrade, multi: boolean) {
  const im = g.immediate;
  const title = `${multi ? `${g.step.name} ` : ''}선택지별 결과`;
  return g.step.options
    .map((o, i) => {
      const v = im.options.find((x) => x.id === o.id)!;
      const mine = o.id === g.choice && !g.timedOut;
      const badge = g.best.includes(o.id) ? `<span class="badge">${g.best.length > 1 ? '좋은 판단' : '최선'}</span>` : '';
      // 포스인데 귀루처럼 규칙상 답이 될 수 없는 선택은 평균 점수 대신 이유만 보여준다
      const avg = v.invalid ? '' : `<span class="alt-avg">평균 <b>${v.ev.toFixed(2)}점</b></span>`;
      return `<section class="more-block">${i === 0 ? `<h2>${title}</h2>` : `<h2 class="cont">${title} (이어서)</h2>`}<div class="alt col ${mine ? 'chosen' : ''}">
        <span class="alt-name">${o.label}${mine ? ' (내 선택)' : ''}${badge}${avg}</span>
        <span class="alt-res">${v.lines.join('<br/>')}</span>
      </div></section>`;
    })
    .join('');
}

// 결과 화면의 자세한 숫자(타이밍 표, 선택지별 결과)는 접어 둔다. 한 번 펼치면 다음 결과에서도 펼친 채로 보여준다
let moreOpen = false;

export function showRunResult(ui: UI, r: RunResultData) {
  const scn = r.scenario;
  const res = r.result;
  const first = r.play.decided[0];
  const path = r.play.decided.map((d) => `${d.timedOut ? '(시간 초과) ' : ''}${d.step.options.find((o) => o.id === d.id)!.label}`).join(' → ');
  const multi = r.grades.length > 1;

  const timing = res.timing
    ? `<div class="table-wrap"><table class="timing">
        <tr><th>베이스</th><th>내 도착</th><th>${res.timing.label}</th><th>판정</th></tr>
        <tr><td>${BASE_LABEL[res.timing.base as BaseId]}</td><td>${sec(res.timing.arrival)}</td><td>${sec(res.timing.ball)}</td>
        <td class="${res.timing.safe ? 'safe' : 'out'}">${res.timing.safe ? '세이프' : '아웃'} (${Math.abs(res.timing.ball - res.timing.arrival).toFixed(2)}초 ${res.timing.safe ? '먼저' : '늦게'})</td></tr>
      </table></div>`
    : '';

  const noise = r.play.noise;
  const throwNote =
    scn.kind === 'ground' || !res.timing
      ? ''
      : `<p class="note">${noise > 0.15 ? `이번 송구는 빗나가서 평소보다 <b>${sec(noise)}</b> 늦었어요.` : noise < -0.08 ? `이번 송구는 평소보다 <b>${sec(-noise)}</b> 빨랐어요.` : '이번 송구는 평소 수준이었어요.'}</p>`;

  // 결과가 판단과 엇갈렸을 때 (운)
  const luck: string[] = [];
  if (scn.kind === 'fly' && r.grades[0]) {
    const pc = scn.hit!.catchProb ?? 1;
    if (pc < 0.9) luck.push(r.play.caught ? `이 타구는 ${Math.round(pc * 100)}% 확률로 잡히는 타구였고, 이번엔 잡혔어요.` : `이 타구는 ${Math.round((1 - pc) * 100)}% 확률로 떨어지는 타구였고, 이번엔 떨어졌어요.`);
  }

  ui.openResult(
    `
    <span class="grade ${r.grade}">${r.grades.length === 1 ? VERDICT[r.grades[0].verdict](r.grades[0]) : GRADE_HEAD[r.grade]}</span>
    <h1>${res.headline}</h1>
    <div class="result-state">${path} → ${stateLabel(res.state)}</div>
    <div class="stat-row">
      <div class="stat"><small>실제 경기 기준 판단 시간${multi ? ' (첫 판단)' : ''}</small><b>${first.timedOut ? '시간 초과' : sec(r.grades[0].delay)}</b></div>
      <div class="stat"><small>화면에서 고민한 시간 (슬로모션 ${r.timeScale}배)</small><b>${sec(first.reactionReal)}</b></div>
    </div>
    ${[...res.lines, ...luck].length ? `<p class="note">${[...res.lines, ...luck].join('<br/>')}</p>` : ''}
    ${r.grades.map((g) => stepHead(g, multi)).join('')}
    <details class="more" id="result-more" ${moreOpen ? 'open' : ''}><summary>자세히 보기 (${timing ? '타이밍 비교 · ' : ''}선택지별 결과)</summary>
      <div id="more-left">
        ${timing || throwNote ? `<section class="more-block">${timing}${throwNote}</section>` : ''}
        ${r.grades.map((g) => stepRows(g, multi)).join('')}
      </div>
    </details>`,
    `
    <h2>해설</h2>
    <p class="explain">${annotateRun(explainRun(scn))}</p>
    <button class="intro-link principles-link" id="result-principles">📌 ${RUN_TAB_LABEL[tabOf(scn)]} 핵심 원칙 보기</button>
    <div class="more-side">
      <div id="more-right"></div>
    </div>`,
  );
  // '자세히 보기'를 펼치면 펼친 내용을 오른쪽 칸에도 나눠 보여준다
  document.getElementById('result-principles')!.addEventListener('click', () => showRunPrinciples(tabOf(scn)));
  const card = document.querySelector('#result .result-card')!;
  card.classList.toggle('more-open', moreOpen);
  document.getElementById('result-more')!.addEventListener('toggle', (e) => {
    moreOpen = (e.target as HTMLDetailsElement).open;
    card.classList.toggle('more-open', moreOpen);
    balanceMore();
  });
  balanceMore();
}

// 펼친 내용(타이밍 표, 선택지별 결과)을 앞에서부터 몇 개는 왼쪽, 나머지는 오른쪽에 둔다.
// 두 칸 중 긴 쪽이 가장 짧아지게 나눠서 스크롤이 덜 생기게 한다. 한 칸 화면(휴대폰)에서는 모두 왼쪽.
function balanceMore() {
  const left = document.getElementById('more-left');
  const right = document.getElementById('more-right');
  if (!left || !right) return;
  const blocks = [...document.querySelectorAll<HTMLElement>('#result .more-block')];
  const place = (k: number) => blocks.forEach((b, i) => (i < k ? left : right).appendChild(b));
  place(blocks.length);
  const main = document.querySelector<HTMLElement>('#result .result-main')!;
  const side = document.querySelector<HTMLElement>('#result .result-side')!;
  if (!moreOpen || side.offsetTop > main.offsetTop + 10) return;
  let best = blocks.length;
  let bestH = Infinity;
  for (let k = blocks.length; k >= 0; k--) {
    place(k);
    const h = Math.max(contentHeight(main), contentHeight(side));
    if (h < bestH - 1) {
      best = k;
      bestH = h;
    }
  }
  place(best);
}

window.addEventListener('resize', () => balanceMore());

// 칸 안의 내용 높이 (오른쪽 칸은 버튼을 아래로 밀어 두므로 늘어난 여백은 빼고 잰다)
function contentHeight(col: HTMLElement) {
  let h = 0;
  for (const el of col.children) {
    const cs = getComputedStyle(el);
    h += (el as HTMLElement).offsetHeight + (el.classList.contains('actions') ? 0 : parseFloat(cs.marginTop) + parseFloat(cs.marginBottom));
  }
  return h;
}
