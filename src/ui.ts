import * as THREE from 'three';
import { DIFFICULTIES, type DifficultyId } from './config';
import { BASES, BASE_LABEL, type BaseId } from './coords';
import {
  FIELDER_NAME,
  RUNNER_NAME,
  latestDecision,
  type Choice,
  type Grade,
  type Outcome,
  type Scenario,
} from './scenario';

export interface ResultData {
  scenario: Scenario;
  outcome: Outcome;
  grade: Grade;
  best: Outcome;
  alternatives: Outcome[];
  reactionReal: number;
  timeScale: number;
}

const CHOICE_LABEL: Record<Choice, string> = {
  first: '1루 송구',
  second: '2루 송구',
  third: '3루 송구',
  home: '홈 송구',
  hold: '들고 있기',
};

const KEY: Record<BaseId, string> = { first: '1', second: '2', third: '3', home: '4' };

const GRADE_LABEL: Record<Grade, string> = {
  best: '최선의 판단',
  ok: '아웃은 잡았지만 더 좋은 선택이 있었어요',
  bad: '다시 생각해 봐요',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sec = (s: number) => `${s.toFixed(2)}초`;

export class UI {
  onChoose: (c: Choice) => void = () => {};
  onStart: (d: DifficultyId) => void = () => {};
  onRestart: () => void = () => {};
  onBriefing: () => void = () => {};

  private briefing = $('briefing');
  private result = $('result');
  private decision = $('decision');
  private decisionBar = $('decision-bar');
  private crosshair = $('crosshair');
  private help = $('help');
  private toasts = $('toasts');
  private tags = new Map<BaseId, HTMLElement>();
  private selected: DifficultyId = 'normal';

  constructor() {
    this.decision.querySelectorAll<HTMLButtonElement>('button[data-choice]').forEach((b) => {
      b.addEventListener('click', () => this.onChoose(b.dataset.choice as Choice));
    });
    const tagRoot = $('tags');
    for (const id of Object.keys(BASES) as BaseId[]) {
      const el = document.createElement('div');
      el.className = 'tag hidden';
      el.innerHTML = `<kbd>${KEY[id]}</kbd>${BASE_LABEL[id]}`;
      el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.onChoose(id);
      });
      tagRoot.appendChild(el);
      this.tags.set(id, el);
    }
  }

  setHud(scn: Scenario, kmh: number) {
    $('hud-title').textContent = `${FIELDER_NAME[scn.player]} 시점 · ${scn.title}`;
    document.querySelectorAll<HTMLElement>('.hud-outs i').forEach((el) => {
      el.classList.toggle('on', Number(el.dataset.out) < scn.outs);
    });
    document.querySelectorAll<SVGRectElement>('.hud-bases rect').forEach((el) => {
      el.classList.toggle('on', scn.runners[el.dataset.base as 'first' | 'second' | 'third']);
    });
    $('hud-speed').textContent = String(kmh);
  }

  showBriefing(scn: Scenario, difficulty: DifficultyId) {
    this.selected = difficulty;
    this.hideDecision();
    this.toasts.innerHTML = '';
    const runners = (['first', 'second', 'third'] as const).filter((b) => scn.runners[b]).map((b) => BASE_LABEL[b]);
    this.briefing.innerHTML = `
      <div class="card">
        <div class="eyebrow">내야 수비 판단 훈련 · ${FIELDER_NAME[scn.player]}</div>
        <h1>${scn.title}</h1>
        <div class="situation">
          <span class="chip">${scn.outs}아웃</span>
          <span class="chip">주자 ${runners.length ? runners.join(', ') : '없음'}</span>
          <span class="chip">내 포지션: ${FIELDER_NAME[scn.player]}</span>
        </div>
        <p>${scn.brief}</p>
        <h2>난이도 (공을 잡은 뒤 슬로모션 속도)</h2>
        <div class="difficulties">
          ${DIFFICULTIES.map(
            (d) => `<button data-diff="${d.id}" class="${d.id === difficulty ? 'selected' : ''}"><b>${d.label}</b><span>${d.desc}</span></button>`,
          ).join('')}
        </div>
        <h2>조작</h2>
        <p class="note">공을 잡으면 화면이 느려져요. 그 사이에도 주자는 계속 뛰니까 빨리 판단할수록 좋아요.<br/>
        숫자키 <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd>로 1루·2루·3루·홈, <kbd>Space</kbd>로 들고 있기. 던질 베이스를 바라보고 클릭해도 돼요.</p>
        <div class="actions">
          <button class="primary" id="start-btn"><kbd>Enter</kbd>시작</button>
        </div>
      </div>`;
    this.briefing.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) => {
      b.addEventListener('click', () => {
        this.selected = b.dataset.diff as DifficultyId;
        this.briefing.querySelectorAll('[data-diff]').forEach((x) => x.classList.toggle('selected', x === b));
      });
    });
    $('start-btn').addEventListener('click', () => this.onStart(this.selected));
    this.briefing.classList.remove('hidden');
    this.result.classList.add('hidden');
    this.setPlaying(false);
  }

  // 브리핑 화면에서 Enter로 시작할 때 고른 난이도를 쓰게 한다
  get selectedDifficulty() {
    return this.selected;
  }

  hideOverlays() {
    this.briefing.classList.add('hidden');
    this.result.classList.add('hidden');
    this.toasts.innerHTML = '';
    this.setPlaying(true);
  }

  private setPlaying(on: boolean) {
    this.crosshair.classList.toggle('hidden', !on);
    this.help.classList.toggle('hidden', !on);
  }

  showDecision() {
    this.decision.classList.remove('hidden');
  }

  hideDecision() {
    this.decision.classList.add('hidden');
    for (const el of this.tags.values()) el.classList.add('hidden');
  }

  setDecisionTimer(frac: number) {
    this.decisionBar.style.transform = `scaleX(${Math.max(0, frac)})`;
  }

  updateBaseTags(camera: THREE.PerspectiveCamera, visible: boolean) {
    const v = new THREE.Vector3();
    const edgeTags: { el: HTMLElement; x: number; y: number }[] = [];
    for (const [id, el] of this.tags) {
      el.classList.toggle('hidden', !visible);
      if (!visible) continue;
      v.copy(BASES[id]).setY(1.4).project(camera);
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
      const label = `<kbd>${KEY[id]}</kbd>${BASE_LABEL[id]}`;
      el.innerHTML = arrow === '◀ ' ? arrow + label : label + arrow;
      const px = ((x + 1) / 2) * window.innerWidth;
      const py = ((1 - y) / 2) * window.innerHeight;
      if (onScreen) {
        el.style.left = `${px}px`;
        el.style.top = `${py}px`;
      } else edgeTags.push({ el, x: px, y: py });
    }
    // 가장자리 표시끼리 겹치면 아래로 밀어낸다
    edgeTags.sort((a, b) => a.y - b.y);
    edgeTags.forEach((cur, i) => {
      for (const prev of edgeTags.slice(0, i)) {
        if (Math.abs(cur.x - prev.x) < 140 && Math.abs(cur.y - prev.y) < 46) cur.y = prev.y + 46;
      }
    });
    for (const t of edgeTags) {
      t.el.style.left = `${t.x}px`;
      t.el.style.top = `${t.y}px`;
    }
  }

  toast(text: string, out: boolean) {
    const el = document.createElement('div');
    el.className = `toast ${out ? 'out' : 'safe'}`;
    el.textContent = text;
    this.toasts.appendChild(el);
  }

  showResult(r: ResultData) {
    const o = r.outcome;
    this.hideDecision();
    this.setPlaying(false);

    const timingRows = o.events.length
      ? o.events
          .map((e) => {
            const diff = Math.abs(e.runnerTime - e.ballTime);
            return `<tr>
              <td>${BASE_LABEL[e.base]}</td>
              <td>${RUNNER_NAME[e.runner]}</td>
              <td>${sec(e.ballTime)}</td>
              <td>${sec(e.runnerTime)}</td>
              <td class="${e.out ? 'out' : 'safe'}">${e.out ? '아웃' : '세이프'} (${diff.toFixed(2)}초 ${e.out ? '먼저' : '늦게'})</td>
            </tr>`;
          })
          .join('')
      : `<tr><td colspan="5">아웃을 노린 송구가 없었어요.</td></tr>`;

    const alts = r.alternatives
      .map((a) => {
        const chosen = a.choice === o.choice && !o.timedOut;
        const isBest = a.value >= r.best.value && a.outsMade > 0;
        return `<div class="alt ${chosen ? 'chosen' : ''}">
          <span class="alt-name">${CHOICE_LABEL[a.choice]}${chosen ? ' (내 선택)' : ''}${isBest ? '<span class="badge">최선</span>' : ''}</span>
          <span class="alt-res">${a.headline} · ${a.resultState}</span>
        </div>`;
      })
      .join('');

    // 판단 시간 안내: 실제 속도 기준 게임 시간으로 비교한다
    const dpWindow = latestDecision(r.scenario, 'second', 2);
    const anyOutWindow = Math.max(
      ...(['first', 'second', 'third', 'home'] as Choice[]).map((c) => latestDecision(r.scenario, c, 1) ?? 0),
    );
    const notes: string[] = [];
    if (dpWindow !== null)
      notes.push(`병살은 공을 잡고 <b>${sec(dpWindow)}</b> 안에 2루로 던지기로 결정해야 가능해요.`);
    notes.push(`<b>${sec(anyOutWindow)}</b>가 지나면 어디로 던져도 아웃을 잡을 수 없어요.`);

    this.result.innerHTML = `
      <div class="card">
        <span class="grade ${r.grade}">${GRADE_LABEL[r.grade]}</span>
        <h1>${o.headline}</h1>
        <div class="result-state">${o.timedOut ? '시간 안에 결정하지 못했어요 · ' : ''}${CHOICE_LABEL[o.choice]} → ${o.resultState}</div>

        <div class="stat-row">
          <div class="stat"><small>실제 경기 기준 판단 시간</small><b>${sec(o.decisionDelay)}</b></div>
          <div class="stat"><small>화면에서 고민한 시간 (슬로모션 ${r.timeScale}배)</small><b>${sec(r.reactionReal)}</b></div>
        </div>
        <p class="note">${notes.join('<br/>')}</p>

        <h2>타이밍 비교 (타격 순간부터)</h2>
        <table class="timing">
          <tr><th>베이스</th><th>주자</th><th>공 도착</th><th>주자 도착</th><th>판정</th></tr>
          ${timingRows}
        </table>

        <h2>같은 판단 시간에 다른 선택을 했다면</h2>
        ${alts}

        <h2>해설</h2>
        <p>${r.scenario.explanation}</p>

        <div class="actions">
          <button class="secondary" id="brief-btn">난이도 바꾸기</button>
          <button class="primary" id="retry-btn"><kbd>R</kbd>다시 하기</button>
        </div>
      </div>`;
    $('retry-btn').addEventListener('click', () => this.onRestart());
    $('brief-btn').addEventListener('click', () => this.onBriefing());
    this.result.classList.remove('hidden');
  }
}
