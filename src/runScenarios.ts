import * as THREE from 'three';
import { P } from './coords';
import type { FielderId, Situation } from './scenario';
import { tabOf, type OutfieldHit, type OutfielderId, type RunMe, type RunScenario, type RunTab } from './runner';
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

// 코치 콜(1루→3루, 2루→홈) 자동 생성용 타구: '돌려'와 '멈춰'가 비슷하게 나오게 고른다.
// 멈춰: 외야수 정면 단타 (비슷해 보이는 라이너 단타·좌익선 쪽 단타는 뺐다)
// 돌려: 외야 사이를 가르거나 라인을 따라 빠지는 타구 (외야수가 뒤로 쫓아가 잡는다)
const COACH_HITS: Profile[] = [
  ...['rf', 'cf', 'lf', 'lc', 'rf-line', 'rc'].map((k) => SINGLES.find((p) => p.key === k)!),
  { key: 'lc-split', name: '좌중간을 가르는 안타', fielder: 'LF', hit: liner(P(-15, 70), 1.6, P(-21, 87), 5.0, 'back') },
  { key: 'rc-split', name: '우중간을 가르는 안타', fielder: 'RF', hit: liner(P(15, 70), 1.6, P(21, 87), 5.0, 'back') },
  { key: 'lf-down', name: '좌익선을 빠지는 안타', fielder: 'LF', hit: grounder(P(-40, 82), 4.6, 'back') },
  { key: 'rf-down', name: '우익선을 빠지는 안타', fielder: 'RF', hit: grounder(P(40, 82), 4.6, 'back') },
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
  return `${me === 'r1' ? '1루' : '2루'} 주자예요. 외야로 안타가 나오면 ${run} 갈지 3루 코치가 콜해요. 화면에 뜨는 콜(돌려 / 멈춰)을 보고 바로 반응하세요.${start}`;
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
  for (const me of ['r1', 'r2'] as RunMe[]) for (const p of COACH_HITS) for (const o of [0, 1, 2]) out.push(make('extra', me, o, p));
  // 타자 주자: 라인 쪽 타구는 수치에 따라 답이 갈려서 빼고, 외야 사이를 가르는 타구(간다)와 외야수 정면 단타(멈춘다)만 남긴다
  for (const p of STRETCH.filter((x) => !x.key.endsWith('-line'))) for (const o of [0, 1, 2]) out.push(make('extra', 'batter', o, p));
  for (const me of ['r1', 'r2', 'r3'] as RunMe[])
    for (const p of FLIES_HOME)
      for (const o of [0, 1, 2]) {
        // 2아웃에 거의 잡히는 플라이는 답(스타트)이 매번 같아서 뺀다 (잡힐지 모르는 타구만 남긴다)
        if (o === 2 && (p.hit.catchProb ?? 1) >= 0.9) continue;
        // 외야 플라이는 깊이를 나누지 않는다 (얕은·깊은 플라이는 뺀다). 2루 주자의 외야 플라이는 3루 송구에 맞춘 FLIES_THIRD로 만든다
        if (/-(short|deep)$/.test(p.key)) continue;
        if (me === 'r2' && /-mid$/.test(p.key)) continue;
        out.push(make('fly', me, o, p));
      }
  for (const p of FLIES_THIRD.filter((x) => x.key.endsWith('-mid'))) for (const o of [0, 1]) out.push({ ...make('fly', 'r2', o, p), id: `run-fly-r2-deep-${p.key}-${o}` });
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
    ...make('extra', 'batter', 0, pick(STRETCH, 'lc-gap')),
    id: 'run-b-gap',
    generated: false,
    explanation:
      '좌중간을 가르는 타구는 외야수가 뒤로 뛰어가 잡아서, 몸을 돌려 던지기까지 오래 걸려요. 외야수가 공을 잡는 모습을 보고 바로 2루로 가세요. ' +
      '2루에 가면 다음 안타 하나로 홈까지 올 수 있는 득점권이에요.',
  },
  {
    ...make('extra', 'batter', 1, pick(STRETCH, 'lf')),
    id: 'run-b-lf',
    generated: false,
    explanation:
      '좌익수 정면으로 가는 단타는 좌익수가 앞으로 오면서 잡아 2루로 바로 던져요. 공이 잡히는 걸 보고 1루에서 멈추세요.',
  },
  {
    ...make('fly', 'r3', 1, pick(FLIES_HOME, 'cf-mid')),
    id: 'run-t3-1out',
    generated: false,
    explanation:
      '희생플라이는 타구 깊이로 정해요. 깊으면 뛰고, 얕으면 머물고, 이 타구처럼 보통 깊이면 뛰는 것과 머무는 것 둘 다 좋은 판단이에요. ' +
      '1아웃이면 잡히는 순간 2아웃이라 3루에 남아도 안타가 나와야만 점수가 나서, 뛰는 쪽에 조금 더 무게가 실려요. 뛴다면 공이 글러브에 들어가는 순간 출발하세요.',
  },
  {
    ...make('fly', 'r3', 0, pick(FLIES_HOME, 'lc-gap')),
    id: 'run-t3-gap',
    generated: false,
    explanation:
      '외야 사이로 뻗는 깊은 타구는 잡힐지 몰라요. 그래도 3루 주자는 <b>베이스로</b> 돌아가요. 잡히면 깊은 타구라 태그업으로 여유 있게 홈에 들어가고, 떨어져도 3루에서 홈까지는 충분히 들어와요. ' +
      '하프웨이로 나가 있으면 잡혔을 때 3루로 돌아가야 해서 희생플라이를 놓쳐요.',
  },
  {
    ...make('fly', 'r2', 0, pick(FLIES_THIRD, 'rf-mid')),
    id: 'run-t2-rf',
    generated: false,
    explanation:
      '2루 주자의 태그업은 타구 방향으로 정해요. 우익수 플라이면 아주 깊지 않아도 태그업해서 3루까지 갈 수 있어요. 우익수에서 3루는 외야에서 가장 먼 송구예요. ' +
      '무사 2루가 1사 3루가 되면 다음 타자의 땅볼이나 플라이로도 점수가 나요.',
  },
  {
    ...make('fly', 'r2', 1, pick(FLIES_THIRD, 'cf-mid')),
    id: 'run-t2-1out',
    generated: false,
    explanation:
      '2루 주자의 태그업은 우측 외야 플라이일 때만 시도해요. 중견수·좌익수 쪽은 3루까지 송구가 짧아요. ' +
      '게다가 1아웃에서 잡히면 2아웃인데, 2아웃 3루와 2아웃 2루는 거의 같아요(어차피 안타가 나와야 하고, 2루 주자도 안타면 홈에 들어와요). 3루에서 아웃되면 이닝이 끝나니 2루에 머무세요.',
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
      '깊은 타구라 하프웨이와 2루로 돌아가기(태그업 준비) 둘 다 할 수 있는 판단이에요. 하프웨이면 떨어졌을 때 바로 홈까지 가고, 태그업 준비면 잡혔을 때 3루까지 가요. ' +
      '무사라면 태그업 준비가 조금 더 나아요. 잡혀도 1사 3루가 되면 다음 타자의 땅볼이나 플라이로도 점수가 나서, 태그업으로 3루에 가는 가치가 크거든요.',
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
    '공이 내야를 빠져나가거나 1루로 송구되는 걸 확인하고 움직이세요. ' +
    '3루 주자도 1루가 비어 있으면 똑같아요. 내야 정면 땅볼에 홈으로 뛰면 홈에서 잡혀요.'),
  groundBasic('run-g2-behind', '1B', 'front', 'r2', ['second'], 0,
    '타구가 내 뒤(1루수 쪽)로 가면 진루해요. 1루수는 1루를 밟거나 1루로 던지는 게 쉽고, 3루까지는 멀어요. ' +
    '아웃 하나를 주고 주자를 3루로 보내는 진루타가 돼서, 무사 2루가 1사 3루로 바뀌어요.'),
  groundBasic('run-g13-dp', '2B', 'front', 'r3', ['first', 'third'], 0,
    '무사 1, 3루에서 병살 코스 땅볼이면 3루 주자는 홈으로 뛰어요. 수비가 병살을 노리면 그 사이 1점이 들어와요(2아웃이 돼도 점수는 인정돼요). ' +
    '수비가 홈으로 던져서 잡혀도 1사 1, 2루라 기회가 남아요. 남아 있다가 병살을 당하면 2사 3루가 되고 점수도 없어서, 그게 가장 손해예요.'),
];

// ---------- 드문 상황: 직선타, 내야 뜬공, 폭투·패스트볼 ----------

// 내야 직선타: 잡히면 내야수가 바로 베이스로 던진다. 빠지면 외야수(of)가 drop에서 줍는다.
const infieldLiner = (by: FielderId, at: THREE.Vector3, T: number, catchProb: number, drop: { field: THREE.Vector3; t: number }): Hit => ({
  type: 'liner',
  field: at,
  fieldT: T,
  release: 'infield',
  catchProb,
  infielder: by,
  drop,
});
// 내야 뜬공: 거의 다 잡힌다
const infieldPop = (by: FielderId, at: THREE.Vector3, T: number): Hit => ({
  type: 'fly',
  field: at,
  fieldT: T,
  release: 'infield',
  catchProb: 1,
  infielder: by,
  drop: { field: at, t: T + 0.8 },
});

const BASE_NAME: Record<RunMe, string> = { batter: '타자', r1: '1루', r2: '2루', r3: '3루' };

function rareHit(id: string, me: RunMe, outs: number, name: string, of: OutfielderId, hit: Hit, level: 1 | 2 | 3, explanation: string): RunScenario {
  const liner = hit.type === 'liner';
  return {
    id,
    kind: 'fly',
    rare: true,
    title: titleOf(me, outs, name),
    event: name,
    me,
    situation: situationOf(me, outs),
    fielder: of,
    hit,
    brief: liner
      ? `${BASE_NAME[me]} 주자예요. 내야로 낮고 빠른 직선타가 날아와요. 베이스로 돌아갈지, 그 자리에 멈출지, 스타트할지 정해요.`
      : `${BASE_NAME[me]} 주자예요. 내야에 높이 뜬 공이에요. 베이스로 돌아갈지, 하프웨이로 나갈지, 스타트할지 정해요.`,
    generated: false,
    level,
    explanation,
  };
}

function rareWild(id: string, me: RunMe, outs: number, label: '폭투' | '패스트볼', where: string, spot: THREE.Vector3, t: number, level: 1 | 2 | 3, explanation: string): RunScenario {
  return {
    id,
    kind: 'wild',
    rare: true,
    title: titleOf(me, outs, `${label} (${where})`),
    event: label,
    me,
    situation: situationOf(me, outs),
    wild: { label, spot, t },
    brief: `${BASE_NAME[me]} 주자예요. 투구가 포수 뒤로 빠지면 다음 베이스로 갈지 정해요.`,
    generated: false,
    level,
    explanation,
  };
}

const RARE: RunScenario[] = [
  // 직선타는 어느 위치든 판단이 같아서(그 자리에 멈춤, 2아웃이면 스타트) 하나만 둔다
  rareHit('run-x-liner', 'r1', 0, '내야 직선타', 'RF', infieldLiner('2B', P(10, 34), 1.0, 0.7, { field: P(16, 56), t: 2.9 }), 1,
    '직선타는 공이 뜨는 순간 <b>그 자리에 멈춰요</b>(프리즈). 잡히면 2루수가 바로 1루로 던져서, 뛰어나간 주자는 돌아오지 못하고 더블아웃이에요. ' +
    '리드 자리에 멈춰 있으면 잡혀도 돌아올 수 있고, 빠지면 거기서 바로 2루로 가요. 베이스까지 돌아가 버리면 빠졌을 때 2루가 빠듯해요. ' +
    '어느 내야수 쪽 직선타든, 몇 루 주자든 판단은 같아요. 2아웃이면 잡혀도 이닝이 끝나니 타격과 동시에 스타트해요.'),
  rareHit('run-x-pop', 'r1', 0, '내야 뜬공', 'LF', infieldPop('SS', P(-8, 30), 3.6), 1,
    '내야 뜬공은 어느 위치든 판단이 같아요. 거의 다 잡히고, 내야수가 가까이서 잡아 바로 베이스로 던지니 하프웨이로 나가 있어도 돌아오기 빠듯해요. ' +
    '태그업으로 다음 베이스를 노릴 거리도 아니에요. <b>베이스에 붙어 있으세요.</b> 2아웃이면 다른 플라이처럼 스타트예요.'),
  // 폭투·패스트볼은 '멀리 빠지면 간다, 바로 앞이면 3루 주자는 머문다' 두 가지라 둘만 둔다
  rareWild('run-x-wp-short', 'r3', 0, '폭투', '바로 앞에 떨어짐', P(1.5, -3.5), 0.5, 2,
    '포수 바로 앞에 떨어진 공은 금방 주워요. 투수가 홈 커버로 들어오면 홈에서 잡혀요. 3루 주자는 머무세요. 공이 멀리 빠졌을 때만 홈으로 가요.'),
  rareWild('run-x-wp-r3', 'r3', 1, '폭투', '백네트까지', P(-6, -18), 1.8, 1,
    '공이 백네트까지 멀리 빠지면 3루 주자는 홈으로 가요. 포수가 공을 줍고 홈 커버로 들어온 투수에게 던지기 전에 들어올 수 있어요. ' +
    '폭투든 패스트볼이든 판단은 같아요. 1·2루 주자는 다음 베이스까지 송구가 길어서, 공이 포수 뒤로 빠지면 대부분 가요.'),
  rareRule('run-x-fullcount', 'fullcount', 'r1', { outs: 2, runners: { first: true, second: false, third: false }, batter: 'R' }, '2사 1루 / 풀카운트', '2사 풀카운트',
    '1루 주자예요. 2아웃 풀카운트(3볼 2스트라이크)예요. 투수가 공을 던지기 전에, 언제 출발할지 정해요.',
    '2아웃 풀카운트에서 포스인 주자(1루 주자)는 <b>투구와 동시에 스타트</b>해요. 볼이면 볼넷이라 어차피 2루로 가고, 스트라이크면 삼진으로 이닝이 끝나고, 파울이면 다시 돌아오면 돼요. ' +
    '공이 맞으면 이미 뛰고 있어서 안타에 한 베이스 더 가고, 땅볼이면 2루 포스아웃을 피하기 쉬워요. 잃을 게 없는 출발이에요. (1, 2루나 만루면 밀리는 주자 모두 똑같이 뛰어요)'),
  rareRule('run-x-dropped3', 'dropped3', 'batter', { outs: 1, runners: { first: false, second: false, third: false }, batter: 'R' }, '1사 주자 없음 / 낫아웃', '낫아웃',
    '타자예요. 2스트라이크에서 공을 기다려요. 1루가 비어 있어요.',
    '세 번째 스트라이크를 포수가 제대로 잡지 못하면(낫아웃), <b>1루가 비어 있거나 2아웃</b>일 때 타자는 1루로 뛸 수 있어요. 포수가 공을 주워 1루에 던지기 전에 닿으면 세이프예요. ' +
    '서 있으면 그대로 삼진 아웃이에요. 1루에 주자가 있고 2아웃이 아니면 뛸 수 없어요(그냥 아웃).'),
  rareRule('run-x-dropped3-r1', 'dropped3out', 'batter', { outs: 1, runners: { first: true, second: false, third: false }, batter: 'R' }, '1사 1루 / 공이 빠진 헛스윙', '헛스윙, 공이 빠졌다',
    '타자예요. 2스트라이크에서 공을 기다려요. 1루에 주자가 있어요.',
    '낫아웃으로 타자가 1루로 뛸 수 있는 건 <b>1루가 비어 있거나 2아웃</b>일 때뿐이에요. 1루에 주자가 있고 2아웃 전이면 포수가 공을 놓쳐도 <b>그대로 삼진 아웃</b>이에요. ' +
    '(1루가 차 있을 때 낫아웃을 허용하면 포수가 일부러 공을 떨어뜨려 병살을 잡을 수 있어서 막아 둔 규칙이에요.) 뛰어도 소용없고, 괜히 뛰면 1루 주자가 헷갈릴 수 있어요. 타석에서 물러나세요.'),
  rareRule('run-x-iff', 'iff', 'r1', { outs: 1, runners: { first: true, second: true, third: false }, batter: 'R' }, '1사 1, 2루 / 인필드 플라이', '인필드 플라이',
    '1루 주자예요. 1, 2루에서 내야에 공이 높이 떠요. 공이 떨어지면 어떻게 할지 정해요.',
    '무사·1사에 1, 2루나 만루에서 내야에 높이 뜬 공은 심판이 <b>인필드 플라이</b>를 선언해요. 공을 잡든 못 잡든 타자는 아웃이라, 주자는 밀리지 않아요(포스가 없어져요). ' +
    '그래서 공이 떨어져도 뛸 필요가 없어요. <b>베이스에 붙어 있으세요.</b> 뛰다가 공을 주운 수비에게 태그되면 아웃이에요. (일부러 공을 떨어뜨려 병살을 노리는 걸 막으려는 규칙이에요)'),
];

function rareRule(id: string, rule: RunScenario['rule'], me: RunMe, situation: Situation, title: string, event: string, brief: string, explanation: string): RunScenario {
  return { id, kind: 'rule', rare: true, rule, title, event, me, situation, brief, generated: false, level: 1, explanation };
}


// 기본 상황 난이도: 1 기초(먼저 익힐 기본 원칙) / 2 응용 / 3 심화(아웃 카운트에 따라 갈리는 판단)
const LEVELS: Record<string, 1 | 2 | 3> = {
  'run-r1-lf': 2, 'run-r1-cf': 1, 'run-b-gap': 1, 'run-b-lf': 1, 'run-b-rc': 1, 'run-b-cf': 1, 'run-b-rf': 2,
  'run-r1-rc': 2, 'run-r2-lf': 2, 'run-r2-rf': 2, 'run-r2-2out': 2,
  'run-r1-2out': 3,
  'run-f1-half': 1, 'run-f2-2out': 1, 'run-t3-1out': 1, 'run-t3-gap': 2,
  'run-f1-bloop': 2, 'run-t2-rf': 2, 'run-f2-gap0': 2,
  'run-t2-1out': 3, 'run-f2-gap1': 3,
  'run-g1-forced': 1, 'run-g12-forced': 1, 'run-g2-front': 1, 'run-g3-front': 1,
  'run-g2-behind': 2, 'run-g13-dp': 2,
};
for (const s of BASICS) s.level = LEVELS[s.id] ?? 2;

// 목록 순서: 종류별로 기초 → 응용 → 심화, 같은 난이도 안에서는 1루 → 2루 → 3루 → 타자 주자 순 (같은 주자끼리는 쓴 순서대로)
const TAB_ORDER: RunTab[] = ['fly', 'ground', 'hit', 'rare'];
const ME_ORDER: RunMe[] = ['r1', 'r2', 'r3', 'batter'];
export const RUN_SCENARIOS: RunScenario[] = [...BASICS, ...RARE].map((s, i) => ({ s, i }))
  .sort(
    (a, b) =>
      TAB_ORDER.indexOf(tabOf(a.s)) - TAB_ORDER.indexOf(tabOf(b.s)) ||
      a.s.level! - b.s.level! ||
      ME_ORDER.indexOf(a.s.me) - ME_ORDER.indexOf(b.s.me) ||
      a.i - b.i,
  )
  .map((x) => x.s);
