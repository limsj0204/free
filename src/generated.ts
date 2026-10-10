import * as THREE from 'three';
import { P, type BaseId } from './coords';
import { explainThrow } from './explain';
import {
  THROW_CHOICES,
  evaluate,
  type Base3,
  type FielderId,
  type PositionId,
  type ThrowScenario,
} from './scenario';

// 상황 생성기: 포지션별 대표 타구 × 주자 배치 × 아웃 카운트 × 안 밀리는 주자의 행동(뛴다/멈춘다)을 조합한다.
// 정답은 판정 엔진이 계산하고, 해설은 explain.ts가 규칙으로 쓴다. 랜덤 연습에만 쓴다.

interface Ball {
  key: string;
  name: string; // 제목에 쓰는 타구 이름
  type: 'grounder' | 'roller';
  catchPoint: THREE.Vector3;
  travelTime: number;
  selfBases?: BaseId[];
}

const BALLS: Record<PositionId, Ball[]> = {
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

// 공을 잡지 않은 쪽 키스톤 수비수가 2루를 커버한다
function coversFor(position: PositionId): Partial<Record<BaseId, FielderId>> {
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
  for (const position of ['1B', '2B', 'SS', '3B'] as PositionId[]) {
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
              title: `${outsText(outs)} ${runnersText(set)}, ${ball.name}`,
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

let cache: ThrowScenario[] | null = null;

// 처음 쓸 때 한 번만 만든다
export function generatedScenarios(): ThrowScenario[] {
  cache ??= build();
  return cache;
}

export function generatedFor(position: PositionId) {
  return generatedScenarios().filter((s) => s.position === position);
}
