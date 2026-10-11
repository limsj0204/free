import * as THREE from 'three';
import { P } from './coords';
import type { Situation } from './scenario';
import type { OutfieldHit, OutfielderId, RunMe, RunScenario } from './runner';
import { generatedGroundScenarios, groundBasic } from './runGround';

// 주루 판단 상황. 기본 상황은 해설을 직접 쓰고, 생성 상황은 타구 × 아웃 카운트(땅볼은 타구 × 주자 × 아웃)를 조합한다. 외야수 어깨는 모두 같다.
// 최선은 판정 엔진이 기대 득점으로 계산한다.

type Hit = OutfieldHit;

interface Profile {
  key: string;
  name: string; // 제목에 쓰는 타구 이름 (예: 우전 안타)
  fielder: OutfielderId;
  hit: Hit;
}

const grounder = (field: THREE.Vector3, fieldT: number, release: Hit['release']): Hit => ({ type: 'grounder', field, fieldT, release });
const liner = (land: THREE.Vector3, landT: number, field: THREE.Vector3, fieldT: number, release: Hit['release']): Hit => ({
  type: 'liner',
  land: { pos: land, t: landT },
  field,
  fieldT,
  release,
});
// 뜬공: 잡힐 확률과, 안 잡히면 외야수가 공을 줍는 곳·시간 (기본: 조금 뒤로 튄 공을 1초 뒤에 줍는다)
const fly = (field: THREE.Vector3, fieldT: number, release: Hit['release'], catchProb = 0.97, drop?: { field: THREE.Vector3; t: number }): Hit => ({
  type: 'fly',
  field,
  fieldT,
  release,
  catchProb,
  drop: drop ?? { field: field.clone().add(field.clone().setY(0).normalize().multiplyScalar(4)), t: fieldT + 1.0 },
});

// 단타: 1루 주자는 3루까지, 2루 주자는 홈까지 노린다
const SINGLES: Profile[] = [
  { key: 'rf', name: '우전 안타', fielder: 'RF', hit: grounder(P(23, 56), 3.0, 'charging') },
  { key: 'rf-liner', name: '우전 라이너 안타', fielder: 'RF', hit: liner(P(20, 50), 1.1, P(24, 59), 2.4, 'charging') },
  { key: 'rf-line', name: '우익선 쪽 안타', fielder: 'RF', hit: grounder(P(33, 62), 3.4, 'standing') },
  { key: 'rc', name: '우중간 안타', fielder: 'RF', hit: liner(P(14, 66), 1.5, P(17, 78), 3.7, 'standing') },
  { key: 'cf', name: '중전 안타', fielder: 'CF', hit: grounder(P(1, 60), 3.3, 'charging') },
  { key: 'cf-liner', name: '중전 라이너 안타', fielder: 'CF', hit: liner(P(-3, 56), 1.2, P(-4, 64), 2.5, 'charging') },
  { key: 'lc', name: '좌중간 쪽 안타', fielder: 'CF', hit: grounder(P(-13, 67), 3.6, 'standing') },
  { key: 'lf', name: '좌전 안타', fielder: 'LF', hit: grounder(P(-21, 54), 2.9, 'charging') },
  { key: 'lf-line', name: '좌익선 쪽 안타', fielder: 'LF', hit: grounder(P(-31, 61), 3.4, 'standing') },
];

// 타자 주자: 2루까지 노릴 만한 타구와, 1루에서 멈춰야 하는 타구
const STRETCH: Profile[] = [
  { key: 'lc-gap', name: '좌중간 안타', fielder: 'LF', hit: liner(P(-15, 70), 1.6, P(-21, 87), 5.0, 'back') },
  { key: 'rc-gap', name: '우중간 안타', fielder: 'RF', hit: liner(P(15, 70), 1.6, P(21, 87), 5.0, 'back') },
  { key: 'lf-line', name: '좌익선 안타', fielder: 'LF', hit: grounder(P(-40, 82), 4.6, 'back') },
  { key: 'rf-line', name: '우익선 안타', fielder: 'RF', hit: grounder(P(40, 82), 4.6, 'back') },
  { key: 'lf', name: '좌전 안타', fielder: 'LF', hit: grounder(P(-21, 56), 2.9, 'charging') },
  { key: 'cf', name: '중전 안타', fielder: 'CF', hit: grounder(P(1, 62), 3.1, 'charging') },
  { key: 'rf', name: '우전 안타', fielder: 'RF', hit: grounder(P(23, 58), 3.0, 'charging') },
];

// 3루 주자 태그업 (홈 승부)
const FLIES_HOME: Profile[] = [
  { key: 'lf-short', name: '얕은 좌익수 플라이', fielder: 'LF', hit: fly(P(-20, 55), 3.5, 'charging') },
  { key: 'lf-mid', name: '좌익수 플라이', fielder: 'LF', hit: fly(P(-24, 64), 3.9, 'standing') },
  { key: 'lf-deep', name: '좌익수 깊은 플라이', fielder: 'LF', hit: fly(P(-30, 82), 4.5, 'back') },
  { key: 'cf-short', name: '얕은 중견수 플라이', fielder: 'CF', hit: fly(P(0, 58), 3.6, 'charging') },
  { key: 'cf-mid', name: '중견수 플라이', fielder: 'CF', hit: fly(P(0, 68), 3.9, 'standing') },
  { key: 'cf-deep', name: '중견수 깊은 플라이', fielder: 'CF', hit: fly(P(2, 88), 4.7, 'back') },
  { key: 'rf-short', name: '얕은 우익수 플라이', fielder: 'RF', hit: fly(P(20, 55), 3.5, 'charging') },
  { key: 'rf-mid', name: '우익수 플라이', fielder: 'RF', hit: fly(P(24, 64), 3.9, 'standing') },
  { key: 'rf-deep', name: '우익수 깊은 플라이', fielder: 'RF', hit: fly(P(30, 82), 4.5, 'back') },
  // 잡힐지 모르는 타구: 외야수 앞에 떨어지는 빗맞은 타구, 외야 사이로 깊게 뻗는 타구
  { key: 'lf-bloop', name: '좌익수 앞 빗맞은 타구', fielder: 'LF', hit: fly(P(-16, 47), 3.0, 'charging', 0.4, { field: P(-18, 52), t: 4.2 }) },
  { key: 'cf-bloop', name: '중견수 앞 빗맞은 타구', fielder: 'CF', hit: fly(P(0, 50), 3.1, 'charging', 0.4, { field: P(0, 55), t: 4.3 }) },
  { key: 'rf-bloop', name: '우익수 앞 빗맞은 타구', fielder: 'RF', hit: fly(P(16, 47), 3.0, 'charging', 0.4, { field: P(18, 52), t: 4.2 }) },
  { key: 'lc-gap', name: '좌중간 깊은 타구', fielder: 'CF', hit: fly(P(-17, 84), 4.7, 'back', 0.5, { field: P(-22, 95), t: 7.0 }) },
  { key: 'rc-gap', name: '우중간 깊은 타구', fielder: 'CF', hit: fly(P(17, 84), 4.7, 'back', 0.5, { field: P(22, 95), t: 7.0 }) },
];

// 2루 주자 태그업 (3루 승부): 깊은 플라이만. 우익수 쪽일수록 3루까지 멀다.
const FLIES_THIRD: Profile[] = [
  { key: 'lf-mid', name: '좌익수 플라이', fielder: 'LF', hit: fly(P(-27, 72), 4.0, 'standing') },
  { key: 'lf-deep', name: '좌익수 깊은 플라이', fielder: 'LF', hit: fly(P(-32, 89), 4.6, 'back') },
  { key: 'cf-mid', name: '중견수 플라이', fielder: 'CF', hit: fly(P(0, 78), 4.1, 'standing') },
  { key: 'cf-deep', name: '중견수 깊은 플라이', fielder: 'CF', hit: fly(P(3, 94), 4.8, 'back') },
  { key: 'rf-mid', name: '우익수 플라이', fielder: 'RF', hit: fly(P(27, 72), 4.0, 'standing') },
  { key: 'rf-deep', name: '우익수 깊은 플라이', fielder: 'RF', hit: fly(P(32, 89), 4.6, 'back') },
];

const OUTS_LABEL = ['무사', '1사', '2사'];
const BASE_OF: Record<RunMe, string> = { batter: '주자 없음', r1: '1루', r2: '2루', r3: '3루' };

function situationOf(me: RunMe, outs: number): Situation {
  return { outs, runners: { first: me === 'r1', second: me === 'r2', third: me === 'r3' }, batter: 'R' };
}

function titleOf(me: RunMe, outs: number, name: string) {
  return `${OUTS_LABEL[outs]} ${BASE_OF[me]} / ${name}`;
}

function briefOf(kind: RunScenario['kind'], me: RunMe, outs: number) {
  if (kind === 'fly') {
    const base = me === 'r1' ? '1루' : me === 'r2' ? '2루' : '3루';
    return `${base} 주자예요. 외야로 공이 뜨면 먼저 베이스로 돌아갈지(태그업 준비), 하프웨이로 나갈지, 스타트할지 정해요. 베이스를 밟고 있다가 공이 잡히면 태그업 판단이 이어져요.`;
  }
  if (me === 'batter') return '타자예요. 안타를 치고 1루를 돌면서 2루까지 갈지 정해요.';
  const run = me === 'r1' ? '2루를 돌면서 3루까지' : '3루를 돌면서 홈까지';
  const start = me === 'r2' && outs < 2 ? ' 2아웃이 아니라서 타구가 빠지는 걸 보고 출발해요.' : outs === 2 ? ' 2아웃이라 타격과 동시에 출발해요.' : '';
  return `${me === 'r1' ? '1루' : '2루'} 주자예요. 외야로 안타가 나오면 ${run} 갈지 정해요.${start}`;
}

function make(kind: RunScenario['kind'], me: RunMe, outs: number, p: Profile, extra: Partial<RunScenario> = {}): RunScenario {
  return {
    id: `run-${kind}-${me}-${p.key}-${outs}`,
    kind,
    title: titleOf(me, outs, p.name),
    event: p.name,
    me,
    situation: situationOf(me, outs),
    fielder: p.fielder,
    hit: p.hit,
    brief: briefOf(kind, me, outs),
    generated: true,
    ...extra,
  };
}

function buildGenerated(): RunScenario[] {
  const out: RunScenario[] = [];
  for (const p of SINGLES) for (const o of [0, 1, 2]) out.push(make('extra', 'r1', o, p));
  for (const p of SINGLES) for (const o of [0, 1, 2]) out.push(make('extra', 'r2', o, p));
  for (const p of STRETCH) for (const o of [0, 1, 2]) out.push(make('extra', 'batter', o, p));
  for (const me of ['r1', 'r2', 'r3'] as RunMe[])
    for (const p of FLIES_HOME)
      for (const o of [0, 1, 2]) {
        // 2아웃에 거의 잡히는 플라이는 답(스타트)이 매번 같아서 뺀다 (잡힐지 모르는 타구만 남긴다)
        if (o === 2 && (p.hit.catchProb ?? 1) >= 0.9) continue;
        out.push(make('fly', me, o, p));
      }
  for (const p of FLIES_THIRD) for (const o of [0, 1]) out.push({ ...make('fly', 'r2', o, p), id: `run-fly-r2-deep-${p.key}-${o}` });
  out.push(...generatedGroundScenarios());
  return out;
}

let generated: RunScenario[] | null = null;
export function generatedRunScenarios() {
  return (generated ??= buildGenerated());
}

const pick = (list: Profile[], key: string) => list.find((p) => p.key === key)!;

// 기본 상황: 타구와 아웃 카운트에 따라 판단이 갈리는 대표적인 장면
const BASICS: RunScenario[] = [
  {
    ...make('extra', 'r1', 1, pick(SINGLES, 'rc')),
    id: 'run-r1-rc',
    generated: false,
    explanation:
      '1루 주자가 3루까지 노려볼 수 있는 건 우익수 쪽 타구일 때뿐이에요. 우익수는 3루까지 가장 멀고, 우중간 타구는 옆으로 뛰어가 잡아서 바로 던지기도 어려워요. 우중간 깊숙이 가는 타구면 3루까지 가요. ' +
      '1아웃에서 3루에 있으면 안타가 아니어도 플라이나 땅볼로 점수가 나요. 그래서 1사 1루에서 1루→3루는 가장 가치 있는 주루예요.',
  },
  {
    ...make('extra', 'r1', 0, pick(SINGLES, 'lf')),
    id: 'run-r1-lf',
    generated: false,
    explanation:
      '좌익수 앞 안타에 1루 주자가 3루를 노리면, 좌익수는 3루까지 가깝고 앞으로 오면서 잡아 바로 던져요. 거의 다 아웃이에요. ' +
      '좌익수 쪽 단타면 2루에서 멈추는 게 기본이에요. 무사 1, 2루도 충분히 좋은 기회예요.',
  },
  {
    ...make('extra', 'r1', 2, pick(SINGLES, 'rf-line')),
    id: 'run-r1-2out',
    generated: false,
    explanation:
      '2아웃에서 1루→3루는 얻는 게 적어요. 2루에 있어도 다음 안타 하나면 2아웃이라 타격과 동시에 뛰어서 홈까지 들어올 수 있거든요. ' +
      '반대로 3루에서 아웃되면 이닝이 끝나요. "3루에서 첫 번째와 세 번째 아웃은 당하지 마라"는 말이 여기서 나와요. 확실할 때만 가세요.',
  },
  {
    ...make('extra', 'r1', 0, pick(SINGLES, 'lc')),
    id: 'run-r1-cf',
    generated: false,
    explanation:
      '중견수가 잡는 단타면 1루 주자는 2루에서 멈춰요. 좌중간 쪽으로 옆걸음해서 잡아도 중견수에서 3루까지는 우익수보다 훨씬 가깝고, 2루를 돌 때쯤이면 이미 공이 중견수 글러브에 들어가 있어요. ' +
      '1루→3루는 우익수 쪽 타구에서만 생각하세요.',
  },
  {
    ...make('extra', 'r2', 2, pick(SINGLES, 'lc')),
    id: 'run-r2-2out',
    generated: false,
    explanation:
      '2아웃 2루에서는 타격과 동시에 뛰어요. 공이 잡히면 어차피 이닝이 끝나니까요. 그래서 안타가 나오면 이미 3루 가까이 와 있어요. ' +
      '홈에서 아웃돼도 잃는 게 적고(2아웃 1, 3루도 점수가 나기 어려워요), 세이프면 1점이에요. 중견수가 옆으로 움직여 잡는 타구라면 홈으로 가세요. 다만 중견수 정면으로 빨리 오는 타구는 2아웃이어도 홈에서 잡혀요.',
  },
  {
    ...make('extra', 'r2', 0, pick(SINGLES, 'lf')),
    id: 'run-r2-lf',
    generated: false,
    explanation:
      '2아웃이 아니면 2루 주자는 타구가 내야를 빠져나가는 걸 보고 출발해서 조금 늦어요. 게다가 좌익수가 앞으로 오면서 잡으면 홈까지 가까워서 홈에서 거의 잡혀요. ' +
      '무사 1, 3루는 땅볼이나 플라이로도 점수가 나는 좋은 기회예요. 무리해서 홈에서 아웃될 필요가 없어요.',
  },
  {
    ...make('extra', 'r2', 1, pick(SINGLES, 'rf')),
    id: 'run-r2-rf',
    generated: false,
    explanation:
      '2아웃이 아니면 2루 주자는 타구가 내야를 빠져나가는 걸 보고 출발해서, 2아웃일 때보다 한발 늦어요. 우익수가 앞으로 오면서 잡으면 홈은 무리예요. ' +
      '1사 1, 3루면 땅볼이나 플라이로도 점수가 나요. 결과 화면의 세이프 확률과 "이 확률보다 높아야 이득"을 비교해 보세요. 그 차이가 판단의 근거예요.',
  },
  {
    ...make('extra', 'batter', 0, pick(STRETCH, 'lc-gap')),
    id: 'run-b-gap',
    generated: false,
    explanation:
      '좌중간을 가르는 타구는 외야수가 뒤로 뛰어가 잡아서, 몸을 돌려 던지기까지 오래 걸려요. 1루를 크게 돌면서 외야수가 공을 잡는 모습을 보고 바로 2루로 가세요. ' +
      '2루에 가면 다음 안타 하나로 홈까지 올 수 있는 득점권이에요.',
  },
  {
    ...make('extra', 'batter', 1, pick(STRETCH, 'lf')),
    id: 'run-b-lf',
    generated: false,
    explanation:
      '좌익수 정면으로 가는 단타는 좌익수가 앞으로 오면서 잡아 2루로 바로 던져요. 1루를 돌면서 공이 잡히는 걸 보고 멈추세요. ' +
      '1루를 돌 때 크게 돌아 두면 수비가 공을 더듬을 때 바로 2루로 갈 수 있어요.',
  },
  {
    ...make('fly', 'r3', 1, pick(FLIES_HOME, 'cf-mid')),
    id: 'run-t3-1out',
    generated: false,
    explanation:
      '1아웃에서 플라이가 잡히면 2아웃이 돼요. 3루에 남아 있으면 다음 타자가 안타를 쳐야만 점수가 나요(2사 3루의 기대 득점은 0.35점 정도). ' +
      '그래서 1아웃 3루의 희생플라이는 세이프 확률이 낮아도 뛰는 게 이득이에요. 공이 글러브에 들어가는 순간 출발하세요.',
  },
  {
    ...make('fly', 'r3', 0, pick(FLIES_HOME, 'cf-mid')),
    id: 'run-t3-0out',
    generated: false,
    explanation:
      '바로 앞의 1아웃 상황과 같은 타구, 같은 중견수예요. 무사라면 판단이 달라져요. 잡혀도 1사 3루라 다음 타자의 땅볼이나 플라이로도 점수가 나요. ' +
      '홈에서 아웃되면 2사 주자 없음이 되니, 아슬아슬하면 3루에 머무는 게 나아요.',
  },
  {
    ...make('fly', 'r3', 0, pick(FLIES_HOME, 'lf-short')),
    id: 'run-t3-short',
    generated: false,
    explanation:
      '얕은 플라이는 외야수가 앞으로 뛰어오면서 잡아서, 그 기세로 바로 홈에 던져요. 홈까지 거리도 짧아서 태그업하면 거의 아웃이에요. 3루에 머무세요.',
  },
  {
    ...make('fly', 'r2', 0, pick(FLIES_THIRD, 'rf-mid')),
    id: 'run-t2-rf',
    generated: false,
    explanation:
      '우익수 플라이면 아주 깊지 않아도 2루 주자가 태그업해서 3루까지 갈 수 있어요. 우익수에서 3루는 외야에서 가장 먼 송구예요. ' +
      '무사 2루가 1사 3루가 되면 다음 타자의 땅볼이나 플라이로도 점수가 나요.',
  },
  {
    ...make('fly', 'r2', 1, pick(FLIES_THIRD, 'cf-mid')),
    id: 'run-t2-1out',
    generated: false,
    explanation:
      '1아웃에서 잡히면 2아웃이에요. 2아웃 3루와 2아웃 2루는 거의 같아요. 2아웃이면 플라이로 점수가 안 나고, 어차피 안타가 나와야 하는데 2루 주자도 안타면 홈에 들어오니까요. ' +
      '얻는 건 거의 없는데 3루에서 아웃되면 이닝이 끝나요. 세이프가 거의 확실할 때만 가세요.',
  },
  // ---------- 플라이: 타구 판단 ----------
  {
    ...make('fly', 'r1', 0, pick(FLIES_HOME, 'cf-mid')),
    id: 'run-f1-half',
    generated: false,
    explanation:
      '1루 주자는 외야 플라이에 태그업해도 2루까지 가기 어려워요(2루까지 멀고 외야수가 2루로 던지기 쉬워요). 그래서 하프웨이로 나가 있는 게 기본이에요. ' +
      '잡히면 여유 있게 돌아오고, 떨어지면 2루까지 쉽게 가요. 베이스로 돌아가도 크게 손해는 아니지만, 스타트하면 잡혔을 때 돌아오지 못해 더블아웃이에요.',
  },
  {
    ...make('fly', 'r1', 1, pick(FLIES_HOME, 'cf-bloop')),
    id: 'run-f1-bloop',
    generated: false,
    explanation:
      '빗맞은 타구가 외야수 앞으로 떨어질지 모를 때는 하프웨이예요. 이때 베이스로 돌아가 버리면, 공이 떨어졌을 때 타자가 1루로 오니 2루까지 가야 하는데(포스) 출발이 늦어서 2루에서 잡혀요. ' +
      '1루 주자가 태그업을 하는 건 깊은 플라이일 때뿐이에요.',
  },
  {
    ...make('fly', 'r2', 0, pick(FLIES_HOME, 'rc-gap')),
    id: 'run-f2-gap0',
    generated: false,
    explanation:
      '깊은 타구라 하프웨이와 베이스로(태그업 준비) 둘 다 할 수 있는 판단이에요. 하프웨이면 떨어졌을 때 바로 홈까지 가고, 태그업 준비면 잡혔을 때 3루까지 가요. ' +
      '무사라면 태그업 준비가 조금 더 나아요. 잡혀도 1사 3루가 되면 다음 타자의 땅볼이나 플라이로도 점수가 나서, 태그업으로 3루에 가는 가치가 크거든요.',
  },
  {
    ...make('fly', 'r2', 1, pick(FLIES_HOME, 'rc-gap')),
    id: 'run-f2-gap1',
    generated: false,
    explanation:
      '바로 앞과 같은 타구인데 1아웃이에요. 이번에도 하프웨이와 태그업 준비 둘 다 좋은 판단이지만, 이번엔 하프웨이가 조금 더 나아요. ' +
      '잡히면 2아웃이 돼서 태그업으로 3루에 가도 얻는 게 적어요(2사 3루와 2사 2루는 거의 같아요. 둘 다 안타가 나와야 점수가 나요). 그래서 떨어졌을 때 홈까지 들어오는 쪽에 무게를 둬요.',
  },
  {
    ...make('fly', 'r2', 2, pick(FLIES_HOME, 'rc-gap')),
    id: 'run-f2-2out',
    generated: false,
    explanation:
      '2아웃이면 공이 잡히는 순간 이닝이 끝나서, 베이스로 돌아갈 이유가 없어요. 타격과 동시에 스타트하세요. 떨어지면 그만큼 한 베이스를 더 가요.',
  },
  // ---------- 땅볼: 진루 판단 ----------
  groundBasic('run-g1-forced', 'SS', 'front', 'r1', ['first'], 0,
    '1루 주자는 땅볼이 나오면 무조건 2루로 뛰어야 해요. 타자가 1루로 오니 1루를 비워 줘야 하거든요(포스, 의무 진루). ' +
    '병살이 될 것 같아도 돌아갈 곳이 없어요. 최대한 빨리 2루로 가서 병살을 깨는 게 주자의 일이에요.'),
  groundBasic('run-g12-forced', '3B', 'front', 'r2', ['first', 'second'], 1,
    '1루에 주자가 있으면 2루 주자도 포스예요. 1루 주자가 2루로 오니 2루를 비워 줘야 해요. 타구가 내 앞(3루 쪽)으로 와도 3루로 뛰어야 해요. ' +
    '포스인지는 "내 뒤 베이스가 다 차 있는지"로 판단해요.'),
  groundBasic('run-g2-front', 'SS', 'front', 'r2', ['second'], 0,
    '1루가 비어 있으면 2루 주자는 포스가 아니에요. 2루에 남아도 돼요. 타구가 내 앞(유격수·3루수 쪽)으로 오면 뛰는 순간 3루로 던져서 잡혀요. ' +
    '공이 내야를 빠져나가거나 1루로 송구되는 걸 확인하고 움직이세요.'),
  groundBasic('run-g2-behind', '1B', 'front', 'r2', ['second'], 0,
    '타구가 내 뒤(1루수 쪽)로 가면 진루해요. 1루수는 1루를 밟거나 1루로 던지는 게 쉽고, 3루까지는 멀어요. ' +
    '아웃 하나를 주고 주자를 3루로 보내는 진루타가 돼서, 무사 2루가 1사 3루로 바뀌어요.'),
  groundBasic('run-g3-front', 'SS', 'front', 'r3', ['third'], 0,
    '3루 주자도 1루가 비어 있으면 포스가 아니에요. 내야 정면 땅볼에 홈으로 뛰면 홈에서 잡혀요. 3루에 남아 다음 타자에게 기회를 넘기세요.'),
  groundBasic('run-g13-dp', '2B', 'front', 'r3', ['first', 'third'], 0,
    '무사 1, 3루에서 병살 코스 땅볼이면 3루 주자는 홈으로 뛰어요. 수비가 병살을 노리면 그 사이 1점이 들어와요(2아웃이 돼도 점수는 인정돼요). ' +
    '남아 있으면 병살로 2사 3루가 되고 점수는 없어요.'),
];

// 목록 순서: 종류별로, 그 안에서는 1루 → 2루 → 3루 → 타자 주자 순 (같은 주자끼리는 쓴 순서대로)
const KIND_ORDER: RunScenario['kind'][] = ['extra', 'fly', 'ground'];
const ME_ORDER: RunMe[] = ['r1', 'r2', 'r3', 'batter'];
export const RUN_SCENARIOS: RunScenario[] = BASICS.map((s, i) => ({ s, i }))
  .sort((a, b) => KIND_ORDER.indexOf(a.s.kind) - KIND_ORDER.indexOf(b.s.kind) || ME_ORDER.indexOf(a.s.me) - ME_ORDER.indexOf(b.s.me) || a.i - b.i)
  .map((x) => x.s);
