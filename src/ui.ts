import * as THREE from 'three';
import { DIFFICULTIES, RUN, type DifficultyId } from './config';
import { BASE_LABEL } from './coords';
import { josa } from './explain';
import { generatedFor } from './generated';
import { getIncludeGenerated, getRecord, setIncludeGenerated } from './progress';
import {
  FIELDER_NAME,
  POSITIONS,
  RUNNER_NAME,
  isCarry,
  latestDecision,
  type Choice,
  type ChoiceScenario,
  type Grade,
  type Outcome,
  type PositionId,
  type Scenario,
  type ThrowGrade,
  type ThrowScenario,
  type ThrowVerdict,
} from './scenario';
import { SCENARIOS, fieldersOf, scenariosFor } from './scenarios';
import type { ChoiceResult } from './timeline';

export interface DecisionDef {
  value: Choice | number;
  key: string; // 화면에 보이는 키
  code: string; // KeyboardEvent.code
  label: string;
  short: string; // 3D 표시에 쓰는 짧은 이름
  pos: THREE.Vector3 | null;
}

export interface ThrowResultData {
  scenario: ThrowScenario;
  outcome: Outcome;
  verdict: ThrowGrade;
  alternatives: Outcome[];
  reactionReal: number;
  timeScale: number;
}

export interface ChoiceResultData {
  scenario: ChoiceScenario;
  result: ChoiceResult;
  decisionAt: number;
  decisionDelay: number;
  reactionReal: number;
  timeScale: number;
}

const GRADE_LABEL: Record<Grade, string> = {
  best: '최선의 판단',
  ok: '나쁘지 않지만 더 좋은 선택이 있었어요',
  bad: '다시 생각해 봐요',
};

const VERDICT_LABEL: Record<ThrowVerdict, (g: Grade) => string> = {
  ideal: () => '최선의 판단',
  late: (g) => (g === 'ok' ? '판단은 맞았지만 늦었어요' : '판단은 맞았지만 너무 늦었어요'),
  fallback: () => '정답은 아니지만, 늦은 시점에선 맞는 선택',
  other: (g) => (g === 'ok' ? '아웃은 잡았지만 정답이 아니에요' : '다시 생각해 봐요'),
  timeout: () => '시간 안에 결정하지 못했어요',
};

const GRADE_SHORT: Record<Grade, string> = { best: '최선', ok: '아쉬움', bad: '오답' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sec = (s: number) => `${s.toFixed(2)}초`;

function situationText(scn: Scenario) {
  const s = scn.situation;
  const bases = (['first', 'second', 'third'] as const).filter((b) => s.runners[b]);
  const runners =
    bases.length === 3 ? '만루' : bases.length ? `주자 ${bases.map((b) => BASE_LABEL[b].replace('루', '')).join(', ')}루` : '주자 없음';
  return `${s.outs === 0 ? '무사' : `${s.outs}아웃`} · ${runners} · ${s.batter === 'R' ? '우타자' : '좌타자'}`;
}

function throwLabel(scn: ThrowScenario, c: Choice) {
  if (c === 'hold') return '들고 있기';
  return isCarry(scn, c) ? `${BASE_LABEL[c]} 직접 밟기` : `${BASE_LABEL[c]} 송구`;
}

export class UI {
  onChoose: (v: Choice | number) => void = () => {};
  onPickScenario: (id: string) => void = () => {};
  onDifficulty: (d: DifficultyId) => void = () => {};
  onStart: () => void = () => {};
  onRestart: () => void = () => {};
  onReplay: () => void = () => {};
  onNext: () => void = () => {};
  onMenu: () => void = () => {};
  onRandom: (scope: PositionId | 'all') => void = () => {};
  randomLabel: string | null = null; // 랜덤 연습 중이면 "유격수 랜덤" 같은 이름

  private menu = $('menu');
  private briefing = $('briefing');
  private result = $('result');
  private decision = $('decision');
  private decisionTitle = $('decision-title');
  private decisionCall = $('decision-call');
  private decisionButtons = $('decision-buttons');
  private decisionBar = $('decision-bar');
  private crosshair = $('crosshair');
  private help = $('help');
  private hud = $('hud');
  private toasts = $('toasts');
  private replayBanner = $('replay-banner');
  private tagRoot = $('tags');
  private tags: HTMLElement[] = [];
  private buttons: HTMLButtonElement[] = [];
  private tab: PositionId = 'SS';

  setHud(scn: Scenario, kmh: number) {
    $('hud-title').textContent = scn.event;
    document.querySelectorAll<HTMLElement>('.hud-outs i').forEach((el) => {
      el.classList.toggle('on', Number(el.dataset.out) < scn.situation.outs);
    });
    document.querySelectorAll<SVGRectElement>('.hud-bases rect').forEach((el) => {
      el.classList.toggle('on', scn.situation.runners[el.dataset.base as 'first' | 'second' | 'third']);
    });
    $('hud-batter').textContent = scn.situation.batter === 'R' ? '우타' : '좌타';
    $('hud-speed').textContent = String(kmh);
  }

  // ---------- 목록 ----------

  showMenu(position: PositionId, difficulty: DifficultyId) {
    this.tab = position;
    this.hideAll();
    this.hud.classList.add('hidden');
    this.renderMenu(difficulty);
    this.menu.classList.remove('hidden');
  }

  private renderMenu(difficulty: DifficultyId) {
    const done = (id: string) => getRecord(id)?.best === 'best';
    const tabs = POSITIONS.map((p) => {
      const list = scenariosFor(p);
      const n = list.filter((s) => done(s.id)).length;
      return `<button class="tab ${p === this.tab ? 'selected' : ''}" data-tab="${p}" id="tab-${p}">
        <b>${FIELDER_NAME[p]}</b><span>${n}/${list.length}</span></button>`;
    }).join('');

    const items = scenariosFor(this.tab)
      .map((s) => {
        const rec = getRecord(s.id);
        const status = rec ? `<span class="status ${rec.best}">${GRADE_SHORT[rec.best]}</span>` : '<span class="status none">도전 전</span>';
        return `<button class="item" data-scenario="${s.id}" id="item-${s.id}">
          <span class="item-main">
            <b>${s.title}</b>
            <small>${situationText(s)}</small>
          </span>
          <span class="item-side">
            <span class="kind">${s.kind === 'throw' ? '송구 판단' : '위치 판단'}</span>
            ${status}
          </span>
        </button>`;
      })
      .join('');

    const total = SCENARIOS.length;
    const cleared = SCENARIOS.filter((s) => done(s.id)).length;

    this.menu.innerHTML = `
      <div class="card menu-card">
        <div class="eyebrow">VR 야구 대비 · 내야 수비</div>
        <h1>내야 수비 판단 훈련</h1>
        <p class="note">포지션을 고르고 상황을 선택하세요. 공을 잡거나 상황이 벌어지는 순간 화면이 느려지지만, 주자는 계속 뛰어요. 모든 상황은 오른손 타자 기준이에요. 최선의 판단을 한 상황 ${cleared}/${total}</p>
        <div class="tabs" role="tablist">${tabs}</div>
        <div class="items">
          <div class="random-row">
            <button class="primary" id="random-pos">${FIELDER_NAME[this.tab]} 랜덤 연습</button>
            <button class="secondary" id="random-all">전체 포지션 랜덤</button>
          </div>
          <label class="gen-toggle" for="gen-toggle">
            <input type="checkbox" id="gen-toggle" ${getIncludeGenerated() ? 'checked' : ''} />
            <span>랜덤 연습에 자동 생성 상황도 섞기 <small>(${FIELDER_NAME[this.tab]} ${generatedFor(this.tab).length}개 · 같은 타구라도 아웃 카운트, 주자, 주자 움직임이 다른 상황)</small></span>
          </label>
          ${items}
        </div>
        <h2>난이도 (판단 순간의 슬로모션 속도)</h2>
        <div class="difficulties">
          ${DIFFICULTIES.map(
            (d) =>
              `<button data-diff="${d.id}" id="diff-${d.id}" class="${d.id === difficulty ? 'selected' : ''}"><b>${d.label}</b><span>${d.desc}</span></button>`,
          ).join('')}
        </div>
      </div>`;

    this.menu.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as PositionId;
        this.renderMenu(difficulty);
      }),
    );
    $<HTMLInputElement>('gen-toggle').addEventListener('change', (e) => setIncludeGenerated((e.target as HTMLInputElement).checked));
    $('random-pos').addEventListener('click', () => this.onRandom(this.tab));
    $('random-all').addEventListener('click', () => this.onRandom('all'));
    this.menu.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) =>
      b.addEventListener('click', () => this.onPickScenario(b.dataset.scenario!)),
    );
    this.menu.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) =>
      b.addEventListener('click', () => {
        const d = b.dataset.diff as DifficultyId;
        this.onDifficulty(d);
        this.renderMenu(d);
      }),
    );
  }

  // ---------- 브리핑 ----------

  showBriefing(scn: Scenario) {
    this.hideAll();
    this.help.textContent =
      scn.kind === 'throw'
        ? '마우스: 시점 이동 · 클릭: 바라보는 베이스로 송구 · A/S/D: 1루/2루/3루 · Space: 홈 · W: 들고 있기 · Esc: 마우스 풀기'
        : '마우스: 시점 이동 · 클릭: 바라보는 위치로 이동 · A/S/D: 선택지 순서대로 · Esc: 마우스 풀기';
    this.hud.classList.remove('hidden');
    const sit = scn.situation;
    const outsLabel = sit.outs === 0 ? '무사' : `${sit.outs}아웃`;
    const bases = (['first', 'second', 'third'] as const).filter((b) => sit.runners[b]);
    const runnersLabel = bases.length === 3 ? '만루' : bases.length ? `주자 ${bases.map((b) => BASE_LABEL[b].replace('루', '')).join(', ')}루` : '주자 없음';
    const noBall = scn.kind === 'choice' && (scn.setup === 'steal' || scn.setup === 'pickoff' || scn.setup === 'bunt');
    const eventSub =
      scn.kind === 'throw'
        ? '내가 잡는 공'
        : scn.setup === 'pickoff' || scn.setup === 'bunt'
          ? '투구 전 판단'
          : scn.setup === 'steal'
            ? '투구와 동시에 판단'
            : '다른 수비수가 잡는 공';
    // 전체 랜덤일 때만 포지션이 매번 바뀌니 알려준다
    const eyebrow = [
      this.randomLabel,
      this.randomLabel === '전체 랜덤' ? `내 포지션: ${FIELDER_NAME[scn.position]}` : null,
      scn.kind === 'throw' ? '송구 판단' : '위치 판단',
    ]
      .filter(Boolean)
      .join(' · ');
    this.briefing.innerHTML = `
      <div class="card">
        <div class="eyebrow">${eyebrow}</div>
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
            <div class="brief-label">${noBall ? '플레이' : '타격'}</div>
            <b class="brief-main">${scn.event}</b>
            <span class="brief-sub">${eventSub} · ${sit.batter === 'R' ? '우타자' : '좌타자'}</span>
          </section>
        </div>
        ${scn.brief ? `<p>${scn.brief}</p>` : ''}
        <p class="note">${
          scn.kind === 'throw'
            ? '타격 순간부터 선택지가 떠요. <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 키로 1루·2루·3루, <kbd>Space</kbd>로 홈, <kbd>W</kbd>로 들고 있기. 공을 잡기 전에 미리 눌러두면 잡자마자 던지고, 안 눌렀으면 잡는 순간 화면이 느려져요.'
            : '선택지가 미리 떠요. <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 키로 고르거나 갈 곳을 바라보고 클릭하세요. 판단할 순간까지 안 골랐으면 그때 화면이 느려져요.'
        }</p>
        <div class="actions">
          <button class="secondary" id="brief-menu-btn">목록</button>
          <button class="primary" id="start-btn"><kbd>Enter</kbd>시작</button>
        </div>
      </div>`;
    $('start-btn').addEventListener('click', () => this.onStart());
    $('brief-menu-btn').addEventListener('click', () => this.onMenu());
    this.briefing.classList.remove('hidden');
  }

  private hideAll() {
    for (const el of [this.menu, this.briefing, this.result]) el.classList.add('hidden');
    this.hideDecision();
    this.toasts.innerHTML = '';
    this.setPlaying(false);
  }

  hideOverlays() {
    this.hideAll();
    this.hud.classList.remove('hidden');
    this.setPlaying(true);
  }

  private setPlaying(on: boolean) {
    this.crosshair.classList.toggle('hidden', !on);
    this.help.classList.toggle('hidden', !on);
  }

  showReplayBanner(on: boolean) {
    this.replayBanner.classList.toggle('hidden', !on);
    if (on) this.setPlaying(false);
  }

  // ---------- 판단 ----------

  showDecision(title: string, defs: DecisionDef[], calls: string[] = []) {
    this.decisionTitle.textContent = title;
    // 동료의 콜: 안 밀리는 주자가 뛰는지 멈췄는지
    this.decisionCall.textContent = calls.join(' · ');
    this.decisionCall.classList.toggle('hidden', calls.length === 0);
    this.decisionButtons.innerHTML = '';
    this.buttons = defs.map((d) => {
      const b = document.createElement('button');
      b.innerHTML = `<kbd>${d.key}</kbd>${d.label}`;
      b.addEventListener('click', () => this.onChoose(d.value));
      this.decisionButtons.appendChild(b);
      return b;
    });
    this.tagRoot.innerHTML = '';
    this.tags = defs.map((d) => {
      const el = document.createElement('div');
      el.className = 'tag hidden';
      el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.onChoose(d.value);
      });
      this.tagRoot.appendChild(el);
      return el;
    });
    this.decision.classList.remove('hidden');
  }

  setDecisionTitle(title: string) {
    this.decisionTitle.textContent = title;
  }

  // 공을 잡기 전에 미리 고른 선택을 표시한다
  markPending(index: number) {
    this.buttons.forEach((b, i) => b.classList.toggle('pending', i === index));
    this.tags.forEach((t, i) => t.classList.toggle('pending', i === index));
  }

  hideDecision() {
    this.decision.classList.add('hidden');
    for (const el of this.tags) el.classList.add('hidden');
  }

  setDecisionTimer(frac: number) {
    this.decisionBar.style.transform = `scaleX(${Math.max(0, frac)})`;
  }

  updateTags(camera: THREE.PerspectiveCamera, defs: DecisionDef[] | null) {
    const v = new THREE.Vector3();
    const edgeTags: { el: HTMLElement; x: number; y: number }[] = [];
    this.tags.forEach((el, i) => {
      const d = defs?.[i];
      const visible = !!d && !!d.pos;
      el.classList.toggle('hidden', !visible);
      if (!visible) return;
      v.copy(d.pos!).setY(1.4).project(camera);
      // 카메라 뒤에 있으면 투영 결과가 뒤집히므로 되돌린다
      if (v.z > 1) v.multiplyScalar(-1);
      const onScreen = v.z <= 1 && Math.abs(v.x) <= 0.92 && Math.abs(v.y) <= 0.85;
      let x = v.x;
      let y = v.y;
      let arrow = '';
      if (!onScreen) {
        // 화면 밖이면 그 방향의 가장자리에 붙인다
        const k = Math.max(Math.abs(x) / 0.88, Math.abs(y) / 0.7);
        x /= k;
        y /= k;
        arrow = Math.abs(v.x) >= Math.abs(v.y) ? (v.x < 0 ? '◀ ' : ' ▶') : v.y > 0 ? ' ▲' : ' ▼';
      }
      el.classList.toggle('edge', !onScreen);
      const label = `<kbd>${d.key}</kbd>${d.short}`;
      el.innerHTML = arrow === '◀ ' ? arrow + label : label + arrow;
      const px = ((x + 1) / 2) * window.innerWidth;
      const py = ((1 - y) / 2) * window.innerHeight;
      if (onScreen) {
        el.style.left = `${px}px`;
        el.style.top = `${py}px`;
      } else edgeTags.push({ el, x: px, y: py });
    });
    // 가장자리 표시끼리 겹치면 아래로 밀어낸다
    edgeTags.sort((a, b) => a.y - b.y);
    edgeTags.forEach((cur, i) => {
      for (const prev of edgeTags.slice(0, i)) {
        if (Math.abs(cur.x - prev.x) < 160 && Math.abs(cur.y - prev.y) < 46) cur.y = prev.y + 46;
      }
    });
    for (const t of edgeTags) {
      t.el.style.left = `${t.x}px`;
      t.el.style.top = `${t.y}px`;
    }
  }

  toast(text: string, good: boolean) {
    const el = document.createElement('div');
    el.className = `toast ${good ? 'out' : 'safe'}`;
    el.textContent = text;
    this.toasts.appendChild(el);
  }

  // ---------- 결과 ----------

  private resultActions() {
    return `<div class="actions wrap">
      <button class="secondary" id="result-menu-btn">목록</button>
      <button class="secondary" id="replay-btn"><kbd>V</kbd>리플레이</button>
      <button class="secondary" id="retry-btn"><kbd>R</kbd>다시 하기</button>
      <button class="primary" id="next-btn"><kbd>N</kbd>다음 상황</button>
    </div>`;
  }

  private bindResultActions() {
    $('retry-btn').addEventListener('click', () => this.onRestart());
    $('replay-btn').addEventListener('click', () => this.onReplay());
    $('next-btn').addEventListener('click', () => this.onNext());
    $('result-menu-btn').addEventListener('click', () => this.onMenu());
  }

  private openResult(html: string) {
    this.hideAll();
    this.hud.classList.remove('hidden');
    this.result.innerHTML = `<div class="card">${html}${this.resultActions()}</div>`;
    this.bindResultActions();
    this.result.classList.remove('hidden');
  }

  showThrowResult(r: ThrowResultData) {
    const o = r.outcome;
    const scn = r.scenario;

    const timingRows = o.events.length
      ? o.events
          .map((e) => {
            const ballAt = e.ballTime + (e.tag ? 0.15 : 0);
            const diff = Math.abs(e.runnerTime - ballAt);
            return `<tr>
              <td>${BASE_LABEL[e.base]}</td>
              <td>${RUNNER_NAME[e.runner]}</td>
              <td>${sec(ballAt)}${e.tag ? ' (태그)' : ''}</td>
              <td>${sec(e.runnerTime)}</td>
              <td class="${e.out ? 'out' : 'safe'}">${e.out ? '아웃' : '세이프'} (${diff.toFixed(2)}초 ${e.out ? '먼저' : '늦게'})</td>
            </tr>`;
          })
          .join('')
      : `<tr><td colspan="5">${o.autoOuts ? '직선타로 타자는 잡자마자 아웃. ' : ''}송구로 노린 아웃이 없었어요.</td></tr>`;

    const v = r.verdict;
    const answerLabel = v.answers.map((c) => throwLabel(scn, c)).join(' 또는 ');
    const alts = r.alternatives
      .map((a) => {
        const chosen = a.choice === o.choice && !o.timedOut;
        const isAnswer = v.answers.includes(a.choice);
        return `<div class="alt ${chosen ? 'chosen' : ''}">
          <span class="alt-name">${throwLabel(scn, a.choice)}${chosen ? ' (내 선택)' : ''}${isAnswer ? '<span class="badge">정답</span>' : ''}</span>
          <span class="alt-res">${a.headline} · ${a.resultState}</span>
        </div>`;
      })
      .join('');

    // 판단 시간 안내 (실제 경기 속도 기준)
    const ideal = v.ideal;
    const notes: string[] = [];
    if (v.verdict === 'fallback') {
      notes.push(`정답은 <b>${answerLabel}</b>예요. 판단이 늦어서 그 시점에는 <b>${josa(throwLabel(scn, v.bestNow.choice), '이', '가')}</b> 가장 나은 선택이었어요.`);
    } else if (v.verdict === 'late') {
      notes.push(`<b>${josa(throwLabel(scn, o.choice), '은', '는')}</b> 정답이지만, 늦게 던져서 ${o.outsMade > 0 ? '노린 아웃을 다 잡지 못했어요' : '세이프가 됐어요'}.`);
    } else if (v.verdict !== 'ideal') {
      notes.push(`정답은 <b>${answerLabel}</b>예요.`);
    }
    if (ideal.outsMade > 0) {
      const w = latestDecision(scn, ideal.choice, ideal.outsMade);
      if (w !== null) notes.push(`<b>${josa(throwLabel(scn, ideal.choice), '으로', '로')}</b> ${ideal.outsMade + ideal.autoOuts >= 2 ? '병살을' : '아웃을'} 잡으려면 공을 잡고 <b>${sec(w)}</b> 안에 결정해야 해요.`);
    }
    const anyOut = Math.max(0, ...(['first', 'second', 'third', 'home'] as Choice[]).map((c) => latestDecision(scn, c, 1) ?? 0));
    if (anyOut > 0) notes.push(`<b>${sec(anyOut)}</b>가 지나면 어디로 던져도 아웃을 잡을 수 없어요.`);

    this.openResult(`
      <span class="grade ${v.grade}">${VERDICT_LABEL[v.verdict](v.grade)}</span>
      <h1>${o.headline}</h1>
      <div class="result-state">${o.timedOut ? '시간 안에 결정하지 못했어요 · ' : ''}${throwLabel(scn, o.choice)} → ${o.resultState}</div>
      <div class="stat-row">
        <div class="stat"><small>실제 경기 기준 판단 시간</small><b>${sec(o.decisionDelay)}</b></div>
        <div class="stat"><small>화면에서 고민한 시간 (슬로모션 ${r.timeScale}배)</small><b>${sec(r.reactionReal)}</b></div>
      </div>
      <p class="note">${notes.join('<br/>')}</p>
      <h2>타이밍 비교 (타격 순간부터)</h2>
      <div class="table-wrap"><table class="timing">
        <tr><th>베이스</th><th>주자</th><th>공 도착</th><th>주자 도착</th><th>판정</th></tr>
        ${timingRows}
      </table></div>
      <h2>내 판단 시간(${sec(o.decisionDelay)}) 그대로 다른 곳에 던졌다면</h2>
      ${alts}
      <h2>해설</h2>
      <p>${scn.explanation}</p>`);
  }

  showChoiceResult(r: ChoiceResultData) {
    const scn = r.scenario;
    const c = r.result;
    const correct = scn.options.find((o) => o.grade === 'best')!;
    let allowed: number | null = null;
    if (correct.takes && Number.isFinite(c.deadline)) {
      // 맞는 위치에 제때 도착하려면 몇 초 안에 움직이기 시작해야 하는지
      const travel = fieldersOf(scn)[scn.position].distanceTo(correct.moveTo) / RUN.fielderSpeed;
      allowed = c.deadline - r.decisionAt - RUN.reaction - travel;
    }

    const alts = scn.options
      .map((o, i) => {
        const chosen = i === c.index;
        return `<div class="alt col ${chosen ? 'chosen' : ''}">
          <span class="alt-name">${o.label}${chosen ? ' (내 선택)' : ''}<span class="badge ${o.grade}">${GRADE_SHORT[o.grade]}</span></span>
          <span class="alt-res">${o.feedback}</span>
        </div>`;
      })
      .join('');

    this.openResult(`
      <span class="grade ${c.grade}">${GRADE_LABEL[c.grade]}</span>
      <h1>${c.headline}</h1>
      <div class="result-state">${c.index === null ? '시간 안에 고르지 못했어요' : scn.options[c.index].label} → ${c.result}</div>
      <div class="stat-row">
        <div class="stat"><small>실제 경기 기준 판단 시간</small><b>${c.index === null ? '시간 초과' : sec(r.decisionDelay)}</b></div>
        <div class="stat"><small>화면에서 고민한 시간 (슬로모션 ${r.timeScale}배)</small><b>${sec(r.reactionReal)}</b></div>
      </div>
      <p class="note">${c.feedback}${allowed !== null && allowed > 0 ? `<br/>제때 도착하려면 <b>${sec(allowed)}</b> 안에 움직이기 시작해야 해요.` : ''}</p>
      <h2>선택지별 설명</h2>
      ${alts}
      <h2>해설</h2>
      <p>${scn.explanation}</p>`);
  }
}
