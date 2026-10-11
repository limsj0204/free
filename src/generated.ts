import * as THREE from 'three';
import { P, type BaseId } from './coords';
import { explainThrow } from './explain';
import {
  FIELDER_NAME,
  POSITIONS,
  THROW_CHOICES,
  coverResult,
  evaluate,
  type Base3,
  type ChoiceScenario,
  type FielderId,
  type PositionId,
  type Scenario,
  type ThrowScenario,
} from './scenario';

// 상황 생성기: 포지션별 대표 타구 × 주자 배치 × 아웃 카운트 × 안 밀리는 주자의 행동(뛴다/멈춘다)을 조합한다.
// 최선은 판정 엔진이 계산하고, 해설은 explain.ts가 규칙으로 쓴다. 랜덤 연습에만 쓴다.
// 투수·1루수·3루수에는 번트 상황도 따로 만든다 (buildBunts).
// 2루수·유격수에는 다른 키스톤이 땅볼을 잡을 때 2루를 커버하는 상황도 만든다 (buildCovers).

interface Ball {
  key: string;
  name: string; // 제목에 쓰는 타구 이름
  type: 'grounder' | 'roller';
  catchPoint: THREE.Vector3;
  travelTime: number;
  selfBases?: BaseId[];
}

const BALLS: Record<PositionId, Ball[]> = {
  // 투수는 공을 던진 직후라 타구가 아주 빨리 온다
  P: [
    { key: 'front', name: '투수 정면 강습 땅볼', type: 'grounder', catchPoint: P(0.3, 16.3), travelTime: 0.6 },
    { key: 'side3', name: '투수 앞 3루 쪽 땅볼', type: 'grounder', catchPoint: P(-3, 15.5), travelTime: 0.85 },
    { key: 'side1', name: '투수 앞 1루 쪽 땅볼', type: 'grounder', catchPoint: P(3, 15.5), travelTime: 0.85 },
  ],
  SS: [
    { key: 'front', name: '정면 땅볼', type: 'grounder', catchPoint: P(-8.5, 31.5), travelTime: 1.45 },
    { key: 'hole', name: '3루 쪽 깊은 땅볼', type: 'grounder', catchPoint: P(-15, 28), travelTime: 1.5 },
    { key: 'middle', name: '2루 쪽 땅볼', type: 'grounder', catchPoint: P(-2.5, 36), travelTime: 1.45, selfBases: ['second'] },
  ],
  '2B': [
    { key: 'front', name: '정면 땅볼', type: 'grounder', catchPoint: P(8.5, 31.5), travelTime: 1.45 },
    { key: 'right', name: '1루 쪽 땅볼', type: 'grounder', catchPoint: P(14.5, 29), travelTime: 1.5 },
    { key: 'middle', name: '2루 베이스 근처 땅볼', type: 'grounder', catchPoint: P(2.8, 36.5), travelTime: 1.45, selfBases: ['second'] },
  ],
  '3B': [
    { key: 'front', name: '정면 땅볼', type: 'grounder', catchPoint: P(-20, 25.5), travelTime: 1.25, selfBases: ['third'] },
    { key: 'line', name: '3루 베이스 근처 땅볼', type: 'grounder', catchPoint: P(-20, 22), travelTime: 1.2, selfBases: ['third'] },
    { key: 'slow', name: '3루 쪽 느린 땅볼', type: 'roller', catchPoint: P(-13, 14), travelTime: 2.1, selfBases: ['third'] },
  ],
  '1B': [
    { key: 'front', name: '정면 땅볼', type: 'grounder', catchPoint: P(20, 27), travelTime: 1.4, selfBases: ['first'] },
    { key: 'line', name: '1루 베이스 근처 땅볼', type: 'grounder', catchPoint: P(19.8, 22), travelTime: 1.3, selfBases: ['first'] },
    { key: 'deep', name: '2루 쪽 땅볼', type: 'grounder', catchPoint: P(14, 30), travelTime: 1.5 },
  ],
};

// 주자 배치 (주자 없음은 답이 항상 1루라 뺀다)
const RUNNER_SETS: Base3[][] = [['first'], ['second'], ['third'], ['first', 'second'], ['first', 'third'], ['second', 'third'], ['first', 'second', 'third']];

const SHORT: Record<Base3, string> = { first: '1', second: '2', third: '3' };

function runnersText(set: Base3[]) {
  if (set.length === 3) return '만루';
  return `${set.map((b) => SHORT[b]).join(', ')}루`;
}

function outsText(outs: number) {
  return outs === 0 ? '무사' : `${outs}사`;
}

// 공을 잡지 않은 쪽 키스톤 수비수가 2루를 커버한다. 투수 앞 땅볼은 유격수가 2루에 들어간다.
function coversFor(position: PositionId): Partial<Record<BaseId, FielderId>> {
  if (position === 'P') return { first: '1B', second: 'SS', third: '3B', home: 'C' };
  const leftSide = position === 'SS' || position === '3B';
  const covers: Partial<Record<BaseId, FielderId>> = {
    first: position === '1B' ? 'P' : '1B',
    second: leftSide ? '2B' : 'SS',
    home: 'C',
  };
  // 3루수 본인은 3루를 직접 밟는다 (selfBases)
  if (position !== '3B') covers.third = '3B';
  return covers;
}

function fieldersFor(position: PositionId, set: Base3[], outs: number) {
  const f: Partial<Record<FielderId, THREE.Vector3>> = {};
  if (set.includes('first') && outs < 2) {
    f['2B'] = P(9.5, 34);
    f.SS = P(-9, 34);
  }
  if (set.includes('first')) f['1B'] = position === '1B' ? P(21, 25) : P(20.2, 18.4);
  return f;
}

function variantsFor(set: Base3[]): Partial<Record<Base3, 'advance' | 'hold'>>[] {
  // 밀리지 않는 주자만 뛴다/멈춘다 두 경우를 만든다
  const free: Base3[] = [];
  let forced = true;
  for (const b of ['first', 'second', 'third'] as Base3[]) {
    forced = forced && set.includes(b);
    if (set.includes(b) && !forced) free.push(b);
  }
  let out: Partial<Record<Base3, 'advance' | 'hold'>>[] = [{}];
  for (const b of free) out = out.flatMap((v) => [{ ...v, [b]: 'advance' as const }, { ...v, [b]: 'hold' as const }]);
  return out;
}

function build(): ThrowScenario[] {
  const list: ThrowScenario[] = [];
  for (const position of POSITIONS) {
    for (const ball of BALLS[position]) {
      for (const set of RUNNER_SETS) {
        for (let outs = 0; outs < 3; outs++) {
          for (const acts of variantsFor(set)) {
            const actKey = (Object.entries(acts) as [Base3, string][]).map(([b, a]) => `${SHORT[b]}${a[0]}`).join('');
            const situation = {
              outs,
              runners: { first: set.includes('first'), second: set.includes('second'), third: set.includes('third') },
              batter: 'R' as const,
            };
            const dp = set.includes('first') && outs < 2;
            const scn: ThrowScenario = {
              id: `gen-${position}-${ball.key}-${set.map((b) => SHORT[b]).join('')}-${outs}${actKey ? `-${actKey}` : ''}`,
              kind: 'throw',
              generated: true,
              // 주자가 뛸지는 공을 잡는 순간 콜로만 알려주므로 제목에 넣지 않는다
              title: `${outsText(outs)} ${runnersText(set)} / ${ball.name}`,
              event: ball.name,
              position,
              situation,
              brief:
                `${dp ? '병살 대형이에요. ' : ''}` +
                `${Object.keys(acts).length ? '안 밀리는 주자가 뛸지 멈출지는 공이 맞은 뒤에 봐야 해요. 공을 잡는 순간 동료의 콜을 확인하세요.' : ''}`,
              explanation: '',
              fielders: fieldersFor(position, set, outs),
              batted: { type: ball.type, catchPoint: ball.catchPoint, travelTime: ball.travelTime },
              covers: coversFor(position),
              selfBases: ball.selfBases,
              runnerActs: acts,
            };
            // 아웃을 하나도 못 잡는 상황은 연습 가치가 없어서 뺀다
            if (!THROW_CHOICES.some((c) => evaluate(scn, c, 0).outsMade > 0)) continue;
            scn.explanation = explainThrow(scn);
            list.push(scn);
          }
        }
      }
    }
  }
  return list;
}

// ---------- 번트 ----------
// 번트 세기(빨리 잡느냐) × 주자 배치 × 아웃을 바꿔서, 앞 주자를 잡을 수 있는 번트와 1루밖에 안 되는 번트가 섞여 나오게 한다.

interface Bunt {
  key: string;
  name: string;
  catchPoint: THREE.Vector3;
  travelTime: number;
}

const BUNT_SIDE: Partial<Record<PositionId, { side: string; balls: Bunt[] }>> = {
  P: {
    side: '투수 앞',
    balls: [
      { key: 'hard', name: '강한 번트', catchPoint: P(0.5, 12), travelTime: 1.2 },
      { key: 'soft', name: '느린 번트', catchPoint: P(0.8, 6.5), travelTime: 2.9 },
    ],
  },
  '3B': {
    side: '3루 쪽',
    balls: [
      { key: 'hard', name: '강한 번트', catchPoint: P(-10.5, 13), travelTime: 1.2 },
      { key: 'soft', name: '느린 번트', catchPoint: P(-3.5, 5), travelTime: 2.9 },
    ],
  },
  '1B': {
    side: '1루 쪽',
    balls: [
      { key: 'hard', name: '강한 번트', catchPoint: P(10.5, 13), travelTime: 1.2 },
      { key: 'soft', name: '느린 번트', catchPoint: P(5, 5.5), travelTime: 2.9 },
    ],
  },
};

const BUNT_SETS: Base3[][] = [['first'], ['first', 'second'], ['second']];

// 번트 수비: 1루수·3루수는 앞으로 나와 있고, 공을 잡지 않은 코너 내야수 쪽은 키스톤 수비수가 메운다
function buntDefense(position: PositionId, set: Base3[]) {
  const fielders: Partial<Record<FielderId, THREE.Vector3>> = {
    '2B': P(9.5, 34),
    SS: P(-9, 34),
    '1B': set.includes('first') ? P(19.5, 19) : P(18, 20),
    '3B': P(-18.5, 20),
  };
  const fielderMoves: Partial<Record<FielderId, THREE.Vector3>> = {};
  const covers: Partial<Record<BaseId, FielderId>> = { first: '2B', home: 'C' };
  if (position === '3B' || position === 'P') {
    // 3루수가 대시하면 1루수도 대시하고, 2루 주자가 있으면 유격수가 3루를 커버한다 (2루는 빈다)
    // 투수가 잡는 번트도 1루수·3루수가 둘 다 대시한 뒤라 같은 대형이다
    fielderMoves['1B'] = P(8, 12);
    if (position === 'P') fielderMoves['3B'] = P(-8, 12);
    if (set.includes('second')) covers.third = 'SS';
    else covers.second = 'SS';
  } else {
    covers.second = 'SS';
    covers.third = '3B';
  }
  return { fielders, fielderMoves, covers };
}

function buildBunts(): ThrowScenario[] {
  const list: ThrowScenario[] = [];
  for (const [position, def] of Object.entries(BUNT_SIDE) as [PositionId, { side: string; balls: Bunt[] }][]) {
    for (const ball of def.balls) {
      for (const set of BUNT_SETS) {
        const forcedRunner = set.includes('first');
        for (let outs = 0; outs < 2; outs++) {
          const name = `${def.side} ${ball.name}`;
          const scn: ThrowScenario = {
            id: `gen-${position}-bunt-${ball.key}-${set.map((b) => SHORT[b]).join('')}-${outs}`,
            kind: 'throw',
            generated: true,
            title: `${outsText(outs)} ${runnersText(set)} / ${name}`,
            event: name,
            position,
            situation: {
              outs,
              runners: { first: set.includes('first'), second: set.includes('second'), third: false },
              batter: 'R',
            },
            brief: '번트 수비 대형이에요. 1루수와 3루수가 앞으로 나와 있다가 투구와 함께 대시해요.',
            explanation: '',
            ...buntDefense(position, set),
            batted: { type: 'bunt', catchPoint: ball.catchPoint, travelTime: ball.travelTime },
            // 2루 주자만 있으면 번트 때 3루로 뛴다 (밀려 뛰는 게 아니라 태그 플레이)
            runnerActs: set.includes('second') && !forcedRunner ? { second: 'advance' } : undefined,
          };
          if (!THROW_CHOICES.some((c) => evaluate(scn, c, 0).outsMade > 0)) continue;
          scn.explanation = explainThrow(scn);
          list.push(scn);
        }
      }
    }
  }
  return list;
}

// ---------- 키스톤 2루 커버 ----------
// 다른 키스톤 수비수가 땅볼을 잡으면 공을 잡지 않은 쪽이 2루에 들어가 받고, 1루로 이어 던져 병살을 노린다.

const COVER_BALLS: Record<'2B' | 'SS', { key: string; name: string; catchPoint: THREE.Vector3; travelTime: number; note: string }[]> = {
  // 2루수가 할 때는 유격수가 잡는 타구
  '2B': [
    { key: 'front', name: '정면 땅볼', catchPoint: P(-8.5, 31.5), travelTime: 1.45, note: '' },
    { key: 'hole', name: '3루 쪽 깊은 땅볼', catchPoint: P(-15, 28), travelTime: 1.5, note: '깊은 곳에서 잡으면 송구가 길어서 조금 여유가 있지만, 그만큼 병살을 위한 시간도 줄어요. 2루에 빨리 들어가 기다리고 있어야 해요. ' },
    { key: 'middle', name: '2루 쪽 땅볼', catchPoint: P(-5, 35), travelTime: 1.4, note: '2루 가까이서 잡으면 짧은 토스가 금방 와요. 평소보다 더 빨리 들어가야 해요. ' },
  ],
  // 유격수가 할 때는 2루수가 잡는 타구
  SS: [
    { key: 'front', name: '정면 땅볼', catchPoint: P(8.5, 31.5), travelTime: 1.45, note: '' },
    { key: 'right', name: '1루 쪽 땅볼', catchPoint: P(14.5, 29), travelTime: 1.5, note: '1루 쪽 깊은 곳에서 잡으면 2루수는 몸을 돌려 던져야 해서 조금 여유가 있지만, 그만큼 병살을 위한 시간도 줄어요. 2루에 빨리 들어가 기다리고 있어야 해요. ' },
    { key: 'middle', name: '2루 쪽 땅볼', catchPoint: P(5, 35), travelTime: 1.4, note: '2루 가까이서 잡으면 짧은 토스가 금방 와요. 평소보다 더 빨리 들어가야 해요. ' },
  ],
};

const COVER_SETS: Base3[][] = [['first'], ['first', 'second'], ['first', 'third'], ['first', 'second', 'third']];

function buildCovers(): ChoiceScenario[] {
  const list: ChoiceScenario[] = [];
  for (const position of ['2B', 'SS'] as const) {
    const fielder: FielderId = position === '2B' ? 'SS' : '2B';
    const fname = FIELDER_NAME[fielder];
    const me = FIELDER_NAME[position];
    const sgn = position === '2B' ? 1 : -1;
    const dpCode = position === '2B' ? '6-4-3' : '4-6-3';
    for (const ball of COVER_BALLS[position]) {
      for (const set of COVER_SETS) {
        for (let outs = 0; outs < 2; outs++) {
          // 직접 만든 상황(1사 1루 정면)과 겹치는 건 뺀다. 무사 만루는 홈 송구도 좋은 판단이라 커버 연습으로는 뺀다
          if (ball.key === 'front' && set.length === 1 && outs === 1) continue;
          if (set.length === 3 && outs === 0) continue;
          const situation = {
            outs,
            runners: { first: true, second: set.includes('second'), third: set.includes('third') },
            batter: 'R' as const,
          };
          const past = coverResult(situation, 'past');
          const extra =
            `${set.includes('second') && outs === 0 ? '2루 주자는 3루까지 가지만, 병살이면 위기가 크게 줄어요. ' : ''}` +
            (set.includes('third')
              ? outs === 1
                ? '1사라 병살이면 바로 이닝이 끝나요. 3루 주자가 먼저 들어와도 포스 아웃으로 끝난 이닝이라 점수가 인정되지 않아요. '
                : '3루 주자는 들어오지만, 1점을 주고 아웃 2개를 잡는 게 병살 대형의 계산이에요. '
              : outs === 1
                ? '1사라 병살이면 바로 이닝이 끝나요. '
                : '');
          const name = `${fname} ${ball.name}`;
          list.push({
            id: `gen-${position}-cover-${ball.key}-${set.map((b) => SHORT[b]).join('')}-${outs}`,
            kind: 'choice',
            setup: 'cover',
            generated: true,
            title: `${outsText(outs)} ${runnersText(set)} / ${name}`,
            event: name,
            position,
            situation,
            brief: '병살 대형이에요. 타구가 어디로 가는지 보고 바로 움직여야 해요.',
            fielders: { '2B': P(9.5, 34), SS: P(-9, 34), '1B': P(20.2, 18.4) },
            play: { fielder, catchPoint: ball.catchPoint, travelTime: ball.travelTime, base: 'second', batted: 'grounder' },
            prompt: `${fname} 쪽 땅볼! 어디로?`,
            options: [
              {
                label: '2루 커버',
                moveTo: P(sgn * 0.6, 38.4),
                grade: 'best',
                takes: true,
                headline: '2루 포스아웃',
                result: coverResult(situation, 'force'),
                feedback: `${fname} 송구를 2루에서 받아 1루 주자를 잡았어요. 바로 1루로 이어 던지면 병살(${dpCode})까지 노릴 수 있어요.`,
              },
              {
                label: '2루 뒤 백업',
                moveTo: P(sgn * 3, 44),
                grade: 'bad',
                headline: '2루가 비었어요',
                result: past,
                feedback: `${fname}가 공을 잡았으니 2루에 들어갈 사람은 ${me}뿐이에요. 송구를 받을 사람이 없어서 공이 빠졌어요.`,
              },
              position === '2B'
                ? {
                    label: '1루 커버',
                    moveTo: P(19.0, 19.6),
                    grade: 'bad',
                    headline: '2루가 비었어요',
                    result: past,
                    feedback: '1루는 1루수가 지켜요. 2루에 아무도 없어서 유격수 송구가 빠졌고, 주자들이 한 베이스씩 더 갔어요.',
                  }
                : {
                    label: '제자리',
                    moveTo: P(-9, 34),
                    grade: 'bad',
                    headline: '2루가 비었어요',
                    result: past,
                    feedback: '2루에 아무도 없어서 2루수 송구가 빠졌고, 주자들이 한 베이스씩 더 갔어요.',
                  },
            ],
            explanation:
              `${fname} 쪽 땅볼이면 공을 잡지 않은 ${me}가 2루 커버를 들어가요. "공을 잡지 않은 쪽이 2루로 간다"고 기억하면 쉬워요. ` +
              ball.note +
              (`받은 다음에는 바로 1루로 이어 던져야 병살(${dpCode})이 완성돼요. ` + extra).trim(),
          });
        }
      }
    }
  }
  return list;
}

let cache: Scenario[] | null = null;

// 처음 쓸 때 한 번만 만든다
export function generatedScenarios(): Scenario[] {
  cache ??= [...build(), ...buildBunts(), ...buildCovers()];
  return cache;
}

export function generatedFor(position: PositionId) {
  return generatedScenarios().filter((s) => s.position === position);
}
