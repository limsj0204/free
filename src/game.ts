import * as THREE from 'three';
import { DIFFICULTIES, PITCH, type DifficultyId } from './config';
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
import { addResult, getDifficulty, setDifficulty } from './progress';
import {
  THROW_CHOICES,
  evaluate,
  gradeThrow,
  isCarry,
  type Choice,
  type FielderId,
  type Outcome,
  type RunnerId,
  type Scenario,
} from './scenario';
import { SCENARIOS, fieldersOf } from './scenarios';
import {
  CONTACT_POINT,
  buildChoiceTimeline,
  buildThrowTimeline,
  movePosition,
  pathPosition,
  releasePoint,
  type Timeline,
} from './timeline';
import type { DecisionDef, UI } from './ui';

type Phase = 'menu' | 'briefing' | 'live' | 'decision' | 'play' | 'result' | 'replay';

const EYE_HEIGHT = 1.62;
const PICK_ANGLE = 0.3; // 시선으로 고를 때 허용 각도 (rad)
const REPLAY_SPEED = 0.6;
const FIELDER_IDS: FielderId[] = ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];
const RUNNER_IDS: RunnerId[] = ['batter', 'r1', 'r2', 'r3'];
const RUNNER_BASE: Record<Exclude<RunnerId, 'batter'>, 'first' | 'second' | 'third'> = { r1: 'first', r2: 'second', r3: 'third' };

// 주소 끝에 ?view=tv를 붙이면 처음부터 중계 시점으로 본다 (구장과 움직임 확인용)
const tvView = new URLSearchParams(location.search).get('view') === 'tv';

export class Game {
  private phase: Phase = 'menu';
  private scn: Scenario = SCENARIOS[0];
  private tl!: Timeline;
  private t = 0;
  private timeScale = 1;
  private difficulty: DifficultyId = getDifficulty();

  private pitchKmh = 120;
  private pitchFlight = 0.4;
  private decisionRealStart = 0;
  private reactionReal = 0;
  private decisionDelay = 0;
  private outcome: Outcome | null = null;
  private shownCalls = new Set<number>();
  private calls: THREE.Sprite[] = [];
  private defs: DecisionDef[] = [];

  private fielders = new Map<FielderId, Mannequin>();
  private runnerModels = new Map<RunnerId, Mannequin>();
  private bat: THREE.Group;
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private glove: THREE.Group;
  private pocket: THREE.Object3D;
  private marker: THREE.Group;

  private yaw = 0;
  private pitch = 0;
  private dragging = false;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private canvas: HTMLCanvasElement,
    private ui: UI,
  ) {
    for (const id of FIELDER_IDS) {
      const m = createMannequin(TEAM_DEFENSE);
      this.fielders.set(id, m);
      scene.add(m.root);
    }
    for (const id of RUNNER_IDS) {
      const m = createMannequin(TEAM_OFFENSE);
      this.runnerModels.set(id, m);
      scene.add(m.root);
    }

    // 타자의 배트
    this.bat = new THREE.Group();
    const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.018, 0.85, 8), new THREE.MeshLambertMaterial({ color: 0xd8b07a }));
    bat.position.y = 0.42;
    this.bat.add(bat);
    this.bat.position.set(-0.15, 0.55, 0.15);
    this.runnerModels.get('batter')!.body.add(this.bat);

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

    // 리플레이에서 내 선수를 알아보기 쉽게 발밑에 원과 이름표를 붙인다
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
    this.marker.visible = false;
    scene.add(this.marker);

    this.bindInput();
    this.prepare(this.scn);
    this.openMenu();
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
      if (this.phase === 'replay') {
        this.endReplay();
        return;
      }
      if (!this.playing) return;
      if (document.pointerLockElement === this.canvas) {
        if (this.phase === 'decision' && e.button === 0) this.pickByGaze();
        return;
      }
      this.dragging = true;
      this.lockPointer();
    });
    document.addEventListener('mouseup', () => (this.dragging = false));

    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (this.phase === 'decision') {
        const def = this.defs.find((d) => d.code === e.code);
        if (def) {
          e.preventDefault();
          this.choose(def.value);
        }
      } else if (this.phase === 'result') {
        if (e.code === 'KeyR') this.restart();
        else if (e.code === 'KeyV') this.replay();
        else if (e.code === 'KeyN') this.next();
        else if (e.code === 'Escape' || e.code === 'KeyM') this.openMenu();
      } else if (this.phase === 'briefing') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          this.start();
        } else if (e.code === 'Escape') this.openMenu();
      } else if (this.phase === 'replay' && (e.code === 'Escape' || e.code === 'Space')) {
        e.preventDefault();
        this.endReplay();
      }
    });

    this.ui.onChoose = (v) => this.phase === 'decision' && this.choose(v);
    this.ui.onPickScenario = (id) => this.openBriefing(SCENARIOS.find((s) => s.id === id)!);
    this.ui.onDifficulty = (d) => {
      this.difficulty = d;
      setDifficulty(d);
    };
    this.ui.onStart = () => this.start();
    this.ui.onRestart = () => this.restart();
    this.ui.onReplay = () => this.replay();
    this.ui.onNext = () => this.next();
    this.ui.onMenu = () => this.openMenu();
  }

  private get playing() {
    return this.phase === 'live' || this.phase === 'decision' || this.phase === 'play';
  }

  // 임베드된 화면 등에서는 포인터 잠금이 막힐 수 있다. 그때는 드래그로 시점을 돌린다.
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

  private pickByGaze() {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    let best: DecisionDef | null = null;
    let bestAngle = PICK_ANGLE;
    for (const d of this.defs) {
      if (!d.pos) continue;
      const dir = d.pos.clone().setY(0.5).sub(this.camera.position).normalize();
      const a = dir.angleTo(fwd);
      if (a < bestAngle) {
        bestAngle = a;
        best = d;
      }
    }
    if (best) this.choose(best.value);
  }

  // ---------- 흐름 ----------

  private prepare(scn: Scenario) {
    this.scn = scn;
    this.outcome = null;
    this.timeScale = 1;
    this.clearCalls();
    this.pitchKmh = Math.round(PITCH.minKmh + Math.random() * (PITCH.maxKmh - PITCH.minKmh));
    this.pitchFlight = releasePoint().distanceTo(CONTACT_POINT) / (this.pitchKmh / 3.6);
    this.tl = scn.kind === 'throw' ? buildThrowTimeline(scn, this.pitchFlight) : buildChoiceTimeline(scn, this.pitchFlight);
    this.t = this.tl.start;
    this.camera.position.copy(this.tl.playerStart).setY(EYE_HEIGHT);
    this.lookAtPoint(scn.kind === 'choice' && scn.setup === 'pickoff' ? P(0, 18.44, 1.2) : P(0, 1.2, 1.2));
    this.defs = this.decisionDefs();
    this.ui.setHud(scn, this.pitchKmh);
    this.update(0);
  }

  private decisionDefs(): DecisionDef[] {
    const scn = this.scn;
    if (scn.kind === 'throw') {
      const keys: Record<Choice, [string, string]> = {
        first: ['1', 'Digit1'],
        second: ['2', 'Digit2'],
        third: ['3', 'Digit3'],
        home: ['4', 'Digit4'],
        hold: ['Space', 'Space'],
      };
      return THROW_CHOICES.map((c) => ({
        value: c,
        key: keys[c][0],
        code: keys[c][1],
        label: c === 'hold' ? '들고 있기' : isCarry(scn, c) ? `${BASE_LABEL[c]} 직접 밟기` : BASE_LABEL[c],
        short: c === 'hold' ? '들고 있기' : BASE_LABEL[c],
        pos: c === 'hold' ? null : BASES[c as BaseId],
      }));
    }
    return scn.options.map((o, i) => ({
      value: i,
      key: String(i + 1),
      code: `Digit${i + 1}`,
      label: o.label,
      short: o.label,
      pos: o.moveTo,
    }));
  }

  openMenu() {
    if (this.phase !== 'briefing' && this.phase !== 'menu') this.prepare(this.scn);
    this.phase = 'menu';
    this.unlockPointer();
    this.ui.showMenu(this.scn.position, this.difficulty);
  }

  private openBriefing(scn: Scenario) {
    this.prepare(scn);
    this.phase = 'briefing';
    this.ui.showBriefing(scn);
  }

  private start() {
    this.ui.hideOverlays();
    this.phase = 'live';
    this.lockPointer();
  }

  private restart() {
    this.prepare(this.scn);
    this.start();
  }

  private next() {
    const i = SCENARIOS.indexOf(this.scn);
    this.openBriefing(SCENARIOS[(i + 1) % SCENARIOS.length]);
  }

  private choose(value: Choice | number, timedOut = false) {
    const d = Math.max(0, this.t - this.tl.decisionAt);
    this.decisionDelay = d;
    this.reactionReal = (performance.now() - this.decisionRealStart) / 1000;
    const scn = this.scn;
    if (scn.kind === 'throw') {
      this.outcome = evaluate(scn, value as Choice, d, timedOut);
      this.tl = buildThrowTimeline(scn, this.pitchFlight, this.outcome);
    } else {
      this.tl = buildChoiceTimeline(scn, this.pitchFlight, { index: timedOut ? null : (value as number), d });
    }
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
    const timeScale = DIFFICULTIES.find((x) => x.id === this.difficulty)!.timeScale;
    if (scn.kind === 'throw') {
      const o = this.outcome!;
      const g = gradeThrow(scn, o);
      if (record) addResult(scn.id, g.grade, o.decisionDelay);
      this.ui.showThrowResult({
        scenario: scn,
        outcome: o,
        grade: g.grade,
        best: g.best,
        alternatives: THROW_CHOICES.map((c) => evaluate(scn, c, o.decisionDelay)),
        reactionReal: this.reactionReal,
        timeScale,
      });
    } else {
      const c = this.tl.choice!;
      if (record) addResult(scn.id, c.grade, this.decisionDelay);
      this.ui.showChoiceResult({ scenario: scn, result: c, decisionAt: this.tl.decisionAt, decisionDelay: this.decisionDelay, reactionReal: this.reactionReal, timeScale });
    }
  }

  private replay() {
    this.phase = 'replay';
    this.clearCalls();
    this.ui.hideOverlays();
    this.ui.showReplayBanner(true);
    this.t = Math.max(this.tl.start, this.tl.tWindup - 0.6);
    if (this.scn.kind === 'choice' && (this.scn.setup === 'pickoff' || this.scn.setup === 'bunt')) {
      this.t = this.tl.decisionAt - 0.3;
    }
  }

  private endReplay() {
    this.ui.showReplayBanner(false);
    this.phase = 'result';
    this.showResult(false);
  }

  private clearCalls() {
    this.shownCalls.clear();
    for (const s of this.calls) this.scene.remove(s);
    this.calls = [];
  }

  // ---------- 매 프레임 ----------

  update(realDt: number) {
    const ds = DIFFICULTIES.find((x) => x.id === this.difficulty)!.timeScale;

    if (this.playing) {
      // 결정 직후에는 슬로모션에서 실제 속도로 부드럽게 돌아온다
      const target = this.phase === 'decision' ? ds : 1;
      this.timeScale += (target - this.timeScale) * Math.min(1, realDt * (this.phase === 'decision' ? 12 : 3));
      this.t += realDt * this.timeScale;
    } else if (this.phase === 'replay') {
      this.t += realDt * REPLAY_SPEED;
      if (this.t >= this.tl.end) this.endReplay();
    }

    if (this.phase === 'live' && this.t >= this.tl.decisionAt) {
      this.t = this.tl.decisionAt;
      this.phase = 'decision';
      this.decisionRealStart = performance.now();
      this.ui.showDecision(this.scn.kind === 'throw' ? '어디로 던질까?' : this.scn.prompt, this.defs);
    }
    if (this.phase === 'decision') {
      const d = this.t - this.tl.decisionAt;
      this.ui.setDecisionTimer(1 - d / this.tl.window);
      if (d >= this.tl.window) this.choose('hold', true);
    }
    if (this.phase === 'play' && this.t >= this.tl.end) this.finish();

    this.animate(realDt);
    this.updateCamera();
    this.ui.updateTags(this.camera, this.phase === 'decision' ? this.defs : null);
  }

  private lookAtPoint(p: THREE.Vector3) {
    const d = p.clone().sub(this.camera.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  private get overhead() {
    return tvView || this.phase === 'replay' || this.phase === 'menu';
  }

  private playerPos(t: number) {
    return movePosition(this.tl.playerStart, this.tl.player, t);
  }

  private updateCamera() {
    this.glove.visible = !this.overhead;
    if (this.overhead) {
      const wide = this.scn.kind === 'choice' && (this.scn.setup === 'gap' || this.scn.setup === 'cutoff');
      this.camera.position.copy(wide ? P(0, -22, 42) : P(0, -12, 20));
      this.camera.lookAt(wide ? P(0, 50) : P(0, 26));
      return;
    }
    const pos = this.playerPos(this.t);
    const catchT = this.scn.kind === 'throw' ? this.tl.decisionAt : -Infinity;
    const dip = this.t > catchT - 0.4 && this.t < catchT + 0.6 ? 0.25 : 0;
    this.camera.position.set(pos.x, EYE_HEIGHT - dip, pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private animate(realDt: number) {
    const t = this.t;
    const tl = this.tl;
    const scn = this.scn;
    const dt = realDt * (this.phase === 'replay' ? REPLAY_SPEED : this.timeScale);
    const home = fieldersOf(scn);
    const ballPos = this.ballPosition(t);
    const tmp = new THREE.Vector3();

    // 수비수
    for (const id of FIELDER_IDS) {
      const m = this.fielders.get(id)!;
      const isPlayer = id === scn.position;
      m.root.visible = !isPlayer || this.overhead;
      let moving = false;
      let dest: THREE.Vector3 | null = null;
      if (isPlayer) {
        const before = this.playerPos(t - 0.05).clone();
        m.root.position.copy(this.playerPos(t));
        this.marker.position.copy(m.root.position);
        this.marker.visible = this.overhead && this.phase !== 'menu';
        moving = before.distanceTo(m.root.position) > 0.01;
        if (moving) dest = m.root.position.clone().add(m.root.position.clone().sub(before));
      } else {
        const path = tl.fielders[id];
        if (path) {
          const r = pathPosition(path, t, tmp);
          m.root.position.copy(r.pos);
          moving = r.moving;
          if (moving) dest = path.waypoints[path.waypoints.length - 1];
        } else m.root.position.copy(home[id]);
      }

      const throwSeg = tl.ball.find((s) => s.thrower === id && t > s.t0 - 0.3 && t < s.t0 + 0.15);
      if (throwSeg) {
        faceTowards(m, throwSeg.to);
        poseThrow(m, THREE.MathUtils.clamp((t - (throwSeg.t0 - 0.3)) / 0.3, 0, 1));
      } else if (id === 'P' && tl.pitch && t >= tl.tWindup && t < tl.tRelease + 0.3) {
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

    // 타자와 주자
    for (const id of RUNNER_IDS) {
      const m = this.runnerModels.get(id)!;
      const path = tl.runners.get(id);
      if (id !== 'batter' && !path) {
        const base = RUNNER_BASE[id];
        m.root.visible = scn.situation.runners[base];
        if (m.root.visible) {
          m.root.position.copy(BASES[base]);
          faceTowards(m, BASES.home);
          poseIdle(m, true);
        }
        continue;
      }
      m.root.visible = true;
      if (id === 'batter' && (!path || t < path.startTime)) {
        this.poseBatter(m, t);
        continue;
      }
      if (id === 'batter') this.bat.visible = false;
      m.body.rotation.y = 0;
      const r = pathPosition(path!, t, tmp);
      m.root.position.copy(r.pos);
      if (r.moving) {
        faceTowards(m, nextWaypoint(path!, r.pos));
        poseRun(m, dt, 7);
      } else poseIdle(m, false);
    }

    this.ball.position.copy(ballPos);
    this.ballShadow.position.set(ballPos.x, 0.02, ballPos.z);
    this.ballShadow.visible = ballPos.y < 8;
    this.showCalls(t);
  }

  private poseBatter(m: Mannequin, t: number) {
    const box = P(this.scn.situation.batter === 'R' ? -0.9 : 0.9, 0);
    m.root.position.copy(box);
    faceTowards(m, BASES.home.clone().add(P(0, 0.2)));
    poseIdle(m, true);
    this.bat.visible = true;
    if (this.tl.batter === 'bunt') {
      // 번트 자세: 배트를 몸 앞에 눕힌다
      m.body.rotation.y = 0.9 * (this.scn.situation.batter === 'R' ? -1 : 1);
      this.bat.rotation.set(0, 0, Math.PI / 2);
    } else if (this.tl.batter === 'swing') {
      const swing = THREE.MathUtils.clamp((t + 0.15) / 0.25, 0, 1);
      this.bat.rotation.set(-0.3, 0, 1.0 - swing * 2.6);
      m.body.rotation.y = -swing * 1.2;
    } else {
      this.bat.rotation.set(-0.3, 0, 1.0);
      m.body.rotation.y = 0;
    }
  }

  private ballPosition(t: number): THREE.Vector3 {
    const tl = this.tl;
    const pos = new THREE.Vector3();
    if (tl.gloveHold && t >= tl.gloveHold[0] && t < tl.gloveHold[1]) {
      if (this.overhead) return this.playerPos(t).clone().setY(1.1);
      return this.pocket.getWorldPosition(pos);
    }
    const active = tl.ball.find((s) => t >= s.t0 && t < s.t1);
    if (active) {
      const u = (t - active.t0) / (active.t1 - active.t0);
      pos.lerpVectors(active.from, active.to, u);
      if (active.bounces) pos.y += Math.abs(Math.sin(u * Math.PI * active.bounces)) * active.arc * Math.pow(1 - u, 1.5);
      else pos.y += Math.sin(u * Math.PI) * active.arc;
      return pos;
    }
    const done = tl.ball.filter((s) => t >= s.t1);
    if (done.length === 0) return pos.copy(tl.ballStart);
    return pos.copy(done.reduce((a, b) => (b.t1 > a.t1 ? b : a)).to);
  }

  private showCalls(t: number) {
    this.tl.calls.forEach((c, i) => {
      if (t < c.t || this.shownCalls.has(i)) return;
      this.shownCalls.add(i);
      const sprite = nameSprite(c.text, c.good ? '#ff5a4f' : '#5ad1ff');
      sprite.position.copy(c.pos).setY(3);
      sprite.scale.set(3.2, 0.8, 1);
      this.scene.add(sprite);
      this.calls.push(sprite);
      if (this.phase !== 'replay') this.ui.toast(c.text, c.good);
    });
  }
}

function nextWaypoint(path: { waypoints: THREE.Vector3[] }, pos: THREE.Vector3) {
  // 현재 위치에서 가장 가까운 다음 지점을 향한다
  const wp = path.waypoints;
  for (let i = 0; i < wp.length - 1; i++) {
    const a = wp[i];
    const b = wp[i + 1];
    const ab = b.clone().sub(a);
    const len2 = ab.lengthSq();
    if (len2 === 0) continue;
    const u = pos.clone().sub(a).dot(ab) / len2;
    if (u < 0.999) return b;
  }
  return wp[wp.length - 1];
}
