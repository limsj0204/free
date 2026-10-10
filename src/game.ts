import * as THREE from 'three';
import { DIFFICULTIES, GROUNDER, PITCH, RUN, type DifficultyId } from './config';
import { BASES, BASE_LABEL, P, type BaseId } from './coords';
import {
  TEAM_DEFENSE,
  TEAM_OFFENSE,
  createMannequin,
  faceTowards,
  nameSprite,
  poseCrouch,
  poseIdle,
  poseRun,
  poseThrow,
  type Mannequin,
} from './players';
import {
  decisionDeadline,
  evaluate,
  grade,
  planRunners,
  type Choice,
  type FielderId,
  type Outcome,
  type RunnerId,
  type RunnerPlan,
  type Scenario,
} from './scenario';
import type { UI } from './ui';

type Phase = 'briefing' | 'live' | 'decision' | 'play' | 'result';

const EYE_HEIGHT = 1.62;
const PRE_PITCH = 1.6; // 투구 동작 전 대기 (게임 시간)
const CONTACT_POINT = P(0.1, 0.6, 0.85);
const RELEASE_POINT = P(-0.4, 17.0, 1.9);
const PICK_ANGLE = 0.3; // 시선으로 베이스를 고를 때 허용 각도 (rad)

export class Game {
  private phase: Phase = 'briefing';
  private t = 0; // 타격 시점을 0으로 하는 게임 시간
  private timeScale = 1;
  private difficulty: DifficultyId = 'normal';

  private pitchKmh = 120;
  private pitchFlight = 0.4;
  private runners: RunnerPlan[] = [];
  private deadline = 0;
  private decisionRealStart = 0;
  private reactionReal = 0;
  private outcome: Outcome | null = null;
  private playEnd = 0;
  private shownCalls = new Set<number>();

  private fielders = new Map<FielderId, Mannequin>();
  private runnerModels = new Map<RunnerId, Mannequin>();
  private batterBat: THREE.Group;
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private glove: THREE.Group;
  private pocket: THREE.Object3D;
  private calls: THREE.Sprite[] = [];

  private yaw = 0;
  private pitch = 0;
  private dragging = false;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private canvas: HTMLCanvasElement,
    private ui: UI,
    private scn: Scenario,
  ) {
    for (const id of Object.keys(scn.fielders) as FielderId[]) {
      const m = createMannequin(TEAM_DEFENSE);
      m.root.visible = id !== scn.player;
      this.fielders.set(id, m);
      scene.add(m.root);
    }
    for (const id of ['batter', 'r1'] as RunnerId[]) {
      const m = createMannequin(TEAM_OFFENSE);
      this.runnerModels.set(id, m);
      scene.add(m.root);
    }

    // 타자의 배트
    this.batterBat = new THREE.Group();
    const bat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.018, 0.85, 8),
      new THREE.MeshLambertMaterial({ color: 0xd8b07a }),
    );
    bat.position.y = 0.42;
    this.batterBat.add(bat);
    this.batterBat.position.set(-0.15, 0.55, 0.15);
    this.runnerModels.get('batter')!.body.add(this.batterBat);

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.09, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.renderOrder = 1;
    scene.add(this.ballShadow);

    // 1인칭 글러브. 공은 글러브 앞쪽(pocket)에 놓여 보이게 한다.
    this.glove = new THREE.Group();
    const gloveMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), new THREE.MeshLambertMaterial({ color: 0x7a4a24 }));
    gloveMesh.scale.set(1, 1.15, 0.5);
    this.glove.add(gloveMesh);
    this.pocket = new THREE.Object3D();
    this.pocket.position.set(0.02, 0.03, 0);
    this.glove.add(this.pocket);
    this.glove.position.set(-0.42, -0.3, -0.8);
    this.glove.rotation.set(0.2, 0.3, 0.25);
    camera.add(this.glove);
    scene.add(camera);
    this.glove.visible = !tvView;

    this.bindInput();
    this.reset();
  }

  // ---------- 입력 ----------

  private bindInput() {
    const look = (dx: number, dy: number) => {
      this.yaw -= dx * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.2, 1.0);
    };
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas || this.dragging) look(e.movementX, e.movementY);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.phase === 'briefing' || this.phase === 'result') return;
      if (document.pointerLockElement === this.canvas) {
        if (this.phase === 'decision' && e.button === 0) this.pickByGaze();
        return;
      }
      this.dragging = true;
      this.canvas.requestPointerLock?.()?.catch?.(() => {});
    });
    document.addEventListener('mouseup', () => (this.dragging = false));

    document.addEventListener('keydown', (e) => {
      if (this.phase === 'decision') {
        const map: Record<string, Choice> = { Digit1: 'first', Digit2: 'second', Digit3: 'third', Digit4: 'home', Space: 'hold' };
        const c = map[e.code];
        if (c) {
          e.preventDefault();
          this.decide(c);
        }
      } else if (this.phase === 'result' && e.code === 'KeyR') {
        this.restart();
      } else if (this.phase === 'briefing' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        this.difficulty = this.ui.selectedDifficulty;
        this.start();
      }
    });

    this.ui.onChoose = (c) => this.phase === 'decision' && this.decide(c);
    this.ui.onStart = (d) => {
      this.difficulty = d;
      this.start();
    };
    this.ui.onRestart = () => this.restart();
    this.ui.onBriefing = () => this.reset();
  }

  private pickByGaze() {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    let best: BaseId | null = null;
    let bestAngle = PICK_ANGLE;
    for (const id of Object.keys(BASES) as BaseId[]) {
      const dir = BASES[id].clone().setY(0.5).sub(this.camera.position).normalize();
      const a = dir.angleTo(fwd);
      if (a < bestAngle) {
        bestAngle = a;
        best = id;
      }
    }
    if (best) this.decide(best);
  }

  // ---------- 흐름 ----------

  reset() {
    this.phase = 'briefing';
    this.outcome = null;
    this.timeScale = 1;
    this.shownCalls.clear();
    for (const s of this.calls) this.scene.remove(s);
    this.calls = [];

    this.pitchKmh = Math.round(PITCH.minKmh + Math.random() * (PITCH.maxKmh - PITCH.minKmh));
    this.pitchFlight = RELEASE_POINT.distanceTo(CONTACT_POINT) / (this.pitchKmh / 3.6);
    this.runners = planRunners(this.scn);
    this.deadline = decisionDeadline(this.scn);
    this.t = -(PRE_PITCH + PITCH.windupTime + this.pitchFlight);

    const start = this.scn.fielders[this.scn.player];
    this.camera.position.copy(start).setY(EYE_HEIGHT);
    this.lookAtPoint(P(0, 2, 1.2));
    this.batterBat.visible = true;

    this.ui.showBriefing(this.scn, this.difficulty);
    this.ui.setHud(this.scn, this.pitchKmh);
    this.update(0);
  }

  private start() {
    this.ui.hideOverlays();
    this.phase = 'live';
    this.canvas.requestPointerLock?.()?.catch?.(() => {});
  }

  private restart() {
    this.reset();
    this.start();
  }

  private decide(choice: Choice, timedOut = false) {
    const d = this.t - GROUNDER.travelTime;
    this.reactionReal = (performance.now() - this.decisionRealStart) / 1000;
    this.outcome = evaluate(this.scn, choice, d, timedOut);
    this.phase = 'play';
    this.ui.hideDecision();

    const lastEvent = Math.max(0, ...this.outcome.events.map((e) => Math.max(e.ballTime, e.runnerTime)));
    const lastSeg = Math.max(0, ...this.outcome.segments.map((s) => s.t1));
    const lastRunner = Math.max(...this.runners.map((r) => r.arrival));
    this.playEnd = Math.max(lastEvent, lastSeg, lastRunner) + 1.2;
  }

  private finish() {
    this.phase = 'result';
    document.exitPointerLock?.();
    const o = this.outcome!;
    const g = grade(this.scn, o);
    const alternatives = (['first', 'second', 'third', 'home', 'hold'] as Choice[]).map((c) => evaluate(this.scn, c, o.decisionDelay));
    this.ui.showResult({
      scenario: this.scn,
      outcome: o,
      grade: g.grade,
      best: g.best,
      alternatives,
      reactionReal: this.reactionReal,
      timeScale: DIFFICULTIES.find((x) => x.id === this.difficulty)!.timeScale,
    });
  }

  // ---------- 매 프레임 ----------

  update(realDt: number) {
    const ds = DIFFICULTIES.find((x) => x.id === this.difficulty)!.timeScale;

    if (this.phase === 'live' || this.phase === 'decision' || this.phase === 'play') {
      // 결정 직후에는 슬로모션에서 실제 속도로 부드럽게 돌아온다
      const target = this.phase === 'decision' ? ds : 1;
      this.timeScale += (target - this.timeScale) * Math.min(1, realDt * (this.phase === 'decision' ? 12 : 3));
      this.t += realDt * this.timeScale;
    }

    if (this.phase === 'live' && this.t >= GROUNDER.travelTime) {
      this.t = GROUNDER.travelTime;
      this.phase = 'decision';
      this.decisionRealStart = performance.now();
      this.ui.showDecision();
    }
    if (this.phase === 'decision') {
      const d = this.t - GROUNDER.travelTime;
      this.ui.setDecisionTimer(1 - d / this.deadline);
      if (d >= this.deadline) this.decide('hold', true);
    }
    if (this.phase === 'play' && this.t >= this.playEnd) this.finish();

    this.animate(realDt);
    this.updateCamera();
    this.ui.updateBaseTags(this.camera, this.phase === 'decision');
  }

  private lookAtPoint(p: THREE.Vector3) {
    const d = p.clone().sub(this.camera.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  private updateCamera() {
    if (tvView) {
      // 디버그용 중계 시점: 홈 뒤 높은 곳에서 내야 전체를 본다
      this.camera.position.copy(P(0, -12, 14));
      this.camera.lookAt(P(0, 32, 0));
      return;
    }
    const t = this.t;
    const start = this.scn.fielders[this.scn.player];
    const u = THREE.MathUtils.clamp(t / GROUNDER.travelTime, 0, 1);
    const pos = start.clone().lerp(this.scn.catchPoint, easeInOut(u));
    // 포구 순간 살짝 낮게
    const dip = t > GROUNDER.travelTime - 0.4 && (this.phase === 'live' || this.phase === 'decision') ? 0.25 : 0;
    this.camera.position.set(pos.x, EYE_HEIGHT - dip, pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private animate(realDt: number) {
    const t = this.t;
    const scn = this.scn;
    const tRelease = -this.pitchFlight;
    const tWindup = tRelease - PITCH.windupTime;

    // 수비수
    for (const [id, m] of this.fielders) {
      const home = scn.fielders[id];
      if (id === 'C') {
        m.root.position.copy(home);
        faceTowards(m, MOUND_FACE);
        poseCrouch(m);
        continue;
      }
      if (id === 'P') {
        m.root.position.copy(home);
        faceTowards(m, BASES.home);
        if (t >= tWindup && t < tRelease + 0.3) poseThrow(m, THREE.MathUtils.clamp((t - tWindup) / PITCH.windupTime, 0, 1));
        else poseIdle(m, t > 0);
        continue;
      }
      const cover = (Object.keys(scn.covers) as BaseId[]).find((b) => scn.covers[b] === id && b !== 'home');
      const coversActive = cover && t > 0.2 && (cover === 'first' || cover === 'second');
      if (coversActive) {
        const bag = BASES[cover!].clone().add(cover === 'first' ? P(-0.35, 0) : P(0.35, -0.2)).setY(0);
        const total = home.distanceTo(bag);
        const moved = Math.min(total, (t - 0.2) * RUN.speed);
        m.root.position.copy(home).lerp(bag, total > 0 ? moved / total : 1);
        faceTowards(m, scn.catchPoint);
        // 2루수의 피벗 송구 동작
        const relay = this.outcome?.segments.find((s) => s.thrower === id);
        if (relay && t > relay.t0 - 0.3 && t < relay.t0 + 0.15) {
          faceTowards(m, BASES.first);
          poseThrow(m, THREE.MathUtils.clamp((t - (relay.t0 - 0.3)) / 0.3, 0, 1));
        } else if (moved < total) poseRun(m, realDt * this.timeScale, RUN.speed);
        else poseIdle(m, true);
      } else {
        m.root.position.copy(home);
        faceTowards(m, t > 0 ? scn.catchPoint : BASES.home);
        poseIdle(m, t > tWindup);
      }
    }

    // 타자와 주자
    for (const [id, m] of this.runnerModels) {
      const plan = this.runners.find((r) => r.id === id);
      if (!plan) {
        m.root.visible = false;
        continue;
      }
      const target = BASES[plan.to];
      const total = plan.from.distanceTo(target);
      const moved = THREE.MathUtils.clamp((t - plan.startTime) * RUN.speed, 0, total);
      m.root.position.copy(plan.from).lerp(target, moved / total);
      const out = this.outcome?.events.some((e) => e.runner === id && e.out && t >= e.ballTime);
      if (id === 'batter' && t < plan.startTime) {
        faceTowards(m, BASES.home.clone().add(P(0, 0.2)));
        poseIdle(m, true);
        // 스윙: 타격 직전 0.15초 동안 배트를 휘두른다
        const swing = THREE.MathUtils.clamp((t + 0.15) / 0.25, 0, 1);
        this.batterBat.rotation.set(-0.3, 0, 1.0 - swing * 2.6);
        m.body.rotation.y = -swing * 1.2;
      } else {
        if (id === 'batter') this.batterBat.visible = false;
        m.body.rotation.y = 0;
        faceTowards(m, target);
        if (moved > 0 && moved < total && !out) poseRun(m, realDt * this.timeScale, RUN.speed);
        else poseIdle(m, moved === 0);
      }
    }

    this.animateBall(t, tRelease);
    this.showCalls(t);
  }

  private animateBall(t: number, tRelease: number) {
    const pos = new THREE.Vector3();
    const o = this.outcome;
    const catchT = GROUNDER.travelTime;
    const gloveWorld = () =>
      tvView ? this.scn.catchPoint.clone().setY(1.0) : this.pocket.getWorldPosition(new THREE.Vector3());

    if (t < tRelease) {
      pos.copy(RELEASE_POINT);
    } else if (t < 0) {
      pos.lerpVectors(RELEASE_POINT, CONTACT_POINT, (t - tRelease) / this.pitchFlight);
    } else if (t < catchT) {
      const u = t / catchT;
      const end = this.scn.catchPoint.clone().setY(0.35);
      pos.lerpVectors(CONTACT_POINT, end, 1 - Math.pow(1 - u, 1.35));
      // 타격 높이에서 떨어진 뒤 점점 낮게 튀다가 마지막에 글러브 높이로
      const bounce = Math.abs(Math.sin(u * Math.PI * 3.2)) * 1.1 * Math.pow(1 - u, 1.6);
      const drop = Math.pow(1 - u, 8) * (CONTACT_POINT.y - 0.05);
      const scoop = THREE.MathUtils.smoothstep(u, 0.85, 1) * 0.3;
      pos.y = 0.05 + Math.max(bounce, drop) + scoop;
    } else if (!o || o.segments.length === 0 || t < o.segments[0].t0) {
      pos.copy(gloveWorld());
    } else {
      const seg = o.segments.find((s) => t >= s.t0 && t < s.t1);
      if (seg) {
        const u = (t - seg.t0) / (seg.t1 - seg.t0);
        pos.lerpVectors(seg.from, seg.to, u);
        pos.y += Math.sin(u * Math.PI) * seg.arc;
      } else {
        // 다음 송구를 기다리거나 마지막으로 받은 곳
        const done = o.segments.filter((s) => t >= s.t1);
        pos.copy(done[done.length - 1].to);
      }
    }
    this.ball.position.copy(pos);
    this.ballShadow.position.set(pos.x, 0.02, pos.z);
    this.ballShadow.visible = pos.y < 6;
  }

  private showCalls(t: number) {
    const o = this.outcome;
    if (!o) return;
    o.events.forEach((e, i) => {
      const when = e.out ? e.ballTime : e.runnerTime;
      if (t < when || this.shownCalls.has(i)) return;
      this.shownCalls.add(i);
      const sprite = nameSprite(e.out ? '아웃!' : '세이프', e.out ? '#ff5a4f' : '#5ad1ff');
      sprite.position.copy(BASES[e.base]).setY(3);
      sprite.scale.set(3.2, 0.8, 1);
      this.scene.add(sprite);
      this.calls.push(sprite);
      this.ui.toast(`${BASE_LABEL[e.base]} ${e.out ? '아웃' : '세이프'}`, e.out);
    });
  }
}

const MOUND_FACE = P(0, 18.44);

// 주소 끝에 ?view=tv를 붙이면 중계 시점으로 본다 (구장과 움직임 확인용)
const tvView = new URLSearchParams(location.search).get('view') === 'tv';

function easeInOut(u: number) {
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
}

