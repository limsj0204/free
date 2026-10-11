import * as THREE from 'three';
import { ACTION, DIFFICULTIES, RUN, VALUE, type DifficultyId } from './config';
import { BASES, BASE_LABEL, P, type BaseId } from './coords';
import { BUNT_RULE, josa } from './explain';
import { generatedFor } from './generated';
import {
  getHideBall,
  getIncludeGenerated,
  getMode,
  getRecord,
  getSkipIntro,
  getSoundOn,
  getVolume,
  setHideBall,
  setIncludeGenerated,
  setSkipIntro,
  setSoundOn,
  setVolume,
} from './progress';
import { sfx } from './sound';
import {
  FIELDER_NAME,
  POSITIONS,
  RUNNER_NAME,
  isCarry,
  planRunners,
  playMargin,
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
import { fieldersOf, scenariosFor } from './scenarios';
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
  fallback: () => '최선은 아니지만, 늦은 시점에선 가장 나은 선택',
  other: (g) => (g === 'ok' ? '아웃은 잡았지만 최선은 아니에요' : '다시 생각해 봐요'),
  timeout: () => '시간 안에 결정하지 못했어요',
  miss: () => '포구 실패',
  follow: () => '밟은 건 맞았지만 이어 던진 곳이 아쉬워요',
};

const GRADE_SHORT: Record<Grade, string> = { best: '최선', ok: '아쉬움', bad: '오답' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sec = (s: number) => `${s.toFixed(2)}초`;

function throwLabel(scn: ThrowScenario, c: Choice) {
  if (c === 'hold') return '던지지 못함';
  const tag = isTagBase(scn, c);
  if (isCarry(scn, c)) return `${BASE_LABEL[c]} ${tag ? '주자 직접 태그' : '직접 밟기'}`;
  return `${BASE_LABEL[c]} 송구${tag ? ' (태그 플레이)' : ''}`;
}

// 공이 주자보다 얼마나 먼저/늦게 도착하는지
function marginText(m: number) {
  if (m < 0) return `주자보다 <b>${(-m).toFixed(2)}초</b> 늦음`;
  return `주자보다 <b>${m.toFixed(2)}초</b> 먼저${m < VALUE.closeMargin ? ' (아슬아슬)' : ''}`;
}

// 직접 밟은 뒤 이어 던진 곳까지 붙인 이름 (예: 3루 직접 밟기 → 2루)
function planLabel(scn: ThrowScenario, o: Outcome) {
  const f = o.follow && o.follow !== 'hold' ? ` → ${BASE_LABEL[o.follow as BaseId]}` : o.follow === 'hold' && !o.followAuto ? ' → 던지지 못함' : '';
  return throwLabel(scn, o.choice) + f;
}

// 최선은 하나일 때만 '최선', 여러 개가 같이 인정되면 '좋은 판단'
const bestWord = (n: number) => (n > 1 ? '좋은 판단' : '최선');
const badge = (n: number) => `<span class="badge">${bestWord(n)}</span>`;
function bestSentence(labels: string[]) {
  if (labels.length <= 1) return `최선은 <b>${labels[0] ?? ''}</b>예요.`;
  return `<b>${labels.join(', ')}</b> ${labels.length === 2 ? '둘' : labels.length === 3 ? '셋' : '모두'} 다 좋은 판단이에요.`;
}

// 그 베이스로 오는 주자가 포스 상태가 아니라서 태그해야 하는가
function isTagBase(scn: ThrowScenario, c: Choice) {
  return planRunners(scn).some((r) => r.kind === 'advance' && r.target === c);
}

// 액션 모드 기록은 판단 모드 기록과 따로 저장한다
export function recordId(id: string) {
  return getMode() === 'action' ? `a:${id}` : id;
}

// 타구 숨기기 설정이 켜져 있으면 타격 전까지 타구를 가린다. 투구 전에 판단하는 상황은 원래 보이는 정보라 가리지 않는다.
export function ballHidden(scn: Scenario) {
  if (!getHideBall()) return false;
  return !(scn.kind === 'choice' && (scn.setup === 'pickoff' || scn.setup === 'bunt'));
}

// 수비 위치를 짧게 설명한다 (타구를 숨겼을 때 브리핑에 대신 보여준다)
function defenseLabel(scn: Scenario) {
  const f = scn.fielders ?? {};
  const near = (id: keyof typeof f, x: number, z: number) => !!f[id] && f[id]!.distanceTo(P(x, z)) < 0.6;
  const parts: string[] = [];
  if (near('SS', -9, 34)) parts.push('병살 대형');
  else if (near('3B', -14.5, 18.5) || near('SS', -7, 26.5)) parts.push('전진 수비');
  else parts.push('보통 수비');
  if (near('1B', 20.2, 18.4)) parts.push('1루수는 주자 견제 위치');
  return parts.join(' · ');
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
  onMode: (m: 'judge' | 'action') => void = () => {};
  randomLabel: string | null = null; // 랜덤 연습 중이면 "유격수 랜덤" 같은 이름

  private menu = $('menu');
  private intro = $('intro');
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
    $('hud-title').textContent = ballHidden(scn) ? '타구 대기' : scn.event;
    document.querySelectorAll<HTMLElement>('.hud-outs i').forEach((el) => {
      el.classList.toggle('on', Number(el.dataset.out) < scn.situation.outs);
    });
    document.querySelectorAll<SVGRectElement>('.hud-bases rect').forEach((el) => {
      el.classList.toggle('on', scn.situation.runners[el.dataset.base as 'first' | 'second' | 'third']);
    });
    $('hud-batter').textContent = scn.situation.batter === 'R' ? '우타' : '좌타';
    $('hud-speed').textContent = String(kmh);
  }

  // ---------- 시작 화면 ----------

  // 처음 들어오면 목록 위에 소개를 띄운다. 시작하기(또는 Enter)로 닫는다
  showIntro() {
    this.intro.innerHTML = `
      <div class="card intro-card">
        <div class="eyebrow">VR 야구 대비 · 내야 수비</div>
        <h1>내야 수비 시뮬레이터</h1>
        <p class="intro-lead">SBO 대회를 준비하는 스트리머들의 수비 판단력에 도움을 주기 위한 시뮬레이터예요.</p>
        <ul class="intro-points">
          <li>타구와 주자 상황을 보고 <b>어디로 던지고, 어디로 움직일지</b> 판단을 반복해서 연습해요.</li>
          <li>실제 VR 야구의 <b>이동 속도와 송구 속도</b>와는 다소 차이가 있을 수 있어요.</li>
          <li>결과와 해설은 하나의 기준이에요. 실제 경기에서는 <b>팀 약속과 상황</b>에 따라 달라질 수 있어요.</li>
        </ul>
        <button class="primary intro-start" id="intro-start">시작하기 <kbd>Enter</kbd></button>
        <label class="intro-skip" for="intro-skip">
          <input type="checkbox" id="intro-skip" ${getSkipIntro() ? 'checked' : ''} />
          <span>다음부터 이 화면 건너뛰기</span>
        </label>
        <div class="channel-links intro-channels">
          <a class="channel soop" href="https://www.sooplive.com/station/yangdoki" target="_blank" rel="noopener noreferrer"><b>SOOP</b>양도끼 방송국</a>
          <a class="channel youtube" href="https://www.youtube.com/@%EC%96%91%EB%8F%84%EB%81%BC" target="_blank" rel="noopener noreferrer"><b>YouTube</b>양도끼</a>
        </div>
      </div>`;
    const close = () => {
      setSkipIntro($<HTMLInputElement>('intro-skip').checked);
      this.intro.classList.add('hidden');
      document.removeEventListener('keydown', onKey);
      sfx.click();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        close();
      }
    };
    $('intro-start').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    this.intro.classList.remove('hidden');
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
    const done = (id: string) => getRecord(recordId(id))?.best === 'best';
    const mode = getMode();
    const tabs = POSITIONS.map((p) => {
      const list = scenariosFor(p);
      const n = list.filter((s) => done(s.id)).length;
      return `<button class="tab ${p === this.tab ? 'selected' : ''}" data-tab="${p}" id="tab-${p}">
        <b>${FIELDER_NAME[p]}</b><span>${n}/${list.length}</span></button>`;
    }).join('');

    const items = scenariosFor(this.tab)
      .map((s) => {
        const rec = getRecord(recordId(s.id));
        const status = rec ? `<span class="status ${rec.best}">${GRADE_SHORT[rec.best]}</span>` : '<span class="status none">도전 전</span>';
        return `<button class="item" data-scenario="${s.id}" id="item-${s.id}">
          <span class="item-main">
            <b>${s.title}</b>
          </span>
          <span class="item-side">
            <span class="kind">${s.kind === 'throw' ? '송구 판단' : '위치 판단'}</span>
            ${status}
          </span>
        </button>`;
      })
      .join('');

    // 조작법: 지금 고른 모드 기준으로 보여준다
    const controls =
      mode === 'action'
        ? `<div class="controls">
            <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>이동. 공이 지나가는 길로 가면 자동으로 잡혀요</span>
            <span><kbd>마우스</kbd></span><span>시점 돌리기 (화면을 클릭하면 마우스가 잠겨요)</span>
            <span><kbd>좌클릭</kbd></span><span>조준한 베이스로 송구</span>
            <span><b class="ctl-label">밟기·태그</b></span><span>공을 든 채 포스 베이스를 밟거나 뛰는 주자에게 다가가 직접 아웃. 밟은 뒤 조준·좌클릭으로 이어 던지기</span>
            <span><b class="ctl-label">위치 판단</b></span><span>갈 곳까지 직접 뛰어가기</span>
          </div>`
        : `<div class="controls">
            <span><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>1루 · 2루 · 3루로 송구 (위치 판단도 1루·2루·3루로 가는 선택은 같은 키)</span>
            <span><b class="ctl-label">직접 밟기</b></span><span>베이스가 가까우면 같은 키로 직접 밟고, 밟은 다음 이어 던질 곳을 한 번 더 골라요</span>
            <span><kbd>Space</kbd></span><span>홈으로 송구</span>
            <span><kbd>좌클릭</kbd></span><span>바라보는 베이스로 송구 · 바라보는 선택지 고르기</span>
            <span><kbd>마우스</kbd></span><span>시점 돌리기 (화면을 클릭하면 마우스가 잠겨요)</span>
          </div>
          <p class="controls-note">선택지는 타격 순간부터 떠 있어서 공을 잡기 전에 미리 고를 수 있어요.<br />송구는 A·S·D 키와 좌클릭 모두로 할 수 있어요.</p>`;

    this.menu.innerHTML = `
      <div class="card menu-card">
        <div class="menu-grid">
          <div class="menu-side">
            <div class="eyebrow">VR 야구 대비 · 내야 수비</div>
            <h1>내야 수비 시뮬레이터</h1>
            <p class="note">처음엔 <b>판단 모드</b>로 판단부터 익히는 걸 추천해요. 수비에 자신이 생기면 <b>액션 모드</b>도 해 보세요.</p>
            <div class="modes">
              <button class="${mode === 'judge' ? 'selected' : ''}" data-mode="judge" id="mode-judge"><b>판단 모드</b><span>키보드·클릭으로 던질 곳, 갈 곳 고르기 (권장)</span></button>
              <button class="${mode === 'action' ? 'selected' : ''}" data-mode="action" id="mode-action"><b>액션 모드</b><span>WASD로 직접 움직여 잡고, 좌클릭으로 송구 (심화)</span></button>
            </div>
            <h2>${mode === 'action' ? '난이도 (플레이 전체 속도)' : '난이도 (판단 순간의 슬로모션)'}</h2>
            <div class="difficulties">
              ${DIFFICULTIES.map(
                (d) =>
                  `<button data-diff="${d.id}" id="diff-${d.id}" class="${d.id === difficulty ? 'selected' : ''}"><b>${d.label}</b><span>${
                    mode === 'action' ? `전체 ${ACTION.speeds[d.id]}배 속도` : `${d.timeScale}배${d.timeScale === 1 ? ' (실제 속도)' : ''}`
                  }</span></button>`,
              ).join('')}
            </div>
            <div class="setting-row">
              <label class="gen-toggle" for="hide-ball">
                <input type="checkbox" id="hide-ball" ${getHideBall() ? 'checked' : ''} />
                <span>타구 숨기기 <small>어떤 타구가 날아올지 모르는 상태로 시작해요.</small></span>
              </label>
              <div class="sound-ctl">
                <label class="gen-toggle" for="sound-on">
                  <input type="checkbox" id="sound-on" ${getSoundOn() ? 'checked' : ''} />
                  <span>소리</span>
                </label>
                <input type="range" id="volume" min="0" max="1" step="0.05" value="${getVolume()}" aria-label="음량" ${getSoundOn() ? '' : 'disabled'} />
              </div>
            </div>
            <h2>조작법</h2>
            ${controls}
          </div>
          <div class="menu-main">
            <div class="tabs" role="tablist">${tabs}</div>
            <div class="items">
              ${items}
              <div class="random-row">
                <button class="primary" id="random-pos">${FIELDER_NAME[this.tab]} 랜덤 연습</button>
                <span class="random-desc">${FIELDER_NAME[this.tab]} 상황이 무작위로 계속 나와요. 결과 화면에서 <kbd>N</kbd>을 누르면 다음 상황으로 넘어가요.</span>
              </div>
              <label class="gen-toggle" for="gen-toggle">
                <input type="checkbox" id="gen-toggle" ${getIncludeGenerated() ? 'checked' : ''} />
                <span>자동 생성 상황도 섞기 <small>(위의 기본 상황 ${scenariosFor(this.tab).length}개 + 자동 생성 ${generatedFor(this.tab).length}개 · 같은 타구라도 아웃 카운트, 주자, 주자 움직임이 다른 상황)</small></span>
              </label>
            </div>
            <div class="channel-links">
              <button class="intro-link" id="intro-btn">ⓘ 소개</button>
              <a class="channel soop" href="https://www.sooplive.com/station/yangdoki" target="_blank" rel="noopener noreferrer"><b>SOOP</b>양도끼 방송국</a>
              <a class="channel youtube" href="https://www.youtube.com/@%EC%96%91%EB%8F%84%EB%81%BC" target="_blank" rel="noopener noreferrer"><b>YouTube</b>양도끼</a>
            </div>
          </div>
        </div>
      </div>`;

    this.menu.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as PositionId;
        this.renderMenu(difficulty);
      }),
    );
    $<HTMLInputElement>('gen-toggle').addEventListener('change', (e) => setIncludeGenerated((e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('hide-ball').addEventListener('change', (e) => setHideBall((e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('sound-on').addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      setSoundOn(on);
      $<HTMLInputElement>('volume').disabled = !on;
      if (on) sfx.glove();
    });
    // 음량을 바꾸면 바로 들어볼 수 있게 짧게 소리를 낸다
    $<HTMLInputElement>('volume').addEventListener('change', (e) => {
      setVolume(Number((e.target as HTMLInputElement).value));
      sfx.bat();
    });
    this.menu.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        this.onMode(b.dataset.mode as 'judge' | 'action');
        this.renderMenu(difficulty);
      }),
    );
    $('random-pos').addEventListener('click', () => this.onRandom(this.tab));
    $('intro-btn').addEventListener('click', () => this.showIntro());
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
    const hidden = ballHidden(scn);
    const action = getMode() === 'action';
    this.help.textContent = action
      ? 'WASD: 이동 · 마우스: 시점 (안 잠겼으면 우클릭 드래그) · 좌클릭: 조준한 베이스로 송구 · 공을 든 채 포스 베이스를 밟거나 주자에게 다가가 태그 · Esc: 마우스 풀기'
      : hidden
      ? '마우스: 시점 이동 · 클릭: 바라보는 곳 선택 · A/S/D, Space: 선택지 · Esc: 마우스 풀기'
      : scn.kind === 'throw'
        ? '마우스: 시점 이동 · 클릭: 바라보는 베이스로 송구 · A/S/D: 1루/2루/3루 · Space: 홈 · Esc: 마우스 풀기'
        : '마우스: 시점 이동 · 클릭: 바라보는 위치로 이동 · A/S/D: 선택지 (1루·2루·3루로 가는 선택은 송구와 같은 키) · Esc: 마우스 풀기';
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
      // 타구를 숨기면 공이 나에게 오는지도 알 수 없어야 한다
      hidden ? '타구 숨김' : scn.kind === 'throw' ? '송구 판단' : '위치 판단',
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
            <div class="brief-label">${hidden ? '타격' : noBall ? '플레이' : '타격'}</div>
            <b class="brief-main ${hidden ? 'hidden-ball' : ''}">${hidden ? '?' : scn.event}</b>
            <span class="brief-sub">${hidden ? '공이 맞는 순간 공개돼요' : eventSub} · ${sit.batter === 'R' ? '우타자' : '좌타자'}</span>
          </section>
        </div>
        ${hidden ? `<p>수비 위치: ${defenseLabel(scn)}</p>` : scn.brief ? `<p>${scn.brief}</p>` : ''}
        <p class="note">${
          action
            ? scn.kind === 'choice'
              ? '액션 모드: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>로 움직여 갈 곳까지 직접 뛰어가세요. 공(송구)이 그곳에 가는 순간의 위치로 판정해요.'
              : '액션 모드: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>로 움직여 공이 지나가는 길로 가면 자동으로 잡혀요. 잡은 뒤 던질 베이스를 조준하고 좌클릭하거나, 공을 든 채 직접 아웃을 잡으세요. 포스 상황이면 베이스를 밟고, 아니면 뛰는 주자에게 다가가 태그해야 해요.'
            : hidden
            ? '타격 순간 타구가 공개되고 선택지가 떠요. 공이 나에게 오면 <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>로 1루·2루·3루, <kbd>Space</kbd>로 홈. 다른 수비수에게 가면 <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>로 갈 곳을 골라요. 미리 고르면 그 순간 바로 실행돼요.'
            : scn.kind === 'throw'
            ? '타격 순간부터 선택지가 떠요. <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 키로 1루·2루·3루, <kbd>Space</kbd>로 홈. 공을 잡기 전에 미리 눌러두면 잡자마자 던지고, 안 눌렀으면 잡는 순간 화면이 느려져요.'
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

  showDecision(title: string, defs: DecisionDef[], calls: string[] = [], buttons = true) {
    this.decisionTitle.textContent = title;
    // 동료의 콜: 안 밀리는 주자가 뛰는지 멈췄는지
    this.decisionCall.textContent = calls.join(' · ');
    this.decisionCall.classList.toggle('hidden', calls.length === 0);
    this.decisionButtons.innerHTML = '';
    this.decisionButtons.classList.toggle('hidden', !buttons);
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
      // 액션 모드(버튼 없음)에서는 표시를 눌러 고르지 않고 조준해서 던진다
      if (!buttons) el.style.pointerEvents = 'none';
      // pointerdown은 마우스 클릭과 휴대폰 터치 모두에서 바로 온다
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onChoose(d.value);
      });
      this.tagRoot.appendChild(el);
      return el;
    });
    this.decision.classList.remove('hidden');
  }

  // 공이 맞는 순간 상황판에 타구를 공개한다
  revealHud(scn: Scenario) {
    $('hud-title').textContent = scn.event;
  }

  setDecisionTitle(title: string) {
    this.decisionTitle.textContent = title;
  }

  // 액션 모드: 조준 중인 베이스를 표시한다
  setAim(index: number) {
    this.tags.forEach((t, i) => t.classList.toggle('pending', i === index));
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
      const behind = v.z > 1;
      if (behind) {
        v.multiplyScalar(-1);
        // 바로 등 뒤(투수에게 2루)면 방향이 안 잡히니, 돌아볼 쪽 가장자리에 붙인다 (아래는 결정 패널에 가린다)
        if (Math.hypot(v.x, v.y) < 0.3) v.set(v.x > 0 ? 1 : -1, 0, v.z);
      }
      const onScreen = !behind && Math.abs(v.x) <= 0.92 && Math.abs(v.y) <= 0.85;
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
      const label = d.key ? `<kbd>${d.key}</kbd>${d.short}` : d.short;
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

  // 결과 화면: 왼쪽에 판정과 타이밍, 오른쪽에 해설과 버튼 (넓은 화면에서 스크롤 없이 보이게)
  private openResult(main: string, side: string) {
    this.hideAll();
    this.hud.classList.remove('hidden');
    this.result.innerHTML = `<div class="card result-card"><div class="result-grid">
      <div class="result-main">${main}</div>
      <div class="result-side">${side}${this.resultActions()}</div>
    </div></div>`;
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
    const answerSentence = bestSentence(v.answers.map((c) => throwLabel(scn, c)));
    const alts = r.alternatives
      .map((a) => {
        // 밟은 뒤 이어 던진 곳이 다르면 같은 선택이 아니다
        const chosen = a.choice === o.choice && !o.timedOut && (o.follow === undefined || o.followAuto || a.follow === o.follow);
        const isAnswer = v.answers.includes(a.choice);
        return `<div class="alt ${chosen ? 'chosen' : ''}">
          <span class="alt-name">${planLabel(scn, a)}${chosen ? ' (내 선택)' : ''}${isAnswer ? badge(v.answers.length) : ''}</span>
          <span class="alt-res">${a.headline} · ${a.resultState}</span>
        </div>`;
      })
      .join('');

    // 판단 기준: 잡자마자 던졌을 때 베이스마다 공이 주자보다 얼마나 먼저 도착하는지
    const basis = v.immediate
      .filter((a) => a.choice !== 'hold' && a.events.length)
      .map((a) => {
        const m = playMargin(a)!;
        return `<div class="alt">
          <span class="alt-name">${planLabel(scn, a)}${v.answers.includes(a.choice) ? badge(v.answers.length) : ''}</span>
          <span class="alt-res">${marginText(m)} · ${a.resultState}</span>
        </div>`;
      })
      .join('');

    // 직접 밟은 뒤 이어 던질 곳: 내가 밟았거나 최선이 밟기면 보여준다
    const followChoice = o.follow !== undefined && !o.followAuto ? o.choice : v.follows[v.ideal.choice] ? v.ideal.choice : null;
    const fa = followChoice ? v.follows[followChoice] : undefined;
    const followBlock = fa
      ? fa.options
          .map((f) => {
            const to = f.follow ?? 'hold';
            const mine = o.choice === followChoice && o.follow === to && !o.followAuto;
            return `<div class="alt ${mine ? 'chosen' : ''}">
              <span class="alt-name">${to === 'hold' ? '던지지 않기' : `${josa(BASE_LABEL[to as BaseId], '으로', '로')} 송구`}${mine ? ' (내 선택)' : ''}${fa.best.includes(to) ? badge(fa.best.length) : ''}</span>
              <span class="alt-res">${f.headline} · ${f.resultState}</span>
            </div>`;
          })
          .join('')
      : '';

    // 판단 시간 안내 (실제 경기 속도 기준)
    const ideal = v.ideal;
    const notes: string[] = [];
    if (v.verdict === 'fallback') {
      notes.push(`${answerSentence} 판단이 늦어서 그 시점에는 <b>${josa(throwLabel(scn, v.bestNow.choice), '이', '가')}</b> 가장 나은 선택이었어요.`);
    } else if (v.verdict === 'late') {
      notes.push(`<b>${josa(throwLabel(scn, o.choice), '이', '가')}</b> ${bestWord(v.answers.length)}이었지만, 늦게 던져서 ${o.outsMade > 0 ? '노린 아웃을 다 잡지 못했어요' : '세이프가 됐어요'}.`);
    } else if (v.verdict === 'follow') {
      const best = fa!.best.filter((c) => c !== 'hold').map((c) => BASE_LABEL[c as BaseId]);
      notes.push(`<b>${josa(throwLabel(scn, o.choice), '은', '는')}</b> ${bestWord(v.answers.length)}이에요. 다만 밟은 다음에는 <b>${best.join(' 또는 ')}</b>${best.length ? '로' : ''} 이어 던지는 게 더 좋아요.`);
    } else if (v.verdict === 'miss') {
      notes.push(`공이 지나가는 길목으로 미리 움직여야 잡을 수 있어요. 잡았다면 ${answerSentence}`);
    } else if (v.verdict !== 'ideal') {
      notes.push(answerSentence);
    }
    if (ideal.outsMade > 0) {
      const w = latestDecision(scn, ideal.choice, ideal.outsMade);
      if (w !== null) notes.push(`<b>${josa(throwLabel(scn, ideal.choice), '으로', '로')}</b> ${ideal.outsMade + ideal.autoOuts >= 2 ? '병살을' : '아웃을'} 잡으려면 공을 잡고 <b>${sec(w)}</b> 안에 결정해야 해요.`);
    }
    if (v.close) {
      const { lead, safe, margin } = v.close;
      notes.push(
        `<b>${josa(throwLabel(scn, lead.choice), '은', '는')}</b> 잡자마자 던져도 여유가 <b>${sec(margin)}</b>뿐이라 아슬아슬해요. 그래서 <b>${throwLabel(scn, safe.choice)}</b>도 좋은 판단이에요. ` +
          `(${throwLabel(scn, lead.choice)}: ${lead.resultState} / ${throwLabel(scn, safe.choice)}: ${safe.resultState})`,
      );
    }
    for (const g of o.segments) {
      if (!g.waited) continue;
      const base = (Object.keys(BASES) as BaseId[]).find((b) => BASES[b].distanceTo(g.to.clone().setY(0)) < 1);
      if (base) notes.push(`${BASE_LABEL[base]} 커버가 늦게 들어와서 <b>${sec(g.waited)}</b> 기다렸다 던졌어요.`);
    }
    const anyOut = Math.max(0, ...(['first', 'second', 'third', 'home'] as Choice[]).map((c) => latestDecision(scn, c, 1) ?? 0));
    if (anyOut > 0) notes.push(`<b>${sec(anyOut)}</b>가 지나면 어디로 던져도 아웃을 잡을 수 없어요.`);

    this.openResult(`
      <span class="grade ${v.grade}">${VERDICT_LABEL[v.verdict](v.grade)}</span>
      <h1>${o.headline}</h1>
      <div class="result-state">${v.verdict === 'miss' ? '공을 놓쳤어요' : `${o.timedOut ? '시간 안에 결정하지 못했어요 · ' : ''}${o.events.some((e) => e.at) ? `${josa(BASE_LABEL[o.choice as BaseId], '으로', '로')} 뛰는 주자 직접 태그` : o.segments.some((g) => g.carry) && o.choice !== 'hold' ? `${BASE_LABEL[o.choice]} ${isTagBase(scn, o.choice) ? '주자 직접 태그' : '직접 밟기'}${o.follow && o.follow !== 'hold' ? ` → ${BASE_LABEL[o.follow as BaseId]} 송구` : o.follow === 'hold' && !o.followAuto ? ' → 이어 던지지 못함' : ''}` : throwLabel(scn, o.choice)}`} → ${o.resultState}</div>
      <div class="stat-row">
        ${
          v.verdict === 'miss'
            ? ''
            : `<div class="stat"><small>${getMode() === 'action' ? '잡고 나서 던지기까지 (실제 경기 기준)' : '실제 경기 기준 판단 시간'}</small><b>${sec(o.decisionDelay)}</b></div>
        <div class="stat"><small>${getMode() === 'action' ? `실제로 걸린 시간 (게임 속도 ${r.timeScale}배)` : `화면에서 고민한 시간 (슬로모션 ${r.timeScale}배)`}</small><b>${sec(r.reactionReal)}</b></div>`
        }
      </div>
      <p class="note">${notes.join('<br/>')}</p>
      <h2>타이밍 비교 (타격 순간부터)</h2>
      <div class="table-wrap"><table class="timing">
        <tr><th>베이스</th><th>주자</th><th>공 도착</th><th>주자 도착</th><th>판정</th></tr>
        ${timingRows}
      </table></div>
      <h2>내 판단 시간(${sec(o.decisionDelay)}) 그대로 다른 곳에 던졌다면</h2>
      ${alts}`, `
      <h2>해설</h2>
      <p class="explain">${scn.batted.type === 'bunt' && !scn.generated ? `${BUNT_RULE} ` : ''}${scn.explanation}</p>
      ${basis ? `<h2>판단 기준: 잡자마자 던졌다면</h2>${basis}` : ''}
      ${followBlock ? `<h2>${throwLabel(scn, followChoice!)} 다음 어디로? (밟자마자 던졌다면)</h2>${followBlock}` : ''}`);
  }

  showChoiceResult(r: ChoiceResultData) {
    const scn = r.scenario;
    const c = r.result;
    const correct = scn.options.find((o) => o.grade === 'best')!;
    let allowed: number | null = null;
    let lastAllowed: number | null = null;
    if (correct.takes && Number.isFinite(c.deadline)) {
      // 맞는 위치에 제때 도착하려면 몇 초 안에 움직이기 시작해야 하는지
      const travel = fieldersOf(scn)[scn.position].distanceTo(correct.moveTo) / RUN.fielderSpeed;
      allowed = c.deadline - r.decisionAt - RUN.reaction - travel;
      if (c.lastChance !== undefined) lastAllowed = c.lastChance - r.decisionAt - RUN.reaction - travel;
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
      <p class="note">${c.feedback}${allowed !== null && allowed > 0 ? `<br/>제때 도착하려면 <b>${sec(allowed)}</b> 안에 움직이기 시작해야 해요.` : ''}${lastAllowed !== null && allowed !== null && lastAllowed > allowed ? ` 늦어도 <b>${sec(lastAllowed)}</b> 안에 출발하면 기다렸다 던져 줘서 아웃은 돼요.` : ''}</p>
      <h2>선택지별 설명</h2>
      ${alts}`, `
      <h2>해설</h2>
      <p class="explain">${scn.explanation}</p>`);
  }
}
