import * as THREE from 'three';
import { P, type BaseId } from './coords';
import { explainThrow } from './explain';
import { RECEIVE_SPOT, SCENARIOS, receiveOptions } from './scenarios';
import { buildChoiceTimeline } from './timeline';
import {
  FIELDER_NAME,
  POSITIONS,
  THROW_CHOICES,
  coverResult,
  evaluate,
  throwAnswers,
  type Base3,
  type Choice,
  type ChoiceScenario,
  type FielderId,
  type PositionId,
  type Scenario,
  type ThrowScenario,
} from './scenario';

// 상황 생성기: 포지션별 대표 타구 × 주자 배치 × 아웃 카운트 × 안 밀리는 주자의 행동(뛴다/멈춘다)을 조합한다.
// 최선은 판정 엔진이 계산하고, 해설은 explain.ts가 규칙으로 쓴다. 랜덤 연습에만 쓴다.
// 2루수·유격수에는 다른 키스톤이 땅볼을 잡을 때 2루를 커버하는 상황도 만든다 (buildCovers).
// 모든 포지션에 직선타를 잡고 귀루하지 못한 주자를 잡는 상황도 만든다 (buildLiners).

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
  // 앞 베이스 주자가 멈춰 있으면 뒤 주자도 그 베이스로 뛸 수 없다 (2·3루에서 2루 주자만 뛰는 경우는 없다)
  return out.filter((v) => !(v.second === 'advance' && v.third === 'hold'));
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

// ---------- 키스톤 2루 커버 ----------
// 1루 주자가 있을 때 다른 수비수가 땅볼을 잡으면, 2루 왼쪽(3루수·유격수) 타구는 2루수가, 2루 오른쪽(1루수·2루수) 타구와
// 투수 땅볼은 유격수가 2루에 들어가 받고 1루로 이어 던져 병살을 노린다.

interface CoverBall {
  key: string;
  fielder: FielderId; // 공을 잡는 수비수
  name: string;
  catchPoint: THREE.Vector3;
  travelTime: number;
  note: string; // 타구별 요령
  noSecond?: boolean; // 2루 주자가 있으면 3루수가 3루를 직접 밟는 타구라 뺀다
}

const DEEP = '깊은 곳에서 잡으면 송구가 길어서 조금 여유가 있지만, 그만큼 병살을 위한 시간도 줄어요. 2루에 빨리 들어가 기다리고 있어야 해요. ';
const NEAR = '2루 가까이서 잡으면 짧은 토스가 금방 와요. 평소보다 더 빨리 들어가야 해요. ';
const THIRD =
  '3루수 송구는 멀리서 와서 시간 여유는 조금 있어요. 대신 받고 나서 1루로 던질 때 1루 주자가 슬라이딩해 들어오는 쪽을 등지게 되니, 베이스를 밟고 빠지면서 던지세요. ';

const COVER_BALLS: Record<'2B' | 'SS', CoverBall[]> = {
  '2B': [
    { key: 'front', fielder: 'SS', name: '정면 땅볼', catchPoint: P(-8.5, 31.5), travelTime: 1.45, note: '' },
    { key: 'hole', fielder: 'SS', name: '3루 쪽 깊은 땅볼', catchPoint: P(-15, 28), travelTime: 1.5, note: DEEP },
    { key: 'middle', fielder: 'SS', name: '2루 쪽 땅볼', catchPoint: P(-5, 35), travelTime: 1.4, note: NEAR },
    { key: '3b-front', fielder: '3B', name: '정면 땅볼', catchPoint: P(-20, 25.5), travelTime: 1.25, note: THIRD },
    { key: '3b-line', fielder: '3B', name: '3루 베이스 근처 땅볼', catchPoint: P(-20, 22), travelTime: 1.2, note: THIRD, noSecond: true },
  ],
  SS: [
    { key: 'front', fielder: '2B', name: '정면 땅볼', catchPoint: P(8.5, 31.5), travelTime: 1.45, note: '' },
    { key: 'right', fielder: '2B', name: '1루 쪽 땅볼', catchPoint: P(14.5, 29), travelTime: 1.5, note: DEEP },
    { key: 'middle', fielder: '2B', name: '2루 쪽 땅볼', catchPoint: P(5, 35), travelTime: 1.4, note: NEAR },
    {
      key: '1b-front',
      fielder: '1B',
      name: '정면 땅볼',
      catchPoint: P(18.5, 24.5),
      travelTime: 1.3,
      note: '1루수가 공을 잡으러 나가면 1루는 투수가 커버해요. 받자마자 1루로 던지면 투수가 받아 병살이 돼요. ',
    },
    {
      key: 'p-front',
      fielder: 'P',
      name: '정면 땅볼',
      catchPoint: P(0.3, 16.3),
      travelTime: 0.6,
      note: '투수 앞 타구는 아주 빨리 와서 송구도 금방 와요. 타구를 보자마자 출발해야 해요. ',
    },
  ],
};

const DP_CODE: Partial<Record<FielderId, string>> = { SS: '6-4-3', '3B': '5-4-3', '2B': '4-6-3', '1B': '3-6-3', P: '1-6-3' };

// 왜 내가 2루에 들어가는지
function coverWhy(fielder: FielderId, me: string) {
  const fname = FIELDER_NAME[fielder];
  if (fielder === 'SS' || fielder === '2B')
    return `${fname} 쪽 땅볼이면 공을 잡지 않은 ${me}가 2루 커버를 들어가요. "공을 잡지 않은 쪽이 2루로 간다"고 기억하면 쉬워요. `;
  if (fielder === '3B') return '3루수 땅볼이면 유격수는 3루수 뒤를 받치러 움직이니, 2루는 2루수가 들어가요. 2루 왼쪽 타구는 2루수, 오른쪽 타구는 유격수가 커버해요. ';
  if (fielder === '1B') return '1루수 땅볼이면 2루수는 1루 쪽으로 움직이니, 2루는 유격수가 들어가요. 2루 오른쪽 타구는 유격수, 왼쪽 타구는 2루수가 커버해요. ';
  return '투수 땅볼은 보통 유격수가 2루에 들어가요. 팀 약속에 따라 2루수가 들어가기도 하지만, 유격수가 들어가는 게 기본이에요. ';
}

const COVER_SETS: Base3[][] = [['first'], ['first', 'second'], ['first', 'third'], ['first', 'second', 'third']];

function buildCovers(): ChoiceScenario[] {
  const list: ChoiceScenario[] = [];
  for (const position of ['2B', 'SS'] as const) {
    const me = FIELDER_NAME[position];
    const sgn = position === '2B' ? 1 : -1;
    for (const ball of COVER_BALLS[position]) {
      const fielder = ball.fielder;
      const fname = FIELDER_NAME[fielder];
      const dpCode = DP_CODE[fielder]!;
      for (const set of COVER_SETS) {
        if (ball.noSecond && set.includes('second')) continue;
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
          const whoText =
            fielder === 'SS' || fielder === '2B'
              ? `${fname}가 공을 잡았으니 2루에 들어갈 사람은 ${me}뿐이에요.`
              : `${fname} 땅볼에는 ${me}가 2루에 들어가야 해요.`;
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
            // 1루수가 공을 잡으면 투수가 1루를 커버한다
            fielderMoves: fielder === '1B' ? { P: P(18.6, 19.9) } : undefined,
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
                feedback: `${whoText} 송구를 받을 사람이 없어서 공이 빠졌어요.`,
              },
              position === '2B'
                ? {
                    label: '1루 커버',
                    moveTo: P(19.0, 19.6),
                    grade: 'bad',
                    headline: '2루가 비었어요',
                    result: past,
                    feedback: `1루는 1루수가 지켜요. 2루에 아무도 없어서 ${fname} 송구가 빠졌고, 주자들이 한 베이스씩 더 갔어요.`,
                  }
                : {
                    label: '제자리',
                    moveTo: P(-9, 34),
                    grade: 'bad',
                    headline: '2루가 비었어요',
                    result: past,
                    feedback: `${whoText} 2루에 아무도 없어서 ${fname} 송구가 빠졌고, 주자들이 한 베이스씩 더 갔어요.`,
                  },
            ],
            explanation: (coverWhy(fielder, me) + ball.note + `받은 다음에는 바로 1루로 이어 던져야 병살(${dpCode})이 완성돼요. ` + extra).trim(),
          });
        }
      }
    }
  }
  return list;
}

// ---------- 직선타 ----------
// 정면 직선타를 잡으면 타자는 아웃, 리드했던 주자는 귀루해야 한다. 돌아오기 전에 그 베이스로 던지면(밟으면) 아웃 2개.
// 히트 앤드 런(투구와 함께 주자가 스타트)이면 주자가 멀리 나가 있어 더 쉽게 잡힌다. 귀루 아웃을 잡을 수 있는 상황만 남긴다.

const LINERS: Record<PositionId, { name: string; catchPoint: THREE.Vector3; travelTime: number; selfBases?: BaseId[] }> = {
  P: { name: '투수 정면 직선타', catchPoint: P(0.4, 17.2), travelTime: 0.3 },
  '1B': { name: '1루수 정면 직선타', catchPoint: P(20.4, 21.2), travelTime: 0.38, selfBases: ['first'] },
  '2B': { name: '2루수 정면 직선타', catchPoint: P(8.4, 33), travelTime: 0.45 },
  SS: { name: '유격수 정면 직선타', catchPoint: P(-8.4, 33), travelTime: 0.45 },
  '3B': { name: '3루수 정면 직선타', catchPoint: P(-20.2, 23.2), travelTime: 0.35, selfBases: ['third'] },
};

function buildLiners(): ThrowScenario[] {
  const list: ThrowScenario[] = [];
  for (const position of POSITIONS) {
    const ball = LINERS[position];
    for (const set of RUNNER_SETS) {
      // 2아웃이면 잡는 순간 이닝이 끝나서 판단할 게 없다
      for (let outs = 0; outs < 2; outs++) {
        // 히트 앤드 런은 1루 주자가 있을 때(1루, 1·2루)만 건다
        const hrOk = set.includes('first') && !set.includes('third');
        for (const hitAndRun of hrOk ? [false, true] : [false]) {
          const name = hitAndRun ? `${ball.name} (히트 앤드 런)` : ball.name;
          const scn: ThrowScenario = {
            id: `gen-${position}-liner-${set.map((b) => SHORT[b]).join('')}-${outs}${hitAndRun ? '-hr' : ''}`,
            kind: 'throw',
            generated: true,
            title: `${outsText(outs)} ${runnersText(set)} / ${name}`,
            event: name,
            position,
            situation: {
              outs,
              runners: { first: set.includes('first'), second: set.includes('second'), third: set.includes('third') },
              batter: 'R',
            },
            brief: hitAndRun
              ? '투구와 동시에 주자가 스타트하는 히트 앤드 런이에요. 강한 타구가 정면으로 날아와요.'
              : '주자들은 리드를 하고 있어요. 강한 타구가 정면으로 날아와요.',
            explanation: '',
            fielders: fieldersFor(position, set, outs),
            batted: { type: 'liner', catchPoint: ball.catchPoint, travelTime: ball.travelTime },
            covers: coversFor(position),
            selfBases: ball.selfBases,
            hitAndRun,
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

// ---------- 받는 쪽 판단: 밟기 vs 태그 ----------
// 다른 수비수가 땅볼을 잡아 내가 지키는 베이스(2루·3루)로 던진다. 오는 주자가 밀려서 오면 밟기, 아니면(또는 포스가 풀렸으면) 태그.

interface Throw {
  fielder: FielderId;
  name: string;
  catchPoint: THREE.Vector3;
  travelTime: number;
  via?: 'step1' | 'throw1';
}

const SS_FRONT: Throw = { fielder: 'SS', name: '유격수 땅볼', catchPoint: P(-8.5, 31.5), travelTime: 1.45 };
const P_FRONT: Throw = { fielder: 'P', name: '투수 땅볼', catchPoint: P(0.3, 16.3), travelTime: 0.6 };
const B3_FRONT: Throw = { fielder: '3B', name: '3루수 땅볼', catchPoint: P(-20, 25.5), travelTime: 1.25 };
const B2_FRONT: Throw = { fielder: '2B', name: '2루수 땅볼', catchPoint: P(8.5, 31.5), travelTime: 1.45 };
const B1_STEP: Throw = { fielder: '1B', name: '1루수 땅볼', catchPoint: P(19.8, 22), travelTime: 1.3, via: 'step1' };

const RECEIVES: { position: '2B' | 'SS' | '3B'; base: 'second' | 'third'; throws: Throw[]; sets: Base3[][] }[] = [
  { position: '3B', base: 'third', throws: [SS_FRONT, P_FRONT], sets: [['second'], ['first', 'second'], ['first', 'second', 'third']] },
  { position: '2B', base: 'second', throws: [SS_FRONT, B3_FRONT], sets: [['first'], ['first', 'second']] },
  { position: 'SS', base: 'second', throws: [B2_FRONT, P_FRONT], sets: [['first'], ['first', 'second']] },
  { position: 'SS', base: 'second', throws: [B1_STEP], sets: [['first'], ['first', 'second'], ['first', 'third']] },
];

function receiveExplain(base: 'second' | 'third', force: boolean, via: Throw['via'], set: Base3[]) {
  const runner = base === 'second' ? '1루 주자' : '2루 주자';
  const bag = base === 'second' ? '2루' : '3루';
  if (via === 'step1')
    return `1루수가 1루를 먼저 밟아 타자를 잡았어요. 타자가 아웃되는 순간 ${runner}는 더 이상 밀리지 않아서 포스가 풀려요. 그래서 ${bag}에서는 주자를 직접 태그해야 해요. 1루를 밟지 않고 바로 ${bag}로 던졌다면 밟기만 해도 아웃이었어요.`;
  if (via === 'throw1')
    return `투수가 1루로 먼저 던져 타자를 잡았어요. 타자가 아웃되는 순간 ${runner}의 포스가 풀려서, 1루수가 이어 던진 공을 ${bag}에서 받으면 주자를 직접 태그해야 해요. 앞에서 어떤 아웃이 먼저 나왔는지 보고 판단하세요.`;
  if (force)
    return `${runner}는 뒤에 ${set.includes('first') && base === 'third' ? '1루 주자와 타자' : '타자'}가 있어서 밀려서 뛰는 주자예요(포스). ${bag}에서 공을 받으면 베이스만 밟아도 아웃이에요. 태그해도 아웃이지만 느리고 놓칠 수 있어요.`;
  return `${runner} 뒤(1루)에 주자가 없어서, ${runner}는 밀려서 뛰는 게 아니라 스스로 ${bag}를 노린 거예요. 그래서 ${bag}에서는 베이스만 밟아서는 아웃이 안 되고 주자를 직접 태그해야 해요. 주자가 1, 2루였다면 밟기만 해도 아웃이에요.`;
}

// 공을 잡은 수비수의 송구가 그 상황의 최선이 아니었으면 한 줄 덧붙인다 (받는 쪽 연습을 위해 일부러 만든 상황임을 알려 준다)
const BASE_KO: Record<BaseId, string> = { home: '홈', first: '1루', second: '2루', third: '3루' };
function throwerNote(scn: ChoiceScenario): string {
  const r = scn.receive!;
  if (r.fielder === 'C' || !POSITIONS.includes(r.fielder as PositionId)) return '';
  const pos = r.fielder as PositionId;
  const ts: ThrowScenario = {
    id: `${scn.id}-thrower`,
    kind: 'throw',
    title: '',
    event: '',
    position: pos,
    situation: scn.situation,
    brief: '',
    explanation: '',
    fielders: scn.fielders,
    batted: { type: 'grounder', catchPoint: r.catchPoint, travelTime: r.travelTime },
    covers: coversFor(pos),
    selfBases: r.via === 'step1' ? ['first'] : undefined,
    runnerActs: r.base === 'third' && !scn.situation.runners.first ? { second: 'advance' } : undefined,
  };
  const { answers, follows } = throwAnswers(ts);
  const did: Choice = r.via === 'step1' ? 'first' : r.base;
  const okFollow = r.via !== 'step1' || (follows.first?.best ?? []).includes(r.base);
  if (answers.includes(did) && okFollow) return '';
  const best = answers.filter((c) => c !== 'hold').map((c) => BASE_KO[c as BaseId]);
  const fname = FIELDER_NAME[pos];
  const what = r.via === 'step1' ? `1루를 먼저 밟고 ${BASE_KO[r.base]}로 던졌더라도` : `${BASE_KO[r.base]}로 던졌더라도`;
  const last = best[best.length - 1] ?? '';
  return ` 참고로 이 상황에서 ${fname}의 최선은 ${best.join(' 또는 ')}${last === '홈' ? '으로' : '로'} 던지는 거예요. 하지만 ${fname}가 ${what}, 받는 쪽은 그 공을 정확히 처리해야 해요.`;
}

function buildReceives(): ChoiceScenario[] {
  const list: ChoiceScenario[] = [];
  for (const g of RECEIVES) {
    for (const th of g.throws) {
      for (const set of g.sets) {
        for (let outs = 0; outs < 2; outs++) {
          const situation = {
            outs,
            runners: { first: set.includes('first'), second: set.includes('second'), third: set.includes('third') },
            batter: 'R' as const,
          };
          const force = !th.via && (g.base === 'second' || set.includes('first'));
          const spot = g.base === 'third' ? RECEIVE_SPOT.third : RECEIVE_SPOT.second[g.position as '2B' | 'SS'];
          const bag = g.base === 'second' ? '2루' : '3루';
          const fname = FIELDER_NAME[th.fielder];
          const scn: ChoiceScenario = {
            id: `gen-${g.position}-receive-${th.fielder}${th.via ? `-${th.via}` : ''}-${set.map((b) => SHORT[b]).join('')}-${outs}`,
            kind: 'choice',
            setup: 'receive',
            generated: true,
            title: `${outsText(outs)} ${runnersText(set)} / ${th.name} (${bag}에서 받기)`,
            event: th.via === 'step1' ? '1루수 땅볼 (1루 밟고 2루로)' : th.via === 'throw1' ? '투수 땅볼 (1루 먼저, 이어서 2루로)' : `${fname} 정면 땅볼`,
            position: g.position,
            situation,
            brief: `${fname}가 땅볼을 잡아${th.via === 'step1' ? ' 1루를 먼저 밟고' : ''} ${bag}로 던져요. ${FIELDER_NAME[g.position]}는 ${bag} 베이스로 들어가 받아요. 받으면 밟을까, 태그할까?`,
            fielders: { ...fieldersFor(g.position, set, outs), ...(th.via === 'step1' ? { '1B': P(21, 25) } : {}) },
            receive: { fielder: th.fielder, catchPoint: th.catchPoint, travelTime: th.travelTime, base: g.base, force, via: th.via },
            prompt: `${bag}로 송구! 받으면?`,
            options: receiveOptions(situation, g.base, force, !!th.via, spot),
            explanation: receiveExplain(g.base, force, th.via, set),
          };
          scn.explanation += throwerNote(scn);
          // 맞는 선택으로 실제 아웃이 되는 상황만 남긴다
          const best = scn.options.findIndex((o) => o.grade === 'best');
          const tl = buildChoiceTimeline(scn, 0.5, { index: best, d: 0 });
          if (!tl.plays.some((p) => p.base === g.base && p.out)) continue;
          list.push(scn);
        }
      }
    }
  }
  return list;
}

// ---------- 낮은 내야 뜬공 ----------
// 낮게 뜬 공이 떨어질 줄 알고 주자들이 맞자마자 뛰어나갔다가, 잡히자 귀루해야 하는 상황. 원래 베이스로 던지면(밟으면) 아웃 2개.

const POPS: Record<PositionId, { catchPoint: THREE.Vector3; travelTime: number; selfBases?: BaseId[] }> = {
  P: { catchPoint: P(1, 12), travelTime: 1.2 },
  '1B': { catchPoint: P(17, 20.5), travelTime: 1.3, selfBases: ['first'] },
  '2B': { catchPoint: P(7, 28), travelTime: 1.4 },
  SS: { catchPoint: P(-7, 28), travelTime: 1.4 },
  '3B': { catchPoint: P(-17, 20.5), travelTime: 1.3, selfBases: ['third'] },
};
const POP_SETS: Base3[][] = [['first'], ['second'], ['first', 'second'], ['first', 'third'], ['first', 'second', 'third']];

function buildPops(): ThrowScenario[] {
  const list: ThrowScenario[] = [];
  for (const position of POSITIONS) {
    const ball = POPS[position];
    const name = `${FIELDER_NAME[position]} 앞 낮은 뜬공`;
    for (const set of POP_SETS) {
      for (let outs = 0; outs < 2; outs++) {
        const scn: ThrowScenario = {
          id: `gen-${position}-pop-${set.map((b) => SHORT[b]).join('')}-${outs}`,
          kind: 'throw',
          generated: true,
          title: `${outsText(outs)} ${runnersText(set)} / ${name}`,
          event: name,
          position,
          situation: {
            outs,
            runners: { first: set.includes('first'), second: set.includes('second'), third: set.includes('third') },
            batter: 'R',
          },
          brief: '낮게 뜬 내야 뜬공이에요. 주자들은 공이 떨어질 줄 알고 맞자마자 뛰어나가요.',
          explanation: '',
          fielders: fieldersFor(position, set, outs),
          batted: { type: 'liner', catchPoint: ball.catchPoint, travelTime: ball.travelTime, pop: true },
          covers: coversFor(position),
          selfBases: ball.selfBases,
        };
        if (!THROW_CHOICES.some((c) => evaluate(scn, c, 0).outsMade > 0)) continue;
        scn.explanation = explainThrow(scn);
        list.push(scn);
      }
    }
  }
  return list;
}

let cache: Scenario[] | null = null;

// 기본 상황과 같은 상황(같은 포지션·아웃·주자·타구·주자 행동)은 자동 생성에서 뺀다
function signature(s: Scenario) {
  const r = s.situation.runners;
  const base = `${s.position}|${s.situation.outs}|${+r.first}${+r.second}${+r.third}${s.kind === 'throw' && s.batted.pop ? '|pop' : ''}`;
  if (s.kind === 'choice') {
    const p = s.play ?? s.receive;
    return `${base}|${s.setup}|${p?.fielder ?? ''}|${p ? `${p.catchPoint.x.toFixed(1)},${p.catchPoint.z.toFixed(1)}` : ''}|${s.receive?.via ?? ''}`;
  }
  // 행동을 안 적은 주자는 기본값(2아웃이면 뛰고 아니면 멈춤)으로 본다
  const acts = (['first', 'second', 'third'] as const).map((b) => (r[b] ? (s.runnerActs?.[b] ?? (s.situation.outs === 2 ? 'advance' : 'hold'))[0] : '-')).join('');
  return `${base}|${s.batted.type}|${s.batted.catchPoint.x.toFixed(1)},${s.batted.catchPoint.z.toFixed(1)}|${s.hitAndRun ? 'hr' : ''}|${acts}`;
}

// 처음 쓸 때 한 번만 만든다
export function generatedScenarios(): Scenario[] {
  if (!cache) {
    const base = new Set(SCENARIOS.map(signature));
    cache = [...build(), ...buildCovers(), ...buildLiners(), ...buildPops(), ...buildReceives()].filter((s) => !base.has(signature(s)));
  }
  return cache;
}

export function generatedFor(position: PositionId) {
  return generatedScenarios().filter((s) => s.position === position);
}
