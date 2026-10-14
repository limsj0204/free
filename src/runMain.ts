import * as THREE from 'three';
import { P } from './coords';
import { buildField } from './field';
import { getDifficulty, getRunSkipIntro, setDifficulty } from './progress';
import { RunGame } from './runGame';
import { RunMenu } from './runMenu';
import { unlockAudio } from './sound';
import { UI } from './ui';

// 주루 판단 시뮬레이터 (runner.html). 내야 수비 시뮬레이터(main.ts)와 구장·선수·화면 부품을 같이 쓰는 별도 페이지다.

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

buildField(scene);
scene.add(camera);

// 브라우저는 사용자가 한 번 누르기 전에는 소리를 막는다
for (const ev of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(ev, () => unlockAudio(), { passive: true });
// 휴대폰에서 화면을 끌 때 페이지가 같이 움직이지 않게 한다
for (const ev of ['touchstart', 'touchmove', 'touchend'] as const) canvas.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

const ui = new UI();
const menu = new RunMenu();
let difficulty = getDifficulty();

function showMenu() {
  ui.hideAll();
  document.getElementById('hud')!.classList.add('hidden');
  menu.show(difficulty);
}

const game = new RunGame(scene, camera, canvas, ui, showMenu);
const begin = (id: string | null, scope: Parameters<RunGame['open']>[1]) => {
  menu.hide();
  game.difficulty = difficulty;
  game.open(id, scope);
};
menu.onPick = (id) => begin(id, null);
menu.onRandom = (scope) => begin(null, scope);
menu.onDifficulty = (d) => {
  difficulty = d;
  setDifficulty(d);
};
ui.onChoose = (v) => game.handle('choose', v as number);
ui.onStart = () => game.handle('start');
ui.onRestart = () => game.handle('restart');
ui.onReplay = () => game.handle('replay');
ui.onNext = () => game.handle('next');
ui.onMenu = () => game.handle('menu');

showMenu();
if (!getRunSkipIntro()) menu.showIntro();

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.05);
  if (!game.active) {
    // 목록 화면 뒤에는 구장을 내려다본다
    camera.position.copy(P(0, -12, 20));
    camera.lookAt(P(0, 26));
  }
  game.update(dt);
  renderer.render(scene, camera);
});
