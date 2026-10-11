import * as THREE from 'three';
import { DIFFICULTIES, PITCH, type DifficultyId } from './config';
import { BASES, P } from './coords';
import { TEAM_DEFENSE, TEAM_OFFENSE, createMannequin, faceTowards, nameSprite, poseCrouch, poseIdle, poseRun, poseSlide, poseTag, poseThrow, type Mannequin } from './players';
import { addResult, getIncludeGenerated, getRecord } from './progress';
import {
  arrivalIfGo,
  batterBoxOf,
  buildRunTimeline,
  decisionLabel,
  gradeRun,
  route,
  sampleThrowNoise,
  throwOf,
  trackAt,
  type RunDecision,
  type RunScenario,
  type RunTimeline,
} from './runner';
import { RUN_SCENARIOS, generatedRunScenarios } from './runScenarios';
import { runPrompt, showRunBriefing, showRunResult } from './runUi';
import type { FielderId } from './scenario';
import { DEFAULT_FIELDERS } from './scenarios';
import { sfx } from './sound';
import { CONTACT_POINT, pathPosition, releasePoint } from './timeline';
import type { DecisionDef, UI } from './ui';

// 주루 판단: 내가 주자가 되어 1인칭으로 뛰면서 한 베이스 더 갈지(또는 태그업할지) 정한다.
// 수비 게임(Game)과 같은 구장·카메라·화면을 쓰고, 주자 탭에서 상황을 고르면 Game이 이쪽으로 넘겨준다.

type Phase = 'idle' | 'briefing' | 'live' | 'decision' | 'play' | 'result' | 'replay';

const EYE_HEIGHT = 1.62;
const PICK_ANGLE = 0.3;
const TOUCH_LOOK = 2.7;
const TAP_RADIUS = 70;
const REPLAY_SPEED = 0.6;
const FIELDER_IDS: FielderId[] = ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];
const GO = 0;
const STOP = 1;

const tvView = new URLSearchParams(location.search).get('view') === 'tv';

export class RunGame {
  private phase: Phase = 'idle';
  private scn: RunScenario = RUN_SCENARIOS[0];
  private tl!: RunTimeline;
  private t = 0;
  private timeScale = 1;
  difficulty: DifficultyId = 'normal';

  private pitchKmh = 120;
  private pitchFlight = 0.4;
  private noise = 0;
  private panelShown = false;
  private pending: RunDecision | null = null;
  private pendingReal = 0;
  private decisionRealStart = 0;
  private reactionReal = 0;
  private decided: { decision: RunDecision; td: number; timedOut: boolean } | null = null;
  private defs: DecisionDef[] = [];
  private randomPool: RunScenario[] | null = null;
  private soundT = -Infinity;
  private shownCalls = new Set<number>();
  private callSprites: THREE.Sprite[] = [];

  private world = new THREE.Group();
  private fielders = new Map<FielderId, Mannequin>();
  private me: Mannequin;
  private batter: Mannequin;
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
    this.batter = createMannequin(TEAM_OFFENSE);
    this.world.add(this.me.root, this.batter.root);

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
      if (this.playing || this.phase === 'replay' || this.phase === 'result') look((t.clientX - touch.x) * TOUCH_LOOK, (t.clientY - touch.y) * TOUCH_LOOK);
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
      if (this.canChoose && (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'KeyS' || e.code === 'ArrowDown')) {
        e.preventDefault();
        this.input(e.code === 'KeyW' || e.code === 'ArrowUp' ? GO : STOP);
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

  // Game이 화면 버튼(시작, 다시 하기 등)을 이쪽으로 넘겨준다
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
    return this.phase === 'decision' || (this.phase === 'live' && this.panelShown);
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
    if (best >= 0) this.input(this.defs[best].value as number);
  }

  // 화면 가운데와 좌우 방향이 가장 가까운 베이스 (지금 서 있는 베이스는 고를 수 없다)
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
    if (best >= 0) this.input(this.defs[best].value as number);
  }

  // 판단 순간 전이면 미리 골라두고(그 순간 바로 실행), 판단 순간이 지났으면 바로 정한다
  private input(value: number) {
    sfx.click();
    const d: RunDecision = value === GO ? 'go' : 'stop';
    if (this.phase === 'decision') {
      this.choose(d);
      return;
    }
    this.pending = d;
    this.pendingReal = performance.now();
    this.ui.markPending(value);
  }

  // ---------- 흐름 ----------

  // 주자 탭에서 상황을 골랐을 때 (random이면 랜덤 연습)
  open(id: string | null, random: boolean) {
    this.world.visible = true;
    this.randomPool = random ? [...RUN_SCENARIOS, ...(getIncludeGenerated() ? generatedRunScenarios() : [])] : null;
    const scn = id ? RUN_SCENARIOS.find((s) => s.id === id)! : this.pickRandom();
    this.openBriefing(scn);
  }

  private exit() {
    this.phase = 'idle';
    this.world.visible = false;
    this.clearCalls();
    this.ui.hideDecision();
    this.ui.showReplayBanner(false);
    this.unlockPointer();
    this.onExit();
  }

  private prepare(scn: RunScenario) {
    this.scn = scn;
    this.pitchKmh = Math.round(PITCH.minKmh + Math.random() * (PITCH.maxKmh - PITCH.minKmh));
    this.pitchFlight = releasePoint().distanceTo(CONTACT_POINT) / (this.pitchKmh / 3.6);
    this.noise = sampleThrowNoise();
    this.tl = buildRunTimeline(scn, this.pitchFlight);
    this.t = this.tl.start;
    this.soundT = this.t;
    this.timeScale = 1;
    this.panelShown = false;
    this.pending = null;
    this.decided = null;
    this.clearCalls();
    const r = route(scn);
    this.defs = [
      { value: GO, key: 'W', code: 'KeyW', label: decisionLabel(scn, 'go'), short: decisionLabel(scn, 'go'), pos: BASES[r.target] },
      // 태그업은 지금 밟고 있는 베이스라 화면에 표시하지 않는다
      { value: STOP, key: 'S', code: 'KeyS', label: decisionLabel(scn, 'stop'), short: decisionLabel(scn, 'stop'), pos: scn.kind === 'tagup' ? null : BASES[r.stay] },
    ];
    this.autoLook = true;
    this.camera.position.copy(trackAt(this.tl.me, this.t).pos).setY(EYE_HEIGHT);
    // 타자는 투수를, 주자는 타자를 보고 시작한다
    this.lookAtPoint(scn.me === 'batter' ? P(0, 18.44, 1.6) : P(0, 0, 1.0));
    this.ui.setHudInfo(scn.event, scn.situation, this.pitchKmh);
    this.update(0);
  }

  private openBriefing(scn: RunScenario) {
    this.prepare(scn);
    this.phase = 'briefing';
    const label = this.randomPool ? '주자 랜덤' : null;
    showRunBriefing(this.ui, scn, label);
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
    const i = RUN_SCENARIOS.indexOf(this.scn);
    this.openBriefing(RUN_SCENARIOS[(i + 1) % RUN_SCENARIOS.length]);
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

  private choose(decision: RunDecision, timedOut = false, decidedAtReal = performance.now()) {
    const td = Math.max(this.t, this.tl.decisionAt);
    this.reactionReal = Math.max(0, (decidedAtReal - this.decisionRealStart) / 1000);
    this.decided = { decision, td, timedOut };
    this.tl = buildRunTimeline(this.scn, this.pitchFlight, { decision, td, noise: this.noise });
    this.phase = 'play';
    this.ui.hideDecision();
  }

  private finish() {
    this.phase = 'result';
    this.unlockPointer();
    this.showResult(true);
  }

  private showResult(record: boolean) {
    const scn = this.scn;
    const dec = this.decided!;
    const delay = Math.max(0, dec.td - this.tl.decisionAt);
    const grade = gradeRun(scn, dec.decision, delay, dec.timedOut);
    if (record) {
      addResult(scn.id, grade.grade, delay);
      sfx.result(grade.grade === 'best');
    }
    const thr = throwOf(scn, this.noise);
    const go = dec.decision === 'go' ? arrivalIfGo(scn, dec.td) : null;
    showRunResult(this.ui, {
      scenario: scn,
      decision: dec.decision,
      delay,
      timedOut: dec.timedOut,
      grade,
      safe: go ? go.arrival < thr.tagAt : null,
      noise: this.noise,
      arrival: go ? go.arrival : null,
      tagAt: thr.tagAt,
      hesitated: go ? go.late : 0,
      reactionReal: this.reactionReal,
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

    if (this.phase === 'live' && !this.panelShown && this.t >= 0) {
      // 타격 순간부터 선택지를 띄워서 미리 고를 수 있게 한다
      this.panelShown = true;
      this.decisionRealStart = performance.now();
      this.ui.setHudTitle(this.scn.event);
      this.ui.showDecision(runPrompt(this.scn), this.defs);
      this.ui.setDecisionTimer(1);
    }
    if (this.phase === 'live' && this.t >= this.tl.decisionAt) {
      this.t = this.tl.decisionAt;
      if (this.pending) this.choose(this.pending, false, this.pendingReal);
      else {
        this.phase = 'decision';
        this.decisionRealStart = performance.now();
        this.ui.setDecisionTitle(this.scn.kind === 'tagup' ? '잡았다! 뛸까?' : `지금 정하세요! ${runPrompt(this.scn)}`);
      }
    }
    if (this.phase === 'decision') {
      const left = (this.tl.deadline - this.t) / (this.tl.deadline - this.tl.decisionAt);
      this.ui.setDecisionTimer(left);
      if (this.t >= this.tl.deadline) this.choose('stop', true);
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
    const s = this.tl.slide;
    const low = s && this.t > s.t - 0.35 && this.t < s.t + 0.9 && pos.distanceTo(BASES[s.base]) < 3.5 ? 0.9 : 0;
    this.camera.position.set(pos.x, EYE_HEIGHT - low, pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private animate(realDt: number) {
    const t = this.t;
    const tl = this.tl;
    const scn = this.scn;
    const dt = realDt * (this.phase === 'replay' ? REPLAY_SPEED : this.timeScale);
    const ballPos = this.ballPosition(t);
    const tmp = new THREE.Vector3();

    for (const id of FIELDER_IDS) {
      const m = this.fielders.get(id)!;
      const path = tl.fielders[id];
      let moving = false;
      let dest: THREE.Vector3 | null = null;
      if (path) {
        const r = pathPosition(path, t, tmp);
        m.root.position.copy(r.pos);
        moving = r.moving;
        dest = path.waypoints[path.waypoints.length - 1];
      } else m.root.position.copy(DEFAULT_FIELDERS[id]);
      const throwSeg = tl.ball.find((s) => s.thrower === id && t > s.t0 - 0.3 && t < s.t0 + 0.15);
      const play = tl.plays.find((p) => p.receiver === id && t > p.t - 0.3 && t < p.t + 0.45);
      if (throwSeg) {
        faceTowards(m, throwSeg.to);
        poseThrow(m, THREE.MathUtils.clamp((t - (throwSeg.t0 - 0.3)) / 0.3, 0, 1));
      } else if (play) {
        faceTowards(m, trackAt(tl.me, t).pos);
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
    const myPos = trackAt(tl.me, t, new THREE.Vector3());
    this.me.root.visible = this.overhead;
    this.marker.visible = this.overhead;
    this.marker.position.copy(myPos.pos);
    this.me.root.position.copy(myPos.pos);
    if (scn.me === 'batter' && t < tl.batterStart) this.poseBatter(this.me, t, true);
    else this.poseRunner(this.me, tl.me, t, dt, tl.slide);

    // 타자 (내가 타자 주자가 아닐 때)
    this.batter.root.visible = tl.batter !== null;
    if (tl.batter) {
      if (t < tl.batterStart) this.poseBatter(this.batter, t, false);
      else {
        this.batter.root.position.copy(trackAt(tl.batter, t).pos);
        this.poseRunner(this.batter, tl.batter, t, dt, null);
      }
    }

    this.ball.position.copy(ballPos);
    this.ballShadow.position.set(ballPos.x, 0.02, ballPos.z);
    this.ballShadow.visible = ballPos.y < 30;
    this.showCalls(t);
  }

  private poseRunner(m: Mannequin, track: { t: number; pos: THREE.Vector3 }[], t: number, dt: number, slide: RunTimeline['slide']) {
    m.body.rotation.y = 0;
    const now = trackAt(track, t);
    const ahead = trackAt(track, t + 0.1).pos;
    if (slide && t > slide.t - 0.35 && t < slide.t + 0.9 && now.pos.distanceTo(BASES[slide.base]) < 3.5) {
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
    const swing = THREE.MathUtils.clamp((t + 0.15) / 0.25, 0, 1);
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
    if (crossed(0)) sfx.bat();
    if (crossed(this.scn.hit.fieldT)) sfx.glove();
    for (const s of this.tl.ball) {
      if (!s.thrower) continue;
      if (crossed(s.t0)) sfx.whoosh();
      if (crossed(s.t1)) sfx.glove();
    }
  }

  private showCalls(t: number) {
    this.tl.calls.forEach((c, i) => {
      if (t < c.t || this.shownCalls.has(i)) return;
      this.shownCalls.add(i);
      // 주자 입장이라 세이프가 좋은 결과: 세이프는 파랑, 아웃은 빨강 (수비 화면과 같은 색)
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
