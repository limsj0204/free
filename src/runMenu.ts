import { DIFFICULTIES, type DifficultyId } from './config';
import { getIncludeGenerated, getRecord, getRunHideBall, getSoundOn, getVolume, setIncludeGenerated, setRunHideBall, setSoundOn, setVolume } from './progress';
import { RUN_KIND_LABEL, type RunKind } from './runner';
import { RUN_SCENARIOS, generatedRunScenarios } from './runScenarios';
import type { Grade } from './scenario';
import { sfx } from './sound';

// 주루 판단 시뮬레이터의 첫 화면(상황 목록). 내야 수비 목록과 같은 모양: 왼쪽에 설정·조작법, 오른쪽에 종류별 탭.

const KINDS: RunKind[] = ['extra', 'fly', 'ground'];
const GRADE_SHORT: Record<Grade, string> = { best: '최선', ok: '아쉬움', bad: '오답' };

const KIND_DESC: Record<RunKind, string> = {
  extra: '외야 안타 때 한 베이스 더 갈지 정해요.',
  fly: '공이 뜨는 순간 스타트·중간까지(하프웨이)·태그업 준비 중에 고르고, 잡히면 태그업할지 정해요.',
  ground: '땅볼에 진루할지 귀루할지 정해요. 포스(의무 진루)인지 먼저 생각하세요.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class RunMenu {
  onPick: (id: string) => void = () => {};
  onRandom: (scope: RunKind | 'all') => void = () => {};
  onDifficulty: (d: DifficultyId) => void = () => {};
  private tab: RunKind = 'extra';
  private el = $('menu');

  show(difficulty: DifficultyId, tab?: RunKind) {
    if (tab) this.tab = tab;
    this.render(difficulty);
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
  }

  private render(difficulty: DifficultyId) {
    const done = (id: string) => getRecord(id)?.best === 'best';
    const tabs = KINDS.map((k) => {
      const list = RUN_SCENARIOS.filter((s) => s.kind === k);
      return `<button class="tab ${k === this.tab ? 'selected' : ''}" data-tab="${k}" id="tab-${k}">
        <b>${RUN_KIND_LABEL[k]}</b><span>${list.filter((s) => done(s.id)).length}/${list.length}</span></button>`;
    }).join('');
    const items = RUN_SCENARIOS.filter((s) => s.kind === this.tab)
      .map((s) => {
        const rec = getRecord(s.id);
        const status = rec ? `<span class="status ${rec.best}">${GRADE_SHORT[rec.best]}</span>` : '<span class="status none">도전 전</span>';
        return `<button class="item" data-scenario="${s.id}" id="item-${s.id}">
          <span class="item-main"><b>${s.title}</b></span>
          <span class="item-side">${status}</span>
        </button>`;
      })
      .join('');
    const gen = generatedRunScenarios();
    const genCount = gen.filter((s) => s.kind === this.tab).length;
    const basicCount = RUN_SCENARIOS.filter((s) => s.kind === this.tab).length;
    const name = RUN_KIND_LABEL[this.tab];

    this.el.innerHTML = `
      <div class="card menu-card">
        <div class="menu-grid">
          <div class="menu-side">
            <div class="eyebrow">VR 야구 대비 · 주루</div>
            <h1>주루 판단 시뮬레이터</h1>
            <p class="note">주자가 되어 1인칭으로 뛰면서 판단해요. 판정은 <b>기대 득점</b>(이닝이 끝날 때까지 평균 몇 점이 나는지)으로 해서, 같은 타구라도 아웃 카운트에 따라 답이 달라져요.</p>
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
                <span>타구 숨기기 <small>브리핑에서 타구를 가리고, 공이 맞는 순간 공개해요</small></span>
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
            <div class="controls">
              <span><kbd>A</kbd></span><span>뒤로: 멈춘다 · 베이스로 돌아간다 (태그업 준비, 귀루)</span>
              <span><kbd>S</kbd></span><span>중간까지 나가 있기 · 하프웨이 (플라이일 때)</span>
              <span><kbd>D</kbd></span><span>앞으로: 간다 (한 베이스 더, 스타트, 태그업, 진루)</span>
              <span><kbd>좌클릭</kbd></span><span>바라보는 곳 고르기</span>
              <span><kbd>마우스</kbd></span><span>고개 돌리기 (화면을 클릭하면 마우스가 잠겨요)</span>
            </div>
            <p class="controls-note">선택지는 타격 순간부터 떠 있어서 미리 고를 수 있어요. 결과(세이프·아웃, 잡힘·떨어짐)에는 운이 섞이고, 판정은 판단 자체로 해요.</p>
          </div>
          <div class="menu-main">
            <div class="tabs three" role="tablist">${tabs}</div>
            <div class="items">
              <p class="random-desc">${KIND_DESC[this.tab]}</p>
              ${items}
              <div class="random-row">
                <button class="primary" id="random-kind">${name} 랜덤 연습</button>
                <button class="secondary" id="random-all">전체 랜덤</button>
              </div>
              <label class="gen-toggle" for="gen-toggle">
                <input type="checkbox" id="gen-toggle" ${getIncludeGenerated() ? 'checked' : ''} />
                <span>자동 생성 상황도 섞기 <small>(위의 기본 상황 ${basicCount}개 + 자동 생성 ${genCount}개 · 같은 타구라도 아웃 카운트와 주자가 다른 상황)</small></span>
              </label>
            </div>
            <div class="channel-links">
              <a class="channel soop" href="https://www.sooplive.com/station/yangdoki" target="_blank" rel="noopener noreferrer"><b>SOOP</b>양도끼 방송국</a>
              <a class="channel youtube" href="https://www.youtube.com/@%EC%96%91%EB%8F%84%EB%81%BC" target="_blank" rel="noopener noreferrer"><b>YouTube</b>양도끼</a>
            </div>
          </div>
        </div>
      </div>`;

    this.el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as RunKind;
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
    $<HTMLInputElement>('hide-ball').addEventListener('change', (e) => setRunHideBall((e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('gen-toggle').addEventListener('change', (e) => setIncludeGenerated((e.target as HTMLInputElement).checked));
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
