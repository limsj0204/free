import { DIFFICULTIES, type DifficultyId } from './config';
import {
  getRecord,
  getRunHideBall,
  getRunIncludeGenerated,
  getRunSkipIntro,
  getSoundOn,
  getVolume,
  setRunHideBall,
  setRunIncludeGenerated,
  setRunSkipIntro,
  setSoundOn,
  setVolume,
} from './progress';
import { RUN_BASIC_CARDS } from './runBasics';
import { annotateRun } from './runGlossary';
import { RUN_PRINCIPLES } from './runPrinciples';
import { RUN_TAB_LABEL, kindLabel, tabOf, type RunTab } from './runner';
import { RUN_SCENARIOS, generatedRunScenarios } from './runScenarios';
import type { Grade } from './scenario';
import { sfx } from './sound';

// 주루 판단 시뮬레이터의 첫 화면(상황 목록)과 시작 화면(소개). 내야 수비 목록과 같은 모양: 왼쪽에 설정·조작법, 오른쪽에 종류별 탭.

const TABS: RunTab[] = ['fly', 'ground', 'hit', 'rare'];
const GRADE_SHORT: Record<Grade, string> = { best: '최선', ok: '아쉬움', bad: '오답' };

const TAB_DESC: Record<RunTab, string> = {
  fly: '공이 뜨는 순간 스타트·하프웨이·태그업 준비 중에 고르고, 잡히면 태그업할지 정해요.',
  ground: '땅볼에 진루할지 귀루할지 정해요. 포스(의무 진루)인지 먼저 생각하세요.',
  hit: '타자 주자는 앞에 보이는 공을 보고 2루까지 갈지 직접 정하고, 1루→3루·2루→홈은 화면에 뜨는 3루 코치 콜을 따라요.',
  rare: '직선타, 내야 뜬공, 폭투·패스트볼처럼 드물게 나오고 판단은 비교적 쉬운 상황이에요.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const LEVEL_LABEL = ['', '기초', '응용', '심화'];

// ---------- 기초 개념 ----------

// 포스·태그업·하프웨이 같은 기본 개념을 카드로 넘겨 본다. ←/→로 넘기고 Esc로 닫는다
export function showRunBasics(index = 0) {
  const el = $('basics');
  const n = RUN_BASIC_CARDS.length;
  let cur = index;
  const render = (i: number) => {
    const c = RUN_BASIC_CARDS[i];
    el.innerHTML = `
      <div class="card basics-card">
        <div class="eyebrow">기초 개념 · ${i + 1} / ${n}</div>
        <h1>${c.title}</h1>
        ${c.svg ? `<div class="basics-figure">${c.svg}</div>` : ''}
        <div class="basics-body">${c.body.map((p) => `<p>${p}</p>`).join('')}</div>
        <div class="basics-dots">${RUN_BASIC_CARDS.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
        <div class="actions">
          <button class="secondary" id="basics-prev" ${i === 0 ? 'disabled' : ''}>이전</button>
          ${i < n - 1 ? '<button class="primary" id="basics-next">다음 <kbd>→</kbd></button>' : '<button class="primary" id="basics-done">목록으로</button>'}
        </div>
        <button class="basics-close" id="basics-close" aria-label="닫기">✕</button>
      </div>`;
    $('basics-prev').addEventListener('click', () => go(i - 1));
    $('basics-next')?.addEventListener('click', () => go(i + 1));
    $('basics-done')?.addEventListener('click', close);
    $('basics-close').addEventListener('click', close);
    cur = i;
  };
  const go = (i: number) => {
    if (i < 0 || i >= n) return;
    sfx.click();
    render(i);
  };
  const close = () => {
    el.classList.add('hidden');
    document.removeEventListener('keydown', onKey, true);
  };
  // 창이 떠 있는 동안 키 입력은 게임으로 넘기지 않는다 (결과 화면의 Esc·R·N 등)
  const onKey = (e: KeyboardEvent) => {
    e.stopImmediatePropagation();
    if (e.code === 'ArrowRight' || e.code === 'Enter') {
      e.preventDefault();
      if (cur < n - 1) go(cur + 1);
      else close();
    } else if (e.code === 'ArrowLeft') go(cur - 1);
    else if (e.code === 'Escape') close();
  };
  render(index);
  document.addEventListener('keydown', onKey, true);
  el.classList.remove('hidden');
}

// 종류별 핵심 원칙 (기초 개념 카드와 같은 창을 쓴다)
export function showRunPrinciples(kind: RunTab) {
  const el = $('basics');
  el.innerHTML = `
    <div class="card basics-card">
      <div class="eyebrow">핵심 원칙</div>
      <h1>${RUN_TAB_LABEL[kind]}: 기억할 것</h1>
      <ul class="principles">${RUN_PRINCIPLES[kind].map((p) => `<li>${annotateRun(p)}</li>`).join('')}</ul>
      <p class="principles-note">팀 약속에 따라 다를 수 있어요. 기본 상황을 풀면서 왜 그런지 해설로 확인해 보세요.</p>
      <div class="actions"><button class="primary" id="principles-close">닫기</button></div>
      <button class="basics-close" id="principles-x" aria-label="닫기">✕</button>
    </div>`;
  const close = () => {
    el.classList.add('hidden');
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopImmediatePropagation();
    if (e.code === 'Escape' || e.code === 'Enter') {
      e.preventDefault();
      close();
    }
  };
  $('principles-close').addEventListener('click', close);
  $('principles-x').addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  el.classList.remove('hidden');
}

export class RunMenu {
  onPick: (id: string) => void = () => {};
  onRandom: (scope: RunTab | 'all') => void = () => {};
  onDifficulty: (d: DifficultyId) => void = () => {};
  private tab: RunTab = 'fly';
  private el = $('menu');
  private intro = $('intro');

  // 처음 들어오면 목록 위에 소개를 띄운다. 시작하기(또는 Enter)로 닫는다
  showIntro() {
    this.intro.innerHTML = `
      <div class="card intro-card">
        <div class="eyebrow">VR 야구 대비 · 주루</div>
        <h1>주루 판단 시뮬레이터</h1>
        <p class="intro-lead">SBO 대회를 준비하는 스트리머들의 주루 판단력에 도움을 주기 위한 시뮬레이터예요.</p>
        <ul class="intro-points">
          <li>주자가 되어 타구를 보고 <b>더 갈지, 멈출지, 베이스로 돌아갈지</b> 판단을 반복해서 연습해요.</li>
          <li>실제 VR 야구의 <b>주루 속도와 송구 속도</b>와는 다소 차이가 있을 수 있어요.</li>
          <li>결과와 해설은 하나의 기준이에요. 실제 경기에서는 <b>팀 약속과 상황</b>에 따라 달라질 수 있어요.</li>
        </ul>
        <button class="primary intro-start" id="intro-start">시작하기 <kbd>Enter</kbd></button>
        <button class="secondary intro-basics" id="intro-basics">야구 규칙이 낯설다면: 기초 개념 먼저 보기</button>
        <label class="intro-skip" for="intro-skip">
          <input type="checkbox" id="intro-skip" ${getRunSkipIntro() ? 'checked' : ''} />
          <span>다음부터 이 화면 건너뛰기</span>
        </label>
      </div>`;
    const close = () => {
      setRunSkipIntro($<HTMLInputElement>('intro-skip').checked);
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
    $('intro-basics').addEventListener('click', () => {
      close();
      showRunBasics();
    });
    document.addEventListener('keydown', onKey);
    this.intro.classList.remove('hidden');
  }

  show(difficulty: DifficultyId, tab?: RunTab) {
    if (tab) this.tab = tab;
    this.render(difficulty);
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
  }

  private render(difficulty: DifficultyId) {
    const done = (id: string) => getRecord(id)?.best === 'best';
    const tabs = TABS.map((k) => {
      const list = RUN_SCENARIOS.filter((s) => tabOf(s) === k);
      return `<button class="tab ${k === this.tab ? 'selected' : ''}" data-tab="${k}" id="tab-${k}">
        <b>${RUN_TAB_LABEL[k]}</b><span>${list.filter((s) => done(s.id)).length}/${list.length}</span></button>`;
    }).join('');
    const items = RUN_SCENARIOS.filter((s) => tabOf(s) === this.tab)
      .map((s) => {
        const rec = getRecord(s.id);
        const status = rec ? `<span class="status ${rec.best}">${GRADE_SHORT[rec.best]}</span>` : '<span class="status none">도전 전</span>';
        return `<button class="item" data-scenario="${s.id}" id="item-${s.id}">
          <span class="item-main"><b>${s.title}</b></span>
          <span class="item-side">${this.tab === 'hit' ? `<span class="kind">${kindLabel(s)}</span>` : ''}<span class="level lv${s.level ?? 2}">${LEVEL_LABEL[s.level ?? 2]}</span>${status}</span>
        </button>`;
      })
      .join('');
    const gen = generatedRunScenarios();
    const genCount = gen.filter((s) => tabOf(s) === this.tab).length;
    const basicCount = RUN_SCENARIOS.filter((s) => tabOf(s) === this.tab).length;
    const name = RUN_TAB_LABEL[this.tab];

    this.el.innerHTML = `
      <div class="card menu-card">
        <div class="menu-grid">
          <div class="menu-side">
            <div class="eyebrow">VR 야구 대비 · 주루</div>
            <h1>주루 판단 시뮬레이터</h1>
            <p class="note">주자가 되어 1인칭으로 뛰면서 판단해요. 같은 타구라도 <b>아웃 카운트</b>에 따라 답이 달라져요.</p>
            <h2>난이도 (판단 순간의 슬로모션)</h2>
            <div class="difficulties">
              ${DIFFICULTIES.map(
                (d) =>
                  `<button data-diff="${d.id}" id="diff-${d.id}" class="${d.id === difficulty ? 'selected' : ''}"><b>${d.label}</b><span>${d.timeScale}배${d.timeScale === 1 ? ' (실제 속도)' : ''}</span></button>`,
              ).join('')}
            </div>
            <div class="setting-row">
              <label class="gen-toggle" for="hide-ball">
                <input type="checkbox" id="hide-ball" ${getRunHideBall() ? 'checked' : ''} />
                <span>타구 숨기기 <small>어떤 타구가 나올지 모르는 상태로 시작하고, 공이 맞는 순간 공개해요. 전체 랜덤에도 똑같이 적용돼요.</small></span>
              </label>
            </div>
            <h2>조작법</h2>
            <div class="controls">
              <span><kbd>A</kbd></span><span>뒤로: 멈춘다 · 내가 있던 베이스로 돌아간다 (태그업 준비, 귀루)</span>
              <span><kbd>S</kbd></span><span>중간까지 나가 있기 · 하프웨이 (플라이일 때)</span>
              <span><kbd>D</kbd></span><span>앞으로: 간다 (2루까지, 코치 콜 돌려, 스타트, 태그업, 진루)</span>
              <span><kbd>좌클릭</kbd></span><span>바라보는 곳 고르기</span>
              <span><kbd>마우스</kbd></span><span>고개 돌리기 (화면을 클릭하면 마우스가 잠겨요)</span>
            </div>
            <p class="controls-note">선택지는 타격 순간부터 떠 있어서 미리 고를 수 있어요. 결과(세이프·아웃, 잡힘·떨어짐)에는 운이 섞이고, 판정은 판단 자체로 해요.</p>
            <button class="random-all" id="random-all"><b>전체 랜덤</b><span>모든 종류가 섞여서 나와요</span></button>
          </div>
          <div class="menu-main">
            <div class="tabs four" role="tablist">${tabs}</div>
            <div class="items">
              <p class="random-desc">${TAB_DESC[this.tab]}</p>
              ${items}
              <div class="random-row">
                <button class="primary" id="random-kind">${name} 랜덤 연습</button>
              </div>
              ${
                // 드문 상황은 자동 생성이 없다
                genCount
                  ? `<label class="gen-toggle" for="gen-toggle">
                <input type="checkbox" id="gen-toggle" ${getRunIncludeGenerated() ? 'checked' : ''} />
                <span>자동 생성 상황도 섞기 <small>(기본 ${basicCount}개 + 자동 생성 ${genCount}개 · 기본 상황을 다 해봤다면 켜 보세요)</small></span>
              </label>`
                  : ''
              }
            </div>
            <div class="channel-links">
              <button class="intro-link" id="intro-btn">ⓘ 소개</button>
              <button class="intro-link basics-link" id="basics-btn">📘 기초 개념</button>
              <button class="intro-link basics-link" id="principles-btn">📌 ${name} 핵심 원칙</button>
              <span class="update-note">틈날 때마다 업데이트하고 있어요.<br />조금씩 달라져도 놀라지 마세요.</span>
              <div class="sound-ctl">
                <label class="gen-toggle" for="sound-on">
                  <input type="checkbox" id="sound-on" ${getSoundOn() ? 'checked' : ''} />
                  <span>소리</span>
                </label>
                <input type="range" id="volume" min="0" max="1" step="0.05" value="${getVolume()}" aria-label="음량" ${getSoundOn() ? '' : 'disabled'} />
              </div>
            </div>
          </div>
        </div>
      </div>`;

    this.el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as RunTab;
        this.render(difficulty);
      }),
    );
    this.el.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) => b.addEventListener('click', () => this.onPick(b.dataset.scenario!)));
    this.el.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) =>
      b.addEventListener('click', () => {
        const d = b.dataset.diff as DifficultyId;
        this.onDifficulty(d);
        this.render(d);
      }),
    );
    $('random-kind').addEventListener('click', () => this.onRandom(this.tab));
    $('random-all').addEventListener('click', () => this.onRandom('all'));
    $('intro-btn').addEventListener('click', () => this.showIntro());
    $('basics-btn').addEventListener('click', () => showRunBasics());
    $('principles-btn').addEventListener('click', () => showRunPrinciples(this.tab));
    $<HTMLInputElement>('hide-ball').addEventListener('change', (e) => setRunHideBall((e.target as HTMLInputElement).checked));
    document.getElementById('gen-toggle')?.addEventListener('change', (e) => setRunIncludeGenerated((e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('sound-on').addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      setSoundOn(on);
      $<HTMLInputElement>('volume').disabled = !on;
      if (on) sfx.glove();
    });
    $<HTMLInputElement>('volume').addEventListener('change', (e) => {
      setVolume(Number((e.target as HTMLInputElement).value));
      sfx.bat();
    });
  }
}
