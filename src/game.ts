import * as THREE from 'three';
import { ACTION, DIFFICULTIES, PITCH, RUN, THROW, type DifficultyId } from './config';
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
  poseSlide,
  poseStretch,
  poseTag,
  poseThrow,
  type Mannequin,
} from './players';
import { generatedFor, generatedScenarios } from './generated';
import { addResult, getDifficulty, getIncludeGenerated, getMode, getRecord, getSkipIntro, setDifficulty, setMode } from './progress';
import {
  THROW_CHOICES,
  altExec,
  evaluate,
  gradeThrow,
  followOptions,
  missOutcome,
  planRunners,
  type Follow,
  type ThrowExec,
  isCarry,
  runnerCalls,
  type Choice,
  type FielderId,
  FIELDER_NAME,
  type Outcome,
  type PositionId,
  type RunnerId,
  type Scenario,
} from './scenario';
import { SCENARIOS, fieldersOf } from './scenarios';
import {
  CONTACT_POINT,
  actionBallPos,
  buildActionThrowTimeline,
  buildChoiceTimeline,
  buildThrowTimeline,
  movePosition,
  pathPosition,
  releasePoint,
  type BasePlay,
  type Timeline,
} from './timeline';
import { sfx, unlockAudio } from './sound';
import { recordId, type DecisionDef, type UI } from './ui';

type Phase = 'menu' | 'briefing' | 'live' | 'decision' | 'play' | 'result' | 'replay';

const EYE_HEIGHT = 1.62;
const PICK_ANGLE = 0.3; // 시선으로 고를 때 허용 각도 (rad)
const TOUCH_LOOK = 2.7; // 휴대폰: 화면을 끄는 거리 대비 시점 회전 (마우스 감도의 배수). 화면을 잡아 끄는 느낌이라 마우스와 방향이 반대다
const TAP_RADIUS = 70; // 휴대폰: 베이스를 이 거리(px) 안에서 누르면 그곳을 고른다
const REPLAY_SPEED = 0.6;
const FOLLOW_WINDOW = 1.5; // 직접 밟은 뒤 이어 던질 곳을 고르는 시간 (게임 시간)
// 판단 키: 왼손 기본 줄(A S D)과 엄지(Space). 시간 안에 못 고르면 던지지 않은 것(hold)으로 처리한다.
// 물리 키(code) 기준이라 한글 입력 상태에서도 동작한다.
const DECISION_KEYS = ['A', 'S', 'D', 'F'];
const FIELDER_IDS: FielderId[] = ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];
const RUNNER_IDS: RunnerId[] = ['batter', 'r1', 'r2', 'r3'];
const RUNNER_BASE: Record<Exclude<RunnerId, 'batter'>, 'first' | 'second' | 'third'> = { r1: 'first', r2: 'second', r3: 'third' };

// 액션 모드에서 플레이어가 실제로 한 일
interface ActState {
  pos: THREE.Vector3; // 지금 위치
  track: { t: number; pos: THREE.Vector3 }[]; // 리플레이와 판정에 쓰는 이동 기록
  caughtT: number | null;
  caughtPos: THREE.Vector3 | null;
  prevBall: THREE.Vector3 | null;
  missed: boolean;
  exec?: ThrowExec;
  evalT: number; // 위치 판단: 이 시점의 위치로 판정한다
  // 커버 상황: 공을 잡은 수비수가 내 위치를 보고 던질 때를 정한다
  cover: { bag: THREE.Vector3; idx: number; ready: number; flight: number; last: number } | null;
  // 공을 든 채 베이스를 밟은 뒤 이어 던지기를 기다리는 중
  stepped: { base: BaseId; t: number; pos: THREE.Vector3 } | null;
  // 위치 판단: 커버로 받은 뒤 1루로 이어 던지기를 기다리는 중
  relay: { index: number; d: number; arrival?: number; at: number; now: number } | null;
  aimed: number; // 조준 중인 베이스 (defs 인덱스, 없으면 -1)
}

function newAct(pos: THREE.Vector3): ActState {
  return { pos: pos.clone(), track: [], caughtT: null, caughtPos: null, prevBall: null, missed: false, evalT: Infinity, aimed: -1, cover: null, stepped: null, relay: null };
}

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

// 점 p에서 선분 ab까지의 수평 거리
function distToSegmentXZ(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const u = len2 > 0 ? THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + abx * u), p.z - (a.z + abz * u));
}

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
  private panelShown = false; // 타격 순간부터 선택지를 띄워둔다
  private pending: Choice | number | null = null; // 공을 잡기 전에 미리 고른 선택
  private pendingReal = 0;
  private reactionReal = 0;
  private decisionDelay = 0;
  private outcome: Outcome | null = null;
  private soundT = -Infinity; // 효과음: 지난 프레임의 시간 (이 사이에 지나간 순간의 소리를 낸다)
  // 판단 모드: 직접 밟기를 골랐을 때, 밟은 뒤 이어 던질 곳을 고르는 두 번째 판단
  // kind 'cover': 위치 판단에서 커버로 받은 뒤 1루로 이어 던지기
  private follow: { kind: 'throw' | 'cover'; choice: Choice; index?: number; d: number; stepT: number; pending: Choice | null; pendingReal: number } | null = null;
  private shownCalls = new Set<number>();
  private calls: THREE.Sprite[] = [];
  private defs: DecisionDef[] = [];
  private randomPool: Scenario[] | null = null; // 랜덤 연습 중이면 고를 상황들
  private mode: 'judge' | 'action' = getMode();
  private keys = new Set<string>();
  // 방금 선택에 쓴 키. 떼기 전에는 같은 키로 다음 선택(예: 커버 A → 1루 송구 A)이 되지 않게 막는다
  private usedKey: { code: string; at: number } | null = null;
  private act: ActState = newAct(new THREE.Vector3());

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
    if (!getSkipIntro()) this.ui.showIntro();
  }

  // ---------- 입력 ----------

  private bindInput() {
    // 브라우저는 사용자가 한 번 누르기 전에는 소리를 막는다
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(ev, () => unlockAudio(), { passive: true });
    const look = (dx: number, dy: number) => {
      this.yaw -= dx * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.2, 1.0);
    };
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas || this.dragging) look(e.movementX, e.movementY);
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.phase === 'replay') {
        this.endReplay();
        return;
      }
      if (!this.playing) return;
      if (this.actionPlay) {
        // 액션 모드: 좌클릭은 송구, 마우스가 안 잠겼으면 우클릭 드래그로 시점을 돌린다
        if (e.button === 0) {
          if (document.pointerLockElement !== this.canvas) this.lockPointer();
          this.actionClick();
        } else if (e.button === 2) this.dragging = true;
        return;
      }
      if (document.pointerLockElement === this.canvas) {
        if (this.canChoose && e.button === 0) this.pickByGaze();
        return;
      }
      this.dragging = true;
      this.lockPointer();
    });
    document.addEventListener('mouseup', () => (this.dragging = false));

    // 휴대폰: 한 손가락으로 끌면 시점 회전, 짧게 누르면 그 근처 베이스(선택지)를 고른다. 마우스 조작과는 따로 동작한다.
    let touch: { id: number; x: number; y: number; sx: number; sy: number; t0: number; moved: boolean } | null = null;
    this.canvas.addEventListener(
      'touchstart',
      (e) => {
        const t = e.changedTouches[0];
        touch = { id: t.identifier, x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t0: performance.now(), moved: false };
        e.preventDefault();
      },
      { passive: false },
    );
    this.canvas.addEventListener(
      'touchmove',
      (e) => {
        const t = [...e.changedTouches].find((x) => x.identifier === touch?.id);
        if (!touch || !t) return;
        if (this.playing || this.phase === 'replay' || this.phase === 'result') look(-(t.clientX - touch.x) * TOUCH_LOOK, -(t.clientY - touch.y) * TOUCH_LOOK);
        touch.x = t.clientX;
        touch.y = t.clientY;
        if (Math.hypot(t.clientX - touch.sx, t.clientY - touch.sy) > 10) touch.moved = true;
        e.preventDefault();
      },
      { passive: false },
    );
    this.canvas.addEventListener(
      'touchend',
      (e) => {
        const t = [...e.changedTouches].find((x) => x.identifier === touch?.id);
        if (touch && t && !touch.moved && performance.now() - touch.t0 < 400) {
          if (this.phase === 'replay') this.endReplay();
          else this.tapAt(t.clientX, t.clientY);
        }
        touch = null;
        e.preventDefault();
      },
      { passive: false },
    );

    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (this.usedKey?.code === e.code) this.usedKey = null;
    });
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('keydown', (e) => {
      if (this.actionPlay && this.playing && MOVE_KEYS.includes(e.code)) {
        e.preventDefault();
        this.keys.add(e.code);
        return;
      }
      if (e.repeat) return;
      const def = this.canChoose ? this.defs.find((d) => d.code === e.code) : undefined;
      if (def) {
        e.preventDefault();
        // 한글 입력 상태 등에서 keydown이 한 번 더 오거나 keyup이 빠져도, 같은 키는 떼고 다시 눌러야(keyup이 안 오면 0.4초 뒤에야) 다음 선택이 된다
        const now = performance.now();
        if (this.usedKey?.code === e.code && now - this.usedKey.at < 400) return;
        this.usedKey = { code: e.code, at: now };
        this.input(def.value);
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

    this.ui.onChoose = (v) => this.canChoose && this.input(v);
    this.ui.onMode = (m) => {
      this.mode = m;
      setMode(m);
    };
    this.ui.onPickScenario = (id) => {
      this.setRandom(null);
      this.openBriefing(SCENARIOS.find((s) => s.id === id)!);
    };
    this.ui.onRandom = (scope) => {
      this.setRandom(scope);
      this.openBriefing(this.pickRandom());
    };
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

  private get canChoose() {
    if (this.actionPlay) return false;
    return this.phase === 'decision' || (this.phase === 'live' && this.panelShown) || (this.phase === 'play' && this.follow !== null);
  }

  private get tagsVisible() {
    if (!this.actionPlay) return this.canChoose;
    // 액션 모드: 송구는 공을 들고 있을 때, 위치 판단은 판정 전까지 갈 곳을 보여준다
    return this.scn.kind === 'throw' ? this.phase === 'decision' : (this.phase === 'live' && this.panelShown) || !!this.act.relay;
  }

  // 공을 잡기 전이면 미리 골라두고(잡는 순간 바로 실행), 잡은 뒤면 바로 결정한다
  private input(value: Choice | number) {
    sfx.click();
    if (this.follow) {
      // 이어 던질 곳: 밟은 뒤면 바로, 밟기 전이면 미리 골라둔다
      if (this.phase === 'decision') this.resolveFollow(value as Choice);
      else {
        this.follow.pending = value as Choice;
        this.follow.pendingReal = performance.now();
        this.ui.markPending(this.defs.findIndex((d) => d.value === value));
      }
      return;
    }
    if (this.phase === 'decision') {
      this.choose(value);
      return;
    }
    this.pending = value;
    this.pendingReal = performance.now();
    this.ui.markPending(this.defs.findIndex((d) => d.value === value));
  }

  // 액션 모드로 플레이하는지. 받는 쪽 판단(밟기/태그)은 액션 모드에서도 키로 고른다
  private get actionPlay() {
    return this.mode === 'action' && !(this.scn.kind === 'choice' && this.scn.setup === 'receive');
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

  // 휴대폰: 누른 곳에서 가장 가까운 선택지(베이스·갈 곳)를 고른다
  private tapAt(x: number, y: number) {
    if (this.actionPlay || !this.canChoose) return;
    const v = new THREE.Vector3();
    let best: DecisionDef | null = null;
    let bestDist = TAP_RADIUS;
    for (const d of this.defs) {
      if (!d.pos) continue;
      v.copy(d.pos).setY(0.3).project(this.camera);
      if (v.z > 1) continue;
      const dist = Math.hypot(((v.x + 1) / 2) * window.innerWidth - x, ((1 - v.y) / 2) * window.innerHeight - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    if (best) this.input(best.value);
  }

  private pickByGaze() {
    const i = this.aimedIndex();
    if (i >= 0) this.input(this.defs[i].value);
  }

  // ---------- 흐름 ----------

  private prepare(scn: Scenario) {
    this.scn = scn;
    this.outcome = null;
    this.panelShown = false;
    this.pending = null;
    this.follow = null;
    this.timeScale = 1;
    this.clearCalls();
    this.pitchKmh = Math.round(PITCH.minKmh + Math.random() * (PITCH.maxKmh - PITCH.minKmh));
    this.pitchFlight = releasePoint().distanceTo(CONTACT_POINT) / (this.pitchKmh / 3.6);
    const action = this.actionPlay;
    this.tl =
      scn.kind === 'throw'
        ? action
          ? buildActionThrowTimeline(scn, this.pitchFlight)
          : buildThrowTimeline(scn, this.pitchFlight)
        : buildChoiceTimeline(scn, this.pitchFlight);
    this.t = this.tl.start;
    this.soundT = this.t;
    this.keys.clear();
    this.act = newAct(this.tl.playerStart);
    if (action && scn.kind === 'choice') {
      // 맞는 위치에 제때 도착했는지는 공(송구)이 그곳에 가는 시점의 위치로 판정한다
      const bestIdx = Math.max(0, scn.options.findIndex((o) => o.grade === 'best'));
      const pre = buildChoiceTimeline(scn, this.pitchFlight, { index: bestIdx, d: 0 });
      // 커버는 조금 늦어도 공을 잡은 수비수가 기다려 주니, 주자가 들어오기 전까지의 위치로 판정한다
      const dl = pre.choice!.lastChance ?? pre.choice!.deadline;
      this.act.evalT = Number.isFinite(dl) ? dl : scn.setup === 'pickoff' ? pre.decisionAt + pre.window : 1.8;
      const pc = pre.choice!;
      if (pc.throwReady !== undefined && pc.flight !== undefined && pc.lastChance !== undefined) {
        this.act.cover = { bag: scn.options[bestIdx].moveTo, idx: bestIdx, ready: pc.throwReady, flight: pc.flight, last: pc.lastChance };
      }
    }
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
        first: [DECISION_KEYS[0], `Key${DECISION_KEYS[0]}`],
        second: [DECISION_KEYS[1], `Key${DECISION_KEYS[1]}`],
        third: [DECISION_KEYS[2], `Key${DECISION_KEYS[2]}`],
        home: ['Space', 'Space'],
        hold: ['W', 'KeyW'],
      };
      const action = this.actionPlay;
      return THROW_CHOICES.filter((c) => c !== 'hold').map((c) => ({
        value: c,
        key: action ? '' : keys[c][0],
        code: keys[c][1],
        label: !action && isCarry(scn, c) ? `${BASE_LABEL[c]} ${planRunners(scn).some((r) => r.kind === 'advance' && r.target === c) ? '직접 태그' : '직접 밟기'}` : BASE_LABEL[c],
        short: BASE_LABEL[c],
        pos: BASES[c as BaseId],
      }));
    }
    // 베이스로 가는 선택지는 송구와 같은 키(1루 A, 2루 S, 3루 D)를 쓰고, 나머지는 남는 키를 앞에서부터 받는다
    const keyOf: number[] = [];
    const used = new Set<number>();
    scn.options.forEach((o, i) => {
      const k = (['first', 'second', 'third'] as const).findIndex((b) => Math.hypot(o.moveTo.x - BASES[b].x, o.moveTo.z - BASES[b].z) < 3);
      if (k >= 0 && !used.has(k)) {
        keyOf[i] = k;
        used.add(k);
      }
    });
    // 베이스 위는 아니어도 그 베이스 쪽 플레이(예: 3루 뒤 백업)면 그 베이스 키를 쓴다
    scn.options.forEach((o, i) => {
      if (keyOf[i] !== undefined) return;
      const k = ['1루', '2루', '3루'].findIndex((b) => o.label.startsWith(b));
      if (k >= 0 && !used.has(k)) {
        keyOf[i] = k;
        used.add(k);
      }
    });
    scn.options.forEach((_, i) => {
      if (keyOf[i] !== undefined) return;
      const k = DECISION_KEYS.findIndex((_, j) => !used.has(j));
      keyOf[i] = k;
      used.add(k);
    });
    return scn.options
      .map((o, i) => ({
        value: i,
        key: this.actionPlay ? '' : DECISION_KEYS[keyOf[i]],
        code: `Key${DECISION_KEYS[keyOf[i]]}`,
        label: o.label,
        short: o.label,
        pos: o.moveTo,
      }))
      .sort((a, b) => DECISION_KEYS.indexOf(a.code.slice(3)) - DECISION_KEYS.indexOf(b.code.slice(3)));
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
    if (this.randomPool) {
      this.openBriefing(this.pickRandom());
      return;
    }
    const i = SCENARIOS.indexOf(this.scn);
    this.openBriefing(SCENARIOS[(i + 1) % SCENARIOS.length]);
  }

  private setRandom(scope: PositionId | 'all' | null) {
    const gen = scope === null || !getIncludeGenerated() ? [] : scope === 'all' ? generatedScenarios() : generatedFor(scope);
    this.randomPool = scope === null ? null : [...SCENARIOS.filter((s) => scope === 'all' || s.position === scope), ...gen];
    this.ui.randomLabel = scope === null ? null : scope === 'all' ? '전체 랜덤' : `${FIELDER_NAME[scope]} 랜덤`;
  }

  // 방금 한 상황은 빼고, 아직 최선의 판단을 못 한 상황이 두 배 더 잘 나오게 고른다
  private pickRandom(): Scenario {
    const pool = this.randomPool!;
    const cands = pool.length > 1 ? pool.filter((s) => s !== this.scn) : pool;
    const weights = cands.map((s) => (getRecord(recordId(s.id))?.best === 'best' ? 1 : 2));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) {
      r -= weights[i];
      if (r <= 0) return cands[i];
    }
    return cands[cands.length - 1];
  }

  private choose(value: Choice | number, timedOut = false, decidedAtReal = performance.now()) {
    const d = Math.max(0, this.t - this.tl.decisionAt);
    this.decisionDelay = d;
    this.reactionReal = Math.max(0, (decidedAtReal - this.decisionRealStart) / 1000);
    const scn = this.scn;
    if (scn.kind === 'throw') {
      const choice = value as Choice;
      const opts = timedOut ? [] : followOptions(scn, choice, d);
      if (opts.length) {
        // 직접 밟기: 밟기까지만 진행하고, 밟은 뒤 이어 던질 곳을 한 번 더 고른다
        this.outcome = evaluate(scn, choice, d, false, undefined, { to: null, d: 0 });
        this.tl = buildThrowTimeline(scn, this.pitchFlight, this.outcome);
        const carry = this.outcome.segments.find((s) => s.carry);
        this.follow = { kind: 'throw', choice, d, stepT: carry ? carry.t1 : this.t, pending: null, pendingReal: 0 };
        this.defs = this.followDefs(opts);
        this.phase = 'play';
        this.ui.showDecision(`${BASE_LABEL[choice as BaseId]} 밟은 다음 어디로?`, this.defs, []);
        this.ui.setDecisionTimer(1);
        return;
      }
      this.outcome = evaluate(scn, choice, d, timedOut);
      this.tl = buildThrowTimeline(scn, this.pitchFlight, this.outcome);
    } else {
      const index = timedOut ? null : (value as number);
      this.tl = buildChoiceTimeline(scn, this.pitchFlight, { index, d, relay: { to: null, d: 0 } });
      const relayAt = this.tl.choice?.relayAt;
      if (index !== null && relayAt !== undefined) {
        // 커버로 받으면 1루로 이어 던질지 고른다 (받기 전에 미리 골라둘 수 있다)
        this.follow = { kind: 'cover', choice: 'first', index, d, stepT: relayAt, pending: null, pendingReal: 0 };
        this.defs = this.relayDefs();
        this.phase = 'play';
        this.ui.showDecision('받은 다음 어디로?', this.defs, []);
        this.ui.setDecisionTimer(1);
        return;
      }
    }
    this.phase = 'play';
    this.ui.hideDecision();
  }

  // 커버로 받은 뒤 이어 던질 곳 (지금은 1루 병살만)
  private relayDefs(): DecisionDef[] {
    return [{ value: 'first', key: DECISION_KEYS[0], code: `Key${DECISION_KEYS[0]}`, label: '1루 송구', short: '1루', pos: BASES.first }];
  }

  private resolveFollow(to: Choice, timedOut = false) {
    const scn = this.scn;
    const f = this.follow;
    if (!f) return;
    const d2 = timedOut ? FOLLOW_WINDOW : Math.max(0, this.t - f.stepT);
    if (scn.kind === 'choice') {
      this.tl = buildChoiceTimeline(scn, this.pitchFlight, { index: f.index!, d: f.d, relay: { to: timedOut || to === 'hold' ? 'none' : (to as BaseId), d: d2 } });
      this.follow = null;
      this.defs = this.decisionDefs();
      this.phase = 'play';
      this.ui.hideDecision();
      return;
    }
    this.outcome = evaluate(scn, f.choice, f.d, false, undefined, { to, d: d2 });
    this.tl = buildThrowTimeline(scn, this.pitchFlight, this.outcome);
    this.follow = null;
    this.defs = this.decisionDefs();
    this.phase = 'play';
    this.ui.hideDecision();
  }

  // 이어 던질 곳 선택지: 키는 처음 판단과 같다 (A/S/D 1·2·3루, Space 홈)
  private followDefs(opts: Choice[]): DecisionDef[] {
    return this.decisionDefs()
      .filter((d) => opts.includes(d.value as Choice))
      .map((d) => ({ ...d, label: `${BASE_LABEL[d.value as BaseId]} 송구` }));
  }

  private finish() {
    this.phase = 'result';
    this.unlockPointer();
    this.showResult(true);
  }

  private showResult(record: boolean) {
    const scn = this.scn;
    const action = this.actionPlay;
    const timeScale = action ? ACTION.speeds[this.difficulty] : DIFFICULTIES.find((x) => x.id === this.difficulty)!.timeScale;
    if (scn.kind === 'throw') {
      const o = this.outcome!;
      const exec = action ? this.act.exec : undefined;
      const g = gradeThrow(scn, o, exec, action && this.act.missed);
      if (record) {
        addResult(recordId(scn.id), g.grade, o.decisionDelay);
        sfx.result(g.grade === 'best');
      }
      this.ui.showThrowResult({
        scenario: scn,
        outcome: o,
        verdict: g,
        alternatives: THROW_CHOICES.filter((c) => c !== 'hold').map((c) => evaluate(scn, c, o.decisionDelay, false, altExec(exec))),
        reactionReal: this.reactionReal,
        timeScale,
      });
    } else {
      const c = this.tl.choice!;
      if (record) {
        addResult(recordId(scn.id), c.grade, this.decisionDelay);
        sfx.result(c.grade === 'best');
      }
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
    this.soundT = this.t;
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

    if (this.playing && this.actionPlay) {
      // 액션 모드는 플레이 전체 속도가 일정하다
      this.timeScale = ACTION.speeds[this.difficulty];
      this.t += realDt * this.timeScale;
    } else if (this.playing) {
      // 결정 직후에는 슬로모션에서 실제 속도로 부드럽게 돌아온다
      const target = this.phase === 'decision' ? ds : 1;
      this.timeScale += (target - this.timeScale) * Math.min(1, realDt * (this.phase === 'decision' ? 12 : 3));
      this.t += realDt * this.timeScale;
    } else if (this.phase === 'replay') {
      this.t += realDt * REPLAY_SPEED;
      if (this.t >= this.tl.end) this.endReplay();
    }

    const scn = this.scn;
    // 타격 순간(도루·투구 전 판단은 판단 시점)부터 선택지를 띄워서 미리 읽고 고를 수 있게 한다
    const showAt = scn.kind === 'throw' ? 0 : Math.min(this.tl.decisionAt, 0);
    if (this.actionPlay) {
      this.updateAction(realDt * this.timeScale, showAt);
    } else if (this.phase === 'live' && !this.panelShown && this.t >= showAt) {
      this.panelShown = true;
      this.decisionRealStart = performance.now();
      this.ui.revealHud(scn);
      this.ui.showDecision(scn.kind === 'throw' ? '공을 잡으면 어디로?' : scn.prompt, this.defs, scn.kind === 'throw' ? runnerCalls(scn) : []);
      this.ui.setDecisionTimer(1);
    }
    if (!this.actionPlay && this.phase === 'live' && this.t >= this.tl.decisionAt) {
      this.t = this.tl.decisionAt;
      if (this.pending !== null) {
        // 미리 골라뒀으면 잡자마자 던진다 (판단 시간 0초)
        this.choose(this.pending, false, this.pendingReal);
      } else {
        this.phase = 'decision';
        this.decisionRealStart = performance.now();
        if (scn.kind === 'throw') this.ui.setDecisionTitle('어디로 던질까?');
      }
    }
    if (this.follow && this.phase === 'play' && this.t >= this.follow.stepT) {
      // 베이스를 밟았다: 미리 골라뒀으면 바로 던지고, 아니면 슬로모션으로 고른다
      this.t = this.follow.stepT;
      if (this.follow.pending !== null) this.resolveFollow(this.follow.pending);
      else {
        this.phase = 'decision';
        this.ui.setDecisionTitle('어디로 이어 던질까?');
      }
    }
    if (!this.actionPlay && this.phase === 'decision') {
      if (this.follow) {
        const d2 = this.t - this.follow.stepT;
        this.ui.setDecisionTimer(1 - d2 / FOLLOW_WINDOW);
        if (d2 >= FOLLOW_WINDOW) this.resolveFollow('hold', true);
      } else {
        const d = this.t - this.tl.decisionAt;
        this.ui.setDecisionTimer(1 - d / this.tl.window);
        if (d >= this.tl.window) this.choose('hold', true);
      }
    }
    if (this.phase === 'play' && !this.follow && !this.act.relay && this.t >= this.tl.end) this.finish();

    this.playSounds();
    this.animate(realDt);
    this.updateCamera();
    this.ui.updateTags(this.camera, this.tagsVisible ? this.defs : null);
  }

  // ---------- 액션 모드 ----------

  private updateAction(dt: number, showAt: number) {
    const scn = this.scn;
    const t = this.t;
    const act = this.act;
    if (!this.playing) return;

    // 이동: 타격 직전부터. 투구 때 판단하는 상황(도루, 견제, 번트)은 판단 시점부터.
    const prePlay = scn.kind === 'choice' && (scn.setup === 'pickoff' || scn.setup === 'bunt' || scn.setup === 'steal');
    if (t >= (prePlay ? this.tl.decisionAt : -0.3)) this.moveAction(dt);
    act.track.push({ t, pos: act.pos.clone() });

    if (this.phase === 'live' && !this.panelShown && t >= showAt) {
      this.panelShown = true;
      this.decisionRealStart = performance.now();
      this.ui.revealHud(scn);
      const title = scn.kind === 'throw' ? '공이 오는 곳으로 가서 잡으세요' : `${scn.prompt} 직접 뛰어가세요`;
      this.ui.showDecision(title, this.defs, scn.kind === 'throw' ? runnerCalls(scn) : [], false);
      this.ui.setDecisionTimer(1);
    }

    if (scn.kind === 'choice' && act.relay && this.phase === 'play') {
      // 커버로 받은 뒤: 1루를 조준하고 좌클릭. 너무 오래 들고 있으면 안 던진 것으로 본다.
      act.aimed = this.aimedIndex();
      this.ui.setAim(act.aimed);
      this.ui.setDecisionTimer(1 - Math.max(0, t - act.relay.at) / FOLLOW_WINDOW);
      if (t - act.relay.at >= FOLLOW_WINDOW) this.resolveActionRelay('none');
      return;
    }
    if (scn.kind === 'choice') {
      if (this.phase !== 'live') return;
      const c = act.cover;
      if (c && t >= c.ready) {
        // 공을 잡은 수비수가 나를 보고 던진다: 송구와 같이 도착할 만큼 가까우면 지금 던지고,
        // 주자보다 먼저 못 들어올 것 같으면 기다리지 않는다 (커버가 안 오면 그냥 던져서 빠진다)
        const dist = Math.max(0, Math.hypot(act.pos.x - c.bag.x, act.pos.z - c.bag.z) - ACTION.choiceRadius);
        const eta = t + dist / RUN.fielderSpeed;
        if (dist / RUN.fielderSpeed <= c.flight) {
          const reached = act.track.find((s) => Math.hypot(s.pos.x - c.bag.x, s.pos.z - c.bag.z) <= ACTION.choiceRadius);
          this.resolveActionChoice({ index: c.idx, arrival: reached ? reached.t : eta });
          return;
        }
        if (eta > c.last) {
          this.resolveActionChoice();
          return;
        }
      }
      if (t >= act.evalT) this.resolveActionChoice();
      return;
    }

    const hit = this.tl.actionHit!;
    if (this.phase === 'live' && t >= 0) {
      const now = actionBallPos(hit, t);
      const prev = act.prevBall ?? now.clone();
      act.prevBall = now.clone();
      const maxH = scn.batted.type === 'liner' ? ACTION.linerCatchHeight : ACTION.catchHeight;
      if (distToSegmentXZ(act.pos, prev, now) < ACTION.catchRadius && Math.min(prev.y, now.y) < maxH) {
        // 잡았다
        act.caughtT = t;
        act.caughtPos = act.pos.clone();
        sfx.glove();
        hit.caughtAt = t;
        this.tl.gloveHold = [t, Infinity];
        this.phase = 'decision';
        this.decisionRealStart = performance.now();
        this.ui.setDecisionTitle('베이스를 조준하고 좌클릭 (포스면 밟기, 아니면 주자 태그)');
      } else if (t > hit.travelTime + 1.2) {
        this.actionMiss();
      }
    }

    if (this.phase === 'decision' && act.caughtT !== null && act.stepped) {
      // 밟은 뒤: 조준만 하고 좌클릭을 기다린다. 시간이 지나면 던지지 않은 것으로 본다.
      act.aimed = this.aimedIndex();
      this.ui.setAim(act.aimed);
      const held = t - act.stepped.t;
      this.ui.setDecisionTimer(1 - held / FOLLOW_WINDOW);
      if (held >= FOLLOW_WINDOW) this.resolveStepFollow('hold');
      return;
    }
    if (this.phase === 'decision' && act.caughtT !== null) {
      // 조준: 화면 가운데에 가장 가까운 베이스
      act.aimed = this.aimedIndex();
      this.ui.setAim(act.aimed);
      const plans = planRunners(scn);
      // 공을 든 채 포스가 아닌 주자에게 다가가면 태그. 포스 주자는 베이스를 밟는 쪽이 낫다(병살로 이어짐).
      for (const r of plans) {
        const path = this.tl.runners.get(r.id);
        if (r.kind !== 'advance' || !path || t >= r.arrival || t < path.startTime) continue;
        const rp = pathPosition(path, t, new THREE.Vector3()).pos;
        if (Math.hypot(act.pos.x - rp.x, act.pos.z - rp.z) < ACTION.catchRadius) {
          this.resolveActionThrow(r.target, { tagT: t, tagRunner: r.id, releasePos: act.pos.clone() });
          return;
        }
      }
      // 포스 상황(또는 직선타 귀루)인 베이스만 밟아서 아웃시킬 수 있다. 그 밖의 베이스는 주자를 태그해야 한다.
      for (const b of ['first', 'second', 'third', 'home'] as BaseId[]) {
        const forced = plans.some((r) => (r.kind === 'force' || r.kind === 'return') && r.target === b);
        if (forced && Math.hypot(act.pos.x - BASES[b].x, act.pos.z - BASES[b].z) < ACTION.stepRadius) {
          const exec: ThrowExec = { catchPos: act.caughtPos!, catchT: act.caughtT, stepT: t, releasePos: act.pos.clone() };
          if (followOptions(scn, b, Math.max(0, t - act.caughtT), exec).length) {
            // 밟은 뒤에도 공을 들고 있다: 이어서 던질 곳을 조준하고 좌클릭
            act.stepped = { base: b, t, pos: act.pos.clone() };
            this.ui.setDecisionTitle(`${BASE_LABEL[b]} 밟았어요! 이어 던질 곳을 조준하고 좌클릭`);
            return;
          }
          this.resolveActionThrow(b, { stepT: t, releasePos: act.pos.clone() });
          return;
        }
      }
      const held = t - act.caughtT;
      this.ui.setDecisionTimer(1 - held / this.tl.window);
      if (held >= this.tl.window) this.resolveActionThrow('hold', {}, true);
    }
  }

  private moveAction(dt: number) {
    const k = this.keys;
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    if (!f && !r) return;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const dir = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).normalize();
    this.act.pos.addScaledVector(dir, RUN.fielderSpeed * dt);
    // 경기장 밖으로 나가지 않게
    const p = this.act.pos;
    const dist = Math.hypot(p.x, p.z);
    if (dist > 110) p.multiplyScalar(110 / dist);
    p.z = Math.max(p.z, -12);
    p.y = 0;
  }

  // 화면 가운데(조준점)와 좌우 방향이 가장 가까운 대상. 위아래 각도는 따지지 않는다.
  private aimedIndex() {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.setY(0).normalize();
    let best = -1;
    let bestAngle = PICK_ANGLE;
    this.defs.forEach((d, i) => {
      if (!d.pos) return;
      const to = d.pos.clone().sub(this.camera.position).setY(0);
      if (to.lengthSq() < 0.01) return;
      const a = to.normalize().angleTo(fwd);
      if (a < bestAngle) {
        bestAngle = a;
        best = i;
      }
    });
    return best;
  }

  private actionClick() {
    if (this.act.relay) {
      const i = this.aimedIndex();
      if (i < 0) {
        this.ui.toast('던질 베이스를 조준하세요', false);
        return;
      }
      this.resolveActionRelay(this.defs[i].value as BaseId);
      return;
    }
    if (this.scn.kind !== 'throw' || this.phase !== 'decision' || this.act.caughtT === null) return;
    const i = this.aimedIndex();
    if (i < 0) {
      this.ui.toast('던질 베이스를 조준하세요', false);
      return;
    }
    if (this.act.stepped) {
      if (this.defs[i].value === this.act.stepped.base) return;
      this.resolveStepFollow(this.defs[i].value as Choice);
      return;
    }
    this.resolveActionThrow(this.defs[i].value as Choice, { releasePos: this.act.pos.clone(), releaseT: this.t + THROW.transferTime });
  }

  // 밟은 뒤 이어 던지기 (to가 hold면 시간 초과로 안 던짐)
  private resolveStepFollow(to: Choice) {
    const s = this.act.stepped!;
    const follow: Follow = { to, d: Math.max(0, this.t - s.t), releaseT: Math.max(s.t + THROW.pivotTime, this.t + THROW.transferTime), from: this.act.pos.clone() };
    this.act.stepped = null;
    this.resolveActionThrow(s.base, { stepT: s.t, releasePos: s.pos }, false, follow);
  }

  private resolveActionThrow(choice: Choice, part: Partial<ThrowExec>, timedOut = false, follow?: Follow) {
    const scn = this.scn;
    if (scn.kind !== 'throw') return;
    const act = this.act;
    const exec: ThrowExec = { catchPos: act.caughtPos!, catchT: act.caughtT!, ...part };
    act.exec = exec;
    const d = Math.max(0, (part.stepT ?? this.t) - act.caughtT!);
    this.decisionDelay = d;
    this.reactionReal = (performance.now() - this.decisionRealStart) / 1000;
    this.outcome = evaluate(scn, choice, d, timedOut, exec, follow);
    this.tl = buildActionThrowTimeline(scn, this.pitchFlight, this.outcome, act.caughtT);
    this.phase = 'play';
    this.ui.hideDecision();
  }

  private actionMiss() {
    const scn = this.scn;
    if (scn.kind !== 'throw') return;
    this.act.missed = true;
    this.decisionDelay = 0;
    this.reactionReal = 0;
    this.outcome = missOutcome(scn);
    this.tl = buildActionThrowTimeline(scn, this.pitchFlight);
    this.tl.end = this.t + 2.5;
    this.phase = 'play';
    this.ui.hideDecision();
    this.ui.toast('공이 빠졌어요!', false);
  }

  private resolveActionChoice(pick?: { index: number; arrival: number }) {
    const scn = this.scn;
    if (scn.kind !== 'choice') return;
    const act = this.act;
    // 지금 가장 가까운 선택지 위치에 있으면 그곳을 고른 것으로 본다
    let index: number | null = null;
    let bestDist = ACTION.choiceRadius;
    scn.options.forEach((o, i) => {
      const dd = Math.hypot(act.pos.x - o.moveTo.x, act.pos.z - o.moveTo.z);
      if (dd <= bestDist) {
        bestDist = dd;
        index = i;
      }
    });
    const start = this.tl.playerStart;
    const moved = act.track.find((s) => s.t >= this.tl.decisionAt - 1 && s.pos.distanceTo(start) > 0.5);
    const d = moved ? Math.max(0, moved.t - this.tl.decisionAt) : 0;
    let arrival: number | undefined;
    if (pick) {
      index = pick.index;
      arrival = pick.arrival;
    } else if (index !== null) {
      const target = scn.options[index].moveTo;
      const reached = act.track.find((s) => Math.hypot(s.pos.x - target.x, s.pos.z - target.z) <= ACTION.choiceRadius);
      arrival = reached ? reached.t : this.t;
    }
    this.decisionDelay = d;
    this.reactionReal = (performance.now() - this.decisionRealStart) / 1000;
    this.tl = buildChoiceTimeline(scn, this.pitchFlight, { index, d, arrival, now: this.t, relay: { to: null, d: 0 } });
    this.phase = 'play';
    const relayAt = this.tl.choice?.relayAt;
    if (index !== null && relayAt !== undefined) {
      // 커버로 받으면 공을 들고 있다가 1루를 조준하고 좌클릭해서 병살을 노린다
      act.relay = { index, d, arrival, at: relayAt, now: this.t };
      this.defs = this.relayDefs();
      this.ui.showDecision('받으면 1루를 조준하고 좌클릭', this.defs, [], false);
      this.ui.setDecisionTimer(1);
      return;
    }
    this.ui.hideDecision();
  }

  // 커버로 받은 뒤 이어 던지기 (받기 직전에 눌러도 받자마자 던진다)
  private resolveActionRelay(to: BaseId | 'none') {
    const scn = this.scn;
    const r = this.act.relay;
    if (scn.kind !== 'choice' || !r) return;
    const releaseT = Math.max(r.at + THROW.pivotTime, this.t + THROW.transferTime);
    this.tl = buildChoiceTimeline(scn, this.pitchFlight, { index: r.index, d: r.d, arrival: r.arrival, now: r.now, relay: { to, d: Math.max(0, this.t - r.at), releaseT } });
    this.act.relay = null;
    this.defs = this.decisionDefs();
    this.ui.hideDecision();
  }

  // 이동 기록에서 t 시점의 위치
  private trackPos(t: number) {
    const tr = this.act.track;
    if (t <= tr[0].t) return tr[0].pos.clone();
    if (t >= tr[tr.length - 1].t) return tr[tr.length - 1].pos.clone();
    let lo = 0;
    let hi = tr.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tr[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = tr[lo];
    const b = tr[hi];
    return a.pos.clone().lerp(b.pos, b.t > a.t ? (t - a.t) / (b.t - a.t) : 0);
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
    if (this.actionPlay && this.act.track.length) {
      const last = this.act.track[this.act.track.length - 1].t;
      if (this.playing && t >= last) return this.act.pos.clone();
      return this.trackPos(t);
    }
    return movePosition(this.tl.playerStart, this.tl.player, t);
  }

  private updateCamera() {
    this.glove.visible = !this.overhead;
    if (this.overhead) {
      const wide = this.scn.kind === 'choice' && (this.scn.setup === 'gap' || this.scn.setup === 'cutoff' || this.scn.setup === 'backup');
      // 폭투는 홈 뒤쪽에서 플레이가 벌어지니 외야 쪽에서 홈을 내려다본다
      if (this.scn.kind === 'choice' && this.scn.setup === 'wildpitch') {
        this.camera.position.copy(P(0, 34, 24));
        this.camera.lookAt(P(0, 2));
        return;
      }
      this.camera.position.copy(wide ? P(0, -22, 42) : P(0, -12, 20));
      this.camera.lookAt(wide ? P(0, 50) : P(0, 26));
      return;
    }
    const pos = this.playerPos(this.t);
    const catchT = this.scn.kind === 'throw' && !this.actionPlay ? this.tl.decisionAt : -Infinity;
    let dip = this.t > catchT - 0.4 && this.t < catchT + 0.6 ? 0.25 : 0;
    // 내가 직접 태그하면 몸을 숙이고 글러브를 아래로, 포스면 글러브를 앞으로 뻗는다
    const play = this.activePlay('player', this.t);
    const w = play ? Math.sin(THREE.MathUtils.clamp((this.t - play.t + 0.3) / 0.75, 0, 1) * Math.PI) : 0;
    if (play?.kind === 'tag') {
      dip = Math.max(dip, 0.45 * w);
      this.glove.position.set(-0.42 + 0.27 * w, -0.3 - 0.45 * w, -0.8 + 0.1 * w);
      this.glove.rotation.set(0.2 + 0.9 * w, 0.3, 0.25);
    } else if (play) {
      this.glove.position.set(-0.42 + 0.12 * w, -0.3 + 0.08 * w, -0.8 - 0.25 * w);
      this.glove.rotation.set(0.2, 0.3, 0.25);
    } else {
      this.glove.position.set(-0.42, -0.3, -0.8);
      this.glove.rotation.set(0.2, 0.3, 0.25);
    }
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
      const play = this.activePlay(isPlayer ? 'player' : id, t);
      if (throwSeg) {
        faceTowards(m, throwSeg.to);
        poseThrow(m, THREE.MathUtils.clamp((t - (throwSeg.t0 - 0.3)) / 0.3, 0, 1));
      } else if (play?.kind === 'tag') {
        // 태그: 들어오는 주자 쪽으로 몸을 숙여 글러브를 댄다
        const runner = this.runnerModels.get(play.runner)!.root.position;
        faceTowards(m, runner.distanceTo(m.root.position) > 0.3 ? runner : ballPos);
        poseTag(m);
      } else if (play) {
        // 포스아웃: 베이스를 밟고 송구 쪽으로 쭉 뻗는다
        const seg = tl.ball.find((s) => s.t1 <= play.t + 0.05 && s.t1 > play.t - 1.5 && s.to.distanceTo(BASES[play.base].clone().setY(s.to.y)) < 0.5);
        faceTowards(m, seg ? seg.from : ballPos);
        poseStretch(m);
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
      const slide = tl.plays.find((p) => p.kind === 'tag' && p.runner === id && t > p.t - 0.35 && t < p.t + (p.out ? 0.7 : 0.4));
      if (slide && r.pos.distanceTo(BASES[slide.base]) < 3.5) {
        // 태그 플레이: 주자가 베이스로 슬라이딩한다
        faceTowards(m, BASES[slide.base]);
        poseSlide(m);
      } else if (r.moving) {
        faceTowards(m, nextWaypoint(path!, r.pos));
        poseRun(m, dt, 7);
      } else poseIdle(m, false);
    }

    this.ball.position.copy(ballPos);
    this.ballShadow.position.set(ballPos.x, 0.02, ballPos.z);
    this.ballShadow.visible = ballPos.y < 8;
    this.showCalls(t);
  }

  // t 시점에 베이스에서 공을 받거나 태그하고 있는 플레이
  private activePlay(receiver: BasePlay['receiver'], t: number): BasePlay | undefined {
    return this.tl.plays.find((p) => p.receiver === receiver && t > p.t - (p.kind === 'tag' ? 0.3 : 0.2) && t < p.t + 0.45);
  }

  // 지난 프레임과 이번 프레임 사이에 지나간 순간(타격, 송구, 포구)의 소리를 낸다
  private playSounds() {
    const a = this.soundT;
    const b = this.t;
    this.soundT = b;
    if (!(this.playing || this.phase === 'replay') || b <= a) return;
    const tl = this.tl;
    const crossed = (x: number) => a < x && x <= b;
    if (crossed(0)) {
      if (tl.batter === 'swing') sfx.bat();
      else if (tl.batter === 'bunt') sfx.bat(true);
      else if (tl.pitch) sfx.glove(); // 타자가 안 치면 포수 미트에
    }
    for (const s of tl.ball) {
      if (!s.thrower) continue;
      if (crossed(s.t0)) sfx.whoosh();
      // 받는 사람 없이 뒤로 빠지는 공은 글러브 소리가 나지 않는다
      const passed = tl.ball.some((n) => !n.thrower && Math.abs(n.t0 - s.t1) < 0.01 && n.from.distanceTo(s.to) < 0.5);
      if (crossed(s.t1) && !passed) sfx.glove();
    }
    // 판단 모드에서 내가 타구를 잡는 순간 (액션 모드는 실제로 잡을 때 따로 낸다)
    if (this.scn.kind === 'throw' && !this.actionPlay && crossed(tl.decisionAt) && tl.decisionAt > 0) sfx.glove();
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
    // 내가 투수면 던지기 전까지 공은 내 글러브 안에 있다
    if (this.scn.position === 'P' && tl.pitch && t < tl.tRelease && !this.overhead) return this.pocket.getWorldPosition(pos);
    const hit = tl.actionHit;
    if (hit && t >= 0 && (hit.caughtAt === null || t < hit.caughtAt)) return actionBallPos(hit, t, pos);
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
      if (c.good && c.text.includes('아웃')) sfx.out();
      else if (!c.good) sfx.safe();
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
