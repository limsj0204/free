import * as THREE from 'three';
import { DIFFICULTIES, PITCH, type DifficultyId } from './config';
import { BASES, P } from './coords';
import { TEAM_DEFENSE, TEAM_OFFENSE, createMannequin, faceTowards, nameSprite, poseCrouch, poseIdle, poseRun, poseSlide, poseTag, poseThrow, type Mannequin } from './players';
import { addResult, getRecord, getRunHideBall, getRunIncludeGenerated } from './progress';
import { firstStep, nextStep, playResult, playTimeline, type Play } from './runPlay';
import { RUN_TAB_LABEL, batterBoxOf, tabOf, type RunTab, gradeStep, sampleThrowNoise, trackAt, type Key, type RunScenario, type RunTimeline, type Step } from './runner';
import { RUN_SCENARIOS, generatedRunScenarios } from './runScenarios';
import { showRunBriefing, showRunResult } from './runUi';
import type { FielderId, Grade } from './scenario';
import { DEFAULT_FIELDERS } from './scenarios';
import { sfx } from './sound';
import { CONTACT_POINT, releasePoint } from './timeline';
import type { DecisionDef, UI } from './ui';

// 주루 판단: 내가 주자가 되어 1인칭으로 뛰면서 판단한다. 판단은 단계(runPlay.ts)로 나뉘고, 단계마다 선택지가 뜬다.
// 내야 수비 시뮬레이터와 같은 구장·선수·화면 부품을 쓰는 별도 페이지(runner.html, runMain.ts)다.

type Phase = 'idle' | 'briefing' | 'live' | 'decision' | 'play' | 'result' | 'replay';

const EYE_HEIGHT = 1.62;
const PICK_ANGLE = 0.3;
const TOUCH_LOOK = 2.7;
const TAP_RADIUS = 70;
const REPLAY_SPEED = 0.6;
const FIELDER_IDS: FielderId[] = ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];
const OTHER_COUNT = 3; // 나 말고 화면에 나오는 주자 (타자 포함)
// A는 뒤로(멈춤·베이스로·귀루), S는 하프웨이, D는 앞으로(간다·스타트·진루). 화살표 ← ↓ →도 같다.
const KEY_CODES: Record<string, string[]> = { A: ['KeyA', 'ArrowLeft'], S: ['KeyS', 'ArrowDown'], D: ['KeyD', 'ArrowRight'] };
const RANK: Record<Grade, number> = { best: 2, ok: 1, bad: 0 };

const tvView = new URLSearchParams(location.search).get('view') === 'tv';

export class RunGame {
  private phase: Phase = 'idle';
  private scn: RunScenario = RUN_SCENARIOS[0];
  private play!: Play;
  private step: Step | null = null; // 지금 기다리는 판단
  private tl!: RunTimeline;
  private t = 0;
  private timeScale = 1;
  difficulty: DifficultyId = 'normal';

  private pitchKmh = 120;
  private panelShown = false;
  private pending: string | null = null;
  private pendingReal = 0;
  private decisionRealStart = 0;
  private defs: DecisionDef[] = [];
  private randomPool: RunScenario[] | null = null;
  private randomLabel: string | null = null;
  // 전체 랜덤은 어떤 타구가 나올지 모르는 게 연습의 핵심이라 설정과 상관없이 타구를 숨긴다
  private randomAll = false;
  private soundT = -Infinity;
  private shownCalls = new Set<number>();
  private callSprites: THREE.Sprite[] = [];

  private world = new THREE.Group();
  private fielders = new Map<FielderId, Mannequin>();
  private me: Mannequin;
  private others: Mannequin[] = [];
  private bat: THREE.Group;
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private marker: THREE.Group;

  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  private autoLook = true; // 마우스(터치)로 시점을 돌리기 전까지는 공을 따라 본다

  constructor(
    scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private canvas: HTMLCanvasElement,
    private ui: UI,
    private onExit: () => void,
  ) {
    this.world.visible = false;
    scene.add(this.world);
    for (const id of FIELDER_IDS) {
      const m = createMannequin(TEAM_DEFENSE);
      this.fielders.set(id, m);
      this.world.add(m.root);
    }
    this.me = createMannequin(TEAM_OFFENSE);
    this.world.add(this.me.root);
    for (let i = 0; i < OTHER_COUNT; i++) {
      const m = createMannequin(TEAM_OFFENSE);
      this.others.push(m);
      this.world.add(m.root);
    }

    this.bat = new THREE.Group();
    const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.018, 0.85, 8), new THREE.MeshLambertMaterial({ color: 0xd8b07a }));
    bat.position.y = 0.42;
    this.bat.add(bat);
    this.bat.position.set(-0.15, 0.55, 0.15);

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.world.add(this.ball);
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.09, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.renderOrder = 1;
    this.world.add(this.ballShadow);

    // 리플레이에서 나를 알아보기 쉽게 발밑에 원과 이름표
    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.25, 32),
      new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.renderOrder = 2;
    this.marker.add(ring);
    const tag = nameSprite('나', '#f2c94c');
    tag.position.y = 3.2;
    tag.scale.set(5, 1.25, 1);
    this.marker.add(tag);
    this.world.add(this.marker);

    this.bindInput();
  }

  get active() {
    return this.phase !== 'idle';
  }

  // ---------- 입력 ----------

  private bindInput() {
    const look = (dx: number, dy: number) => {
      if (this.playing && (dx || dy)) this.autoLook = false;
      this.yaw -= dx * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.2, 1.0);
    };
    document.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      if (document.pointerLockElement === this.canvas || this.dragging) look(e.movementX, e.movementY);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (this.phase === 'replay') {
        this.endReplay();
        return;
      }
      if (!this.playing) return;
      if (document.pointerLockElement === this.canvas) {
        if (this.canChoose && e.button === 0) this.pickByGaze();
        return;
      }
      this.dragging = true;
      this.lockPointer();
    });
    document.addEventListener('mouseup', () => (this.dragging = false));

    let touch: { id: number; x: number; y: number; sx: number; sy: number; t0: number; moved: boolean } | null = null;
    this.canvas.addEventListener('touchstart', (e) => {
      if (!this.active) return;
      const t = e.changedTouches[0];
      touch = { id: t.identifier, x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t0: performance.now(), moved: false };
    });
    this.canvas.addEventListener('touchmove', (e) => {
      const t = [...e.changedTouches].find((x) => x.identifier === touch?.id);
      if (!this.active || !touch || !t) return;
      // 휴대폰은 화면을 끄는 방향으로 시야가 따라온다 (지도처럼 끌기). 마우스와 반대 방향이다
      if (this.playing || this.phase === 'replay' || this.phase === 'result') look(-(t.clientX - touch.x) * TOUCH_LOOK, -(t.clientY - touch.y) * TOUCH_LOOK);
      touch.x = t.clientX;
      touch.y = t.clientY;
      if (Math.hypot(t.clientX - touch.sx, t.clientY - touch.sy) > 10) touch.moved = true;
    });
    this.canvas.addEventListener('touchend', (e) => {
      const t = [...e.changedTouches].find((x) => x.identifier === touch?.id);
      if (this.active && touch && t && !touch.moved && performance.now() - touch.t0 < 400) {
        if (this.phase === 'replay') this.endReplay();
        else this.tapAt(t.clientX, t.clientY);
      }
      touch = null;
    });

    document.addEventListener('keydown', (e) => {
      if (!this.active || e.repeat) return;
      const opt = this.canChoose ? this.step!.options.findIndex((o) => KEY_CODES[o.key].includes(e.code)) : -1;
      if (opt >= 0) {
        e.preventDefault();
        this.input(opt);
      } else if (this.phase === 'result') {
        if (e.code === 'KeyR') this.restart();
        else if (e.code === 'KeyV') this.replay();
        else if (e.code === 'KeyN') this.next();
        else if (e.code === 'Escape' || e.code === 'KeyM') this.exit();
      } else if (this.phase === 'briefing') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          this.start();
        } else if (e.code === 'Escape') this.exit();
      } else if (this.phase === 'replay' && (e.code === 'Escape' || e.code === 'Space')) {
        e.preventDefault();
        this.endReplay();
      }
    });
  }

  // 화면 버튼(시작, 다시 하기 등)
  handle(action: 'choose' | 'start' | 'restart' | 'replay' | 'next' | 'menu', value?: number) {
    if (action === 'choose') {
      if (this.canChoose && value !== undefined) this.input(value);
    } else if (action === 'start') this.start();
    else if (action === 'restart') this.restart();
    else if (action === 'replay') this.replay();
    else if (action === 'next') this.next();
    else this.exit();
  }

  private get playing() {
    return this.phase === 'live' || this.phase === 'decision' || this.phase === 'play';
  }

  private get canChoose() {
    return !!this.step && (this.phase === 'decision' || (this.phase === 'live' && this.panelShown));
  }

  private lockPointer() {
    try {
      this.canvas.requestPointerLock?.()?.catch?.(() => {});
    } catch {
      /* 드래그로 대체 */
    }
  }

  private unlockPointer() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private tapAt(x: number, y: number) {
    if (!this.canChoose) return;
    const v = new THREE.Vector3();
    let best = -1;
    let bestDist = TAP_RADIUS;
    this.defs.forEach((d, i) => {
      if (!d.pos) return;
      v.copy(d.pos).setY(0.3).project(this.camera);
      if (v.z > 1) return;
      const dist = Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    if (best >= 0) this.input(best);
  }

  // 화면 가운데와 좌우 방향이 가장 가까운 곳 (지금 서 있는 곳은 고를 수 없다)
  private pickByGaze() {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.setY(0).normalize();
    let best = -1;
    let bestAngle = PICK_ANGLE;
    this.defs.forEach((d, i) => {
      if (!d.pos) return;
      const to = d.pos.clone().sub(this.camera.position).setY(0);
      if (to.lengthSq() < 4) return;
      const a = to.normalize().angleTo(fwd);
      if (a < bestAngle) {
        bestAngle = a;
        best = i;
      }
    });
    if (best >= 0) this.input(best);
  }

  // 판단 순간 전이면 미리 골라두고(그 순간 바로 실행), 판단 순간이 지났으면 바로 정한다
  private input(index: number) {
    const opt = this.step?.options[index];
    if (!opt) return;
    sfx.click();
    if (this.phase === 'decision') {
      this.choose(opt.id);
      return;
    }
    this.pending = opt.id;
    this.pendingReal = performance.now();
    this.ui.markPending(index);
  }

  // ---------- 흐름 ----------

  // 목록에서 상황을 골랐을 때 (random이면 그 종류의 랜덤 연습, 'all'이면 전체 랜덤)
  open(id: string | null, random: RunTab | 'all' | null) {
    this.world.visible = true;
    const pool = [...RUN_SCENARIOS, ...(getRunIncludeGenerated() ? generatedRunScenarios() : [])];
    this.randomPool = random ? pool.filter((s) => random === 'all' || tabOf(s) === random) : null;
    this.randomLabel = random ? `${random === 'all' ? '전체' : RUN_TAB_LABEL[random]} 랜덤` : null;
    this.randomAll = random === 'all';
    const scn = id ? RUN_SCENARIOS.find((s) => s.id === id)! : this.pickRandom();
    this.openBriefing(scn);
  }

  private exit() {
    showCoachCall(null);
    this.phase = 'idle';
    this.world.visible = false;
    this.clearCalls();
    this.ui.hideDecision();
    this.ui.showReplayBanner(false);
    this.unlockPointer();
    this.onExit();
  }

  private setStep(step: Step | null) {
    this.step = step;
    this.panelShown = false;
    this.pending = null;
    this.defs = (step?.options ?? []).map((o, i) => ({ value: i, key: o.key, code: KEY_CODES[o.key][0], label: o.label, short: o.short, pos: o.pos }));
  }

  private prepare(scn: RunScenario) {
    showCoachCall(null);
    this.scn = scn;
    this.pitchKmh = Math.round(PITCH.minKmh + Math.random() * (PITCH.maxKmh - PITCH.minKmh));
    const pitchFlight = releasePoint().distanceTo(CONTACT_POINT) / (this.pitchKmh / 3.6);
    this.play = { scn, pitchFlight, noise: sampleThrowNoise(), caught: Math.random() < (scn.hit?.catchProb ?? 1), decided: [] };
    this.tl = playTimeline(this.play);
    this.t = this.tl.start;
    this.soundT = this.t;
    this.timeScale = 1;
    this.clearCalls();
    this.setStep(firstStep(scn));
    this.autoLook = true;
    this.camera.position.copy(trackAt(this.tl.me, this.t).pos).setY(EYE_HEIGHT);
    // 타자는 투수를, 주자는 타자를 보고 시작한다
    this.lookAtPoint(scn.me === 'batter' ? P(0, 18.44, 1.6) : P(0, 0, 1.0));
    this.ui.setHudInfo(this.ballHidden() ? '타구 대기' : scn.event, scn.situation, this.pitchKmh);
    this.update(0);
  }

  private ballHidden() {
    return this.randomAll || getRunHideBall();
  }

  private openBriefing(scn: RunScenario) {
    this.prepare(scn);
    this.phase = 'briefing';
    showRunBriefing(this.ui, scn, this.randomLabel, this.ballHidden());
  }

  private start() {
    if (this.phase !== 'briefing') return;
    this.ui.hideOverlays();
    this.ui.setHudTitle('투구 대기');
    this.phase = 'live';
    this.lockPointer();
  }

  private restart() {
    this.prepare(this.scn);
    this.phase = 'briefing';
    this.start();
  }

  private next() {
    if (this.randomPool) {
      this.openBriefing(this.pickRandom());
      return;
    }
    // 같은 탭(종류)의 다음 기본 상황
    const list = RUN_SCENARIOS.filter((s) => tabOf(s) === tabOf(this.scn));
    this.openBriefing(list[(list.indexOf(this.scn) + 1) % list.length]);
  }

  // 방금 한 상황은 빼고, 아직 최선의 판단을 못 한 상황이 두 배 더 잘 나오게 고른다
  private pickRandom(): RunScenario {
    const pool = this.randomPool ?? RUN_SCENARIOS;
    const cands = pool.length > 1 ? pool.filter((s) => s !== this.scn) : pool;
    const weights = cands.map((s) => (getRecord(s.id)?.best === 'best' ? 1 : 2));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) {
      r -= weights[i];
      if (r <= 0) return cands[i];
    }
    return cands[cands.length - 1];
  }

  private choose(id: string, timedOut = false, decidedAtReal = performance.now()) {
    const step = this.step!;
    const td = Math.max(this.t, step.decisionAt);
    this.play.decided.push({ step, id, td, timedOut, reactionReal: Math.max(0, (decidedAtReal - this.decisionRealStart) / 1000) });
    this.tl = playTimeline(this.play);
    this.ui.hideDecision();
    const next = nextStep(this.play);
    this.setStep(next);
    this.phase = next ? 'live' : 'play';
  }

  private finish() {
    showCoachCall(null);
    this.phase = 'result';
    this.unlockPointer();
    this.showResult(true);
  }

  private showResult(record: boolean) {
    const grades = this.play.decided.map((d) => gradeStep(d.step, d.id, d.td - d.step.decisionAt, d.timedOut));
    const worst = grades.reduce((a, g) => (RANK[g.grade] < RANK[a] ? g.grade : a), 'best' as Grade);
    if (record) {
      addResult(this.scn.id, worst, grades[0].delay);
      sfx.result(worst === 'best');
    }
    showRunResult(this.ui, {
      scenario: this.scn,
      play: this.play,
      grades,
      grade: worst,
      result: playResult(this.play),
      timeScale: DIFFICULTIES.find((x) => x.id === this.difficulty)!.timeScale,
    });
  }

  private replay() {
    if (this.phase !== 'result') return;
    this.phase = 'replay';
    this.clearCalls();
    this.ui.hideOverlays();
    this.ui.showReplayBanner(true);
    this.t = this.tl.tWindup - 0.6;
    this.soundT = this.t;
  }

  private endReplay() {
    this.ui.showReplayBanner(false);
    this.phase = 'result';
    this.showResult(false);
  }

  private clearCalls() {
    this.shownCalls.clear();
    for (const s of this.callSprites) this.world.remove(s);
    this.callSprites = [];
  }

  // ---------- 매 프레임 ----------

  update(realDt: number) {
    if (!this.active) return;
    const ds = DIFFICULTIES.find((x) => x.id === this.difficulty)!.timeScale;
    if (this.playing) {
      const target = this.phase === 'decision' ? ds : 1;
      this.timeScale += (target - this.timeScale) * Math.min(1, realDt * (this.phase === 'decision' ? 12 : 3));
      this.t += realDt * this.timeScale;
    } else if (this.phase === 'replay') {
      this.t += realDt * REPLAY_SPEED;
      if (this.t >= this.tl.end) this.endReplay();
    }

    const step = this.step;
    // 첫 판단은 타격 순간부터 선택지를 띄워서 미리 고를 수 있게 한다.
    // 다음 판단(태그업)은 공이 잡히는 순간에야 뜬다 (미리 뜨면 잡힌다는 걸 알려주는 셈이라).
    const first = this.play.decided.length === 0;
    // 코치 콜은 콜이 나오는 순간에 선택지와 함께 뜬다
    if (first && this.phase === 'live' && this.t >= 0) this.ui.setHudTitle(this.scn.event);
    if (this.phase === 'live' && step && !this.panelShown && this.t >= (first ? (step.showAt ?? 0) : step.decisionAt)) {
      this.panelShown = true;
      this.decisionRealStart = performance.now();
      if (step.call) showCoachCall(step.call);
      this.ui.showDecision(step.prompt, this.defs);
      this.ui.setDecisionTimer(1);
    }
    if (this.phase === 'live' && step && this.t >= step.decisionAt) {
      this.t = step.decisionAt;
      if (this.pending) this.choose(this.pending, false, this.pendingReal);
      else {
        this.phase = 'decision';
        this.decisionRealStart = performance.now();
        this.ui.setDecisionTitle(step.urgent);
      }
    }
    if (this.phase === 'decision' && step) {
      this.ui.setDecisionTimer((step.deadline - this.t) / (step.deadline - step.decisionAt));
      if (this.t >= step.deadline) this.choose(step.timeout, true);
    }
    if (this.phase === 'play' && this.t >= this.tl.end) this.finish();

    this.playSounds();
    this.animate(realDt);
    this.updateCamera(realDt);
    this.ui.updateTags(this.camera, this.canChoose ? this.defs : null);
  }

  private lookAtPoint(p: THREE.Vector3) {
    const d = p.clone().sub(this.camera.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  private get overhead() {
    return tvView || this.phase === 'replay';
  }

  private sliding(runner: 'me' | number, pos: THREE.Vector3, t: number) {
    const s = this.tl.slides.find((x) => x.runner === runner && t > x.t - 0.35 && t < x.t + 0.9);
    return s && pos.distanceTo(BASES[s.base]) < 3.5 ? s : null;
  }

  private updateCamera(realDt: number) {
    if (this.overhead) {
      this.camera.position.copy(P(0, -22, 42));
      this.camera.lookAt(P(0, 50));
      return;
    }
    const pos = trackAt(this.tl.me, this.t).pos;
    if (this.autoLook && this.playing && this.t > 0.1) {
      // 공을 따라 고개를 돌린다 (뜬공은 너무 올려다보지 않게)
      const d = this.ballPosition(this.t).sub(pos.clone().setY(EYE_HEIGHT));
      const yaw = Math.atan2(-d.x, -d.z);
      const pitch = THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.35, 0.55);
      const k = Math.min(1, realDt * 5);
      this.yaw += Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) * k;
      this.pitch += (pitch - this.pitch) * k;
    }
    // 슬라이딩할 때는 몸을 낮춘다
    const low = this.sliding('me', pos, this.t) ? 0.9 : 0;
    this.camera.position.set(pos.x, EYE_HEIGHT - low, pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private animate(realDt: number) {
    const t = this.t;
    const tl = this.tl;
    const dt = realDt * (this.phase === 'replay' ? REPLAY_SPEED : this.timeScale);
    const ballPos = this.ballPosition(t);
    const myPos = trackAt(tl.me, t, new THREE.Vector3()).pos;

    for (const id of FIELDER_IDS) {
      const m = this.fielders.get(id)!;
      const keys = tl.fielders[id];
      let moving = false;
      let dest: THREE.Vector3 | null = null;
      if (keys) {
        const r = trackAt(keys, t);
        m.root.position.copy(r.pos);
        moving = r.moving;
        dest = keys[keys.length - 1].pos;
      } else m.root.position.copy(tl.fieldersHome?.[id] ?? DEFAULT_FIELDERS[id]);
      const throwSeg = tl.ball.find((s) => s.thrower === id && t > s.t0 - 0.3 && t < s.t0 + 0.15);
      const play = tl.plays.find((p) => p.receiver === id && t > p.t - 0.3 && t < p.t + 0.45);
      if (throwSeg) {
        faceTowards(m, throwSeg.to);
        poseThrow(m, THREE.MathUtils.clamp((t - (throwSeg.t0 - 0.3)) / 0.3, 0, 1));
      } else if (play) {
        faceTowards(m, play.runner === 'me' ? myPos : trackAt(tl.others[play.runner].keys, t).pos);
        poseTag(m);
      } else if (id === 'P' && t >= tl.tWindup && t < tl.tRelease + 0.3) {
        faceTowards(m, BASES.home);
        poseThrow(m, THREE.MathUtils.clamp((t - tl.tWindup) / PITCH.windupTime, 0, 1));
      } else if (id === 'C' && !moving) {
        faceTowards(m, P(0, 18.44));
        poseCrouch(m);
      } else if (moving && dest) {
        faceTowards(m, dest);
        poseRun(m, dt, 7);
      } else {
        faceTowards(m, t > 0 ? ballPos : BASES.home);
        poseIdle(m, t > tl.tWindup);
      }
    }

    // 배트는 타석에 있는 동안만 보인다 (poseBatter가 다시 켠다)
    this.bat.visible = false;

    // 나: 1인칭일 때는 몸을 숨기고, 리플레이에서만 보인다
    this.me.root.visible = this.overhead;
    this.marker.visible = this.overhead;
    this.marker.position.copy(myPos);
    this.me.root.position.copy(myPos);
    if (tl.meBatter && t < tl.meStart) this.poseBatter(this.me, t, true);
    else this.poseRunner(this.me, tl.me, t, dt, 'me');

    // 다른 주자들 (타자 포함)
    this.others.forEach((m, i) => {
      const o = tl.others[i];
      m.root.visible = !!o;
      if (!o) return;
      if (o.batter && t < o.start) this.poseBatter(m, t, false);
      else {
        m.root.position.copy(trackAt(o.keys, t).pos);
        this.poseRunner(m, o.keys, t, dt, i);
      }
    });

    this.ball.position.copy(ballPos);
    this.ballShadow.position.set(ballPos.x, 0.02, ballPos.z);
    this.ballShadow.visible = ballPos.y < 30;
    this.showCalls(t);
  }

  private poseRunner(m: Mannequin, track: Key[], t: number, dt: number, who: 'me' | number) {
    m.body.rotation.y = 0;
    const now = trackAt(track, t);
    const ahead = trackAt(track, t + 0.1).pos;
    const slide = this.sliding(who, now.pos, t);
    if (slide) {
      faceTowards(m, BASES[slide.base]);
      poseSlide(m);
    } else if (now.moving && ahead.distanceTo(now.pos) > 0.05) {
      faceTowards(m, ahead);
      poseRun(m, dt, 7);
    } else {
      faceTowards(m, this.ballPosition(t));
      poseIdle(m, t < 0);
    }
  }

  private poseBatter(m: Mannequin, t: number, mine: boolean) {
    if (this.bat.parent !== m.body) m.body.add(this.bat);
    m.root.position.copy(batterBoxOf(this.scn));
    faceTowards(m, BASES.home.clone().add(P(0, 0.2)));
    poseIdle(m, true);
    this.bat.visible = !mine || this.overhead;
    const swing = this.tl.noSwing ? 0 : THREE.MathUtils.clamp((t + 0.15) / 0.25, 0, 1);
    this.bat.rotation.set(-0.3, 0, 1.0 - swing * 2.6);
    m.body.rotation.y = -swing * 1.2;
  }

  private ballPosition(t: number): THREE.Vector3 {
    const tl = this.tl;
    const pos = new THREE.Vector3();
    const active = tl.ball.find((s) => t >= s.t0 && t < s.t1);
    if (active) {
      const u = (t - active.t0) / (active.t1 - active.t0);
      pos.lerpVectors(active.from, active.to, u);
      if (active.bounces) pos.y += Math.abs(Math.sin(u * Math.PI * active.bounces)) * active.arc * Math.pow(1 - u, 1.5);
      else pos.y += Math.sin(u * Math.PI) * active.arc;
      return pos;
    }
    const done = tl.ball.filter((s) => t >= s.t1);
    if (done.length === 0) return pos.copy(releasePoint());
    return pos.copy(done.reduce((a, b) => (b.t1 > a.t1 ? b : a)).to);
  }

  private playSounds() {
    const a = this.soundT;
    const b = this.t;
    this.soundT = b;
    if (!(this.playing || this.phase === 'replay') || b <= a) return;
    const crossed = (x: number) => a < x && x <= b;
    const ball = this.tl.ball;
    if (crossed(0) && !this.tl.noSwing) sfx.bat();
    // 타구를 수비가 잡는 순간 (뒤로 튀어 굴러가는 공은 잡은 게 아니다)
    const hit = ball[1];
    if (hit && !this.tl.noSwing && crossed(hit.t1) && !ball.some((s) => !s.thrower && s !== hit && Math.abs(s.t0 - hit.t1) < 0.01)) sfx.glove();
    for (const s of ball) {
      if (!s.thrower) continue;
      if (crossed(s.t0)) sfx.whoosh();
      if (crossed(s.t1)) sfx.glove();
    }
  }

  private showCalls(t: number) {
    this.tl.calls.forEach((c, i) => {
      if (t < c.t || this.shownCalls.has(i)) return;
      this.shownCalls.add(i);
      // 아웃은 빨강, 세이프·안타는 파랑 (수비 화면과 같은 색). 주자 입장이라 세이프 쪽 소리가 밝다.
      const sprite = nameSprite(c.text, c.good ? '#ff5a4f' : '#5ad1ff');
      sprite.position.copy(c.pos).setY(3);
      sprite.scale.set(3.2, 0.8, 1);
      this.world.add(sprite);
      this.callSprites.push(sprite);
      if (this.phase !== 'replay') this.ui.toast(c.text, c.good);
      if (c.good) sfx.safe();
      else sfx.out();
    });
  }
}

// 3루 코치 콜: 화면 가운데 위에 크게 띄운다 (null이면 숨긴다)
function showCoachCall(call: { text: string; go: boolean } | null) {
  const el = document.getElementById('coach-call');
  if (!el) return;
  el.classList.toggle('hidden', !call);
  if (!call) return;
  el.textContent = call.text;
  el.classList.toggle('go', call.go);
  el.classList.toggle('stop', !call.go);
}
