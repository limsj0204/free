import * as THREE from 'three';
import { P } from './coords';
import { receiveResult, type ChoiceOption, type FielderId, type PositionId, type Scenario, type Situation } from './scenario';

// 기본 수비 위치 (필드 좌표: fx는 1루 쪽, fz는 중견수 쪽)
export const DEFAULT_FIELDERS: Record<FielderId, THREE.Vector3> = {
  P: P(0, 18.44),
  C: P(0, -1.1),
  '1B': P(21.5, 24.5),
  '2B': P(11, 36),
  SS: P(-11, 35.5),
  '3B': P(-21.5, 24),
  LF: P(-30, 68),
  CF: P(0, 76),
  RF: P(30, 68),
};

// 자주 쓰는 수비 위치
const DP = { '2B': P(9.5, 34), SS: P(-9, 34) }; // 병살 대형
const HOLD_1B = { '1B': P(20.2, 18.4) }; // 1루 주자 견제 대비
const INFIELD_IN = { '1B': P(17.5, 17), '2B': P(7, 26.5), SS: P(-7, 26.5), '3B': P(-14.5, 18.5) }; // 전진 수비

export function fieldersOf(scn: Scenario): Record<FielderId, THREE.Vector3> {
  return { ...DEFAULT_FIELDERS, ...scn.fielders };
}

// 받는 쪽 판단(밟기/태그)의 선택지. 포스면 밟기가 최선(태그도 아웃이지만 느림), 포스가 아니면 태그만 아웃
export const RECEIVE_SPOT = { second: { '2B': P(0.6, 38.4), SS: P(-0.6, 38.4) }, third: P(-18.9, 20.0) };
export function receiveOptions(situation: Situation, base: 'second' | 'third', force: boolean, via: boolean, spot: THREE.Vector3): ChoiceOption[] {
  const runner = base === 'second' ? '1루 주자' : '2루 주자';
  const outRes = receiveResult(situation, base, via, true);
  const safeRes = receiveResult(situation, base, via, false);
  return [
    {
      label: '베이스 밟기',
      moveTo: spot,
      grade: force ? 'best' : 'bad',
      headline: force ? '포스아웃' : '세이프! 태그해야 했어요',
      result: force ? outRes : safeRes,
      feedback: force
        ? `${runner}는 밀려서 뛰는 주자라, 공을 받고 베이스만 밟으면 아웃이에요. 가장 빠르고 확실해요.`
        : `${runner}는 ${via ? '포스가 풀려서' : '밀려서 뛰는 주자가 아니라서'} 베이스만 밟아서는 아웃이 안 돼요. 주자를 직접 태그해야 해요.`,
    },
    {
      label: '주자 태그',
      moveTo: spot,
      grade: force ? 'ok' : 'best',
      headline: force ? '태그아웃 (밟기만 해도 됐어요)' : '태그아웃',
      result: outRes,
      feedback: force
        ? `태그해도 아웃이지만, ${runner}는 밀려서 뛰는 주자라 베이스만 밟으면 돼요. 태그는 시간이 더 걸리고 놓칠 수 있어요.`
        : `${runner}는 ${via ? '포스가 풀려서' : '밀려서 뛰는 주자가 아니라서'} 직접 태그해야 아웃이에요. 공을 받자마자 베이스 앞에 글러브를 내려 주자를 태그했어요.`,
    },
  ];
}

const NO_RUNNERS = { first: false, second: false, third: false };
const ON_FIRST = { first: true, second: false, third: false };

export const SCENARIOS: Scenario[] = [
  // ---------------- 투수 ----------------
  {
    id: 'p-dp',
    kind: 'throw',
    title: '1사 1루 / 투수 앞 땅볼',
    event: '투수 정면 강습 땅볼',
    position: 'P',
    situation: { outs: 1, runners: ON_FIRST, batter: 'R' },
    brief: '병살 대형이에요. 공을 던지고 나면 바로 수비수예요. 투수 앞 땅볼이면 유격수가 2루 커버를 들어가요.',
    fielders: { ...DP, ...HOLD_1B },
    batted: { type: 'grounder', catchPoint: P(0.3, 16.3), travelTime: 0.6 },
    covers: { first: '1B', second: 'SS', third: '3B', home: 'C' },
    explanation:
      '투수 앞 땅볼은 공이 아주 빨리 오는 대신, 잡고 나면 시간이 넉넉해요. 1루 주자는 밀려서 뛰어야 하니 2루로 던져 앞 주자를 잡고, 유격수가 1루로 이어 던지면 병살(1-6-3)이에요. ' +
      '공이 오기 전에 미리 2루로 정해 두는 게 요령이에요. 투수 앞 땅볼은 생각할 틈 없이 오니까요. 여유가 있다고 2루 쪽으로 몸을 너무 돌리다 송구가 빗나가는 것만 조심하세요.',
  },
  {
    id: 'p-loaded',
    kind: 'throw',
    title: '1사 만루 / 투수 앞 땅볼',
    event: '투수 정면 땅볼',
    position: 'P',
    situation: { outs: 1, runners: { first: true, second: true, third: true }, batter: 'R' },
    brief: '만루라 모든 주자가 밀려서 뛰어요. 내야는 병살 대형이에요.',
    fielders: { ...DP },
    batted: { type: 'grounder', catchPoint: P(0.6, 15.8), travelTime: 0.75 },
    covers: { first: '1B', second: 'SS', third: '3B', home: 'C' },
    explanation:
      '만루에서는 홈도 포스 상황이라 포수가 홈 베이스만 밟으면 아웃이에요. 투수 자리에서 홈은 가장 가까운 베이스이기도 해요. ' +
      '홈에서 3루 주자를 잡고 포수가 1루로 이어 던지면 병살(1-2-3)로 실점 없이 이닝이 끝나요. 2루를 거치는 병살(1-6-3)도 좋은 판단이에요. 다만 병살이 안 되면 3루 주자의 득점이 인정되니, 가까운 홈에서 실점부터 막는 쪽이 더 안전해요.',
  },
  {
    id: 'p-third',
    kind: 'throw',
    title: '1사 3루 / 투수 앞 땅볼',
    event: '투수 앞 1루 쪽 땅볼',
    position: 'P',
    situation: { outs: 1, runners: { first: false, second: false, third: true }, batter: 'R' },
    brief: '내야는 보통 수비 위치예요. 3루 주자가 홈을 노릴 수 있는 상황이에요.',
    batted: { type: 'grounder', catchPoint: P(3, 15.5), travelTime: 0.85 },
    covers: { first: '1B', second: '2B', third: '3B', home: 'C' },
    runnerActs: { third: 'hold' },
    explanation:
      '투수 앞 땅볼이면 3루 주자는 공이 투수에게 가는 걸 보고 대부분 3루에 멈춰요. 3루 주자는 밀려서 뛰는 게 아니라서, 멈춰 있으면 홈으로 던져도 잡을 주자가 없어요. ' +
      '잡으면 먼저 3루 주자를 한 번 쳐다봐서 묶어 두고, 1루로 던져 타자를 잡으세요. 주자가 뛰었다면 그때는 홈으로 던져 태그 승부예요.',
  },
  {
    id: 'p-bunt',
    kind: 'throw',
    title: '무사 1루 / 투수 앞 번트',
    event: '투수 앞 강한 번트',
    position: 'P',
    situation: { outs: 0, runners: ON_FIRST, batter: 'R' },
    brief: '번트 수비 대형이에요. 1루수와 3루수가 대시하고, 2루수가 1루, 유격수가 2루를 커버해요. 투수도 공을 던지자마자 앞으로 나와요.',
    fielders: { ...DP, '1B': P(19.5, 19), '3B': P(-18.5, 20) },
    fielderMoves: { '1B': P(8, 12), '3B': P(-8, 12) },
    batted: { type: 'bunt', catchPoint: P(0.5, 12), travelTime: 1.2 },
    covers: { first: '2B', second: 'SS', home: 'C' },
    explanation:
      '번트가 투수 정면으로 강하게 왔어요. 투수는 홈 쪽으로 내려오면서 잡기 때문에 2루가 몸 정면이라 던지기 편해요. 2루에서 앞 주자를 잡고 유격수가 1루로 이어 던지면 병살까지 노릴 수 있어요. ' +
      '번트가 느렸다면 앞으로 많이 뛰어나와 잡게 되니, 그때는 무리하지 말고 1루로 던지세요.',
  },
  {
    id: 'p-cover-1b',
    kind: 'choice',
    setup: 'cover',
    title: '무사 주자 없음 / 1, 2루간 땅볼',
    event: '1, 2루간 땅볼',
    position: 'P',
    situation: { outs: 0, runners: NO_RUNNERS, batter: 'R' },
    brief: '보통 수비 위치예요. 공을 던진 뒤 타구가 어디로 가는지 보고 바로 움직여야 해요.',
    play: { fielder: '1B', catchPoint: P(13, 30), travelTime: 1.6, base: 'first', batted: 'grounder', coverMargin: 0.6 },
    prompt: '1, 2루간 땅볼! 어디로?',
    options: [
      {
        label: '1루 베이스 커버',
        moveTo: P(19.0, 19.6),
        grade: 'best',
        takes: true,
        headline: '1루 아웃',
        result: '1아웃 주자 없음',
        feedback: '1루수가 공을 잡으러 2루 쪽으로 멀리 갔어요. 바로 1루로 달려가서 1루수의 송구를 받았어요.',
      },
      {
        label: '공 쪽으로 대시',
        moveTo: P(8, 26),
        grade: 'bad',
        headline: '1루가 비었어요',
        result: '무사 2루',
        feedback: '공은 1루수가 잡아요. 투수까지 공을 쫓으면 1루에 아무도 없어서, 1루수가 던질 곳이 없어요.',
      },
      {
        label: '제자리',
        moveTo: P(0, 18.44),
        grade: 'bad',
        headline: '1루가 비었어요',
        result: '무사 2루',
        feedback: '1루수는 공을 잡으러 갔고 1루에는 아무도 없어서, 송구가 빠졌어요.',
      },
    ],
    explanation:
      '1루수 쪽으로 땅볼이 가면 투수는 무조건 1루로 달려가요. 1루수가 공을 잡으러 베이스에서 멀어지면, 1루를 지킬 사람은 투수뿐이거든요. ' +
      '공을 던지자마자 1루 쪽 땅볼이 보이면 "내가 1루"라고 생각하고 바로 출발하세요. 투수 수비에서 가장 많이 까먹는 플레이예요. 베이스 쪽으로 곧장 가기보다 1루 라인 안쪽으로 비스듬히 들어가면 1루수와 부딪히지 않아요.',
  },
  {
    id: 'p-backup-home',
    kind: 'choice',
    setup: 'backup',
    title: '1사 2루 / 중전 안타',
    event: '중전 안타',
    position: 'P',
    situation: { outs: 1, runners: { first: false, second: true, third: false }, batter: 'R' },
    brief: '보통 수비 위치예요. 2루 주자는 안타가 나오면 홈을 노려요.',
    fielderMoves: { '1B': P(1.5, 14) },
    backup: { fielder: 'CF', field: P(0.8, 57.5), travelTime: 2.8, base: 'home' },
    prompt: '중견수 앞 안타! 어디로?',
    options: [
      {
        label: '홈 뒤 백업',
        moveTo: P(0, -7),
        grade: 'best',
        takes: true,
        headline: '송구가 빠졌지만 백업으로 막았어요',
        result: '1아웃 1루 (1점 실점)',
        feedback: '중견수의 홈 송구가 포수 뒤로 빠졌지만, 홈 뒤에 있던 투수가 막아서 타자 주자는 1루에서 멈췄어요.',
      },
      {
        label: '마운드와 홈 사이 커트',
        moveTo: P(-1.5, 12),
        grade: 'bad',
        headline: '홈 뒤가 비었어요',
        result: '1아웃 3루 (1점 실점)',
        feedback: '커트는 1루수 몫이에요. 투수까지 커트 자리에 가면 홈 뒤를 받칠 사람이 없어서, 송구가 빠지자 공이 백네트까지 굴러갔어요.',
      },
      {
        label: '제자리',
        moveTo: P(0, 18.44),
        grade: 'bad',
        headline: '홈 뒤가 비었어요',
        result: '1아웃 3루 (1점 실점)',
        feedback: '송구가 포수 뒤로 빠졌는데 아무도 없어서, 공이 백네트까지 굴러가는 사이 타자 주자가 3루까지 갔어요.',
      },
    ],
    explanation:
      '주자가 홈을 노리는 안타가 나오면 외야수는 홈으로 던지고, 투수는 홈 뒤로 달려가 백업해요. 송구가 빠지거나 포수가 놓쳐도 공이 멀리 굴러가지 않게 막는 거예요. ' +
      '커트는 1루수가 맡으니 투수는 망설이지 말고 홈 뒤 파울 지역으로 가세요. 안타를 맞으면 아쉬운 마음에 마운드에 서 있기 쉬운데, 그게 가장 흔한 실수예요.',
  },
  {
    id: 'p-backup-third',
    kind: 'choice',
    setup: 'backup',
    title: '1사 1루 / 우전 안타',
    event: '우전 안타',
    position: 'P',
    situation: { outs: 1, runners: ON_FIRST, batter: 'R' },
    brief: '보통 수비 위치예요. 1루 주자는 안타가 나오면 3루까지 노려요.',
    fielderMoves: { '3B': P(-18.9, 19.9), SS: P(-6, 30) },
    backup: { fielder: 'RF', field: P(22, 52), travelTime: 2.4, base: 'third' },
    prompt: '우익수 앞 안타! 어디로?',
    options: [
      {
        label: '3루 뒤 백업',
        moveTo: P(-26.5, 13.8),
        grade: 'best',
        takes: true,
        headline: '송구가 빠졌지만 백업으로 막았어요',
        result: '1아웃 1, 3루',
        feedback: '우익수의 3루 송구가 3루수 뒤로 빠졌지만, 3루 뒤에 있던 투수가 막아서 주자는 3루에서 멈췄어요.',
      },
      {
        label: '1루 커버',
        moveTo: P(19.0, 19.6),
        grade: 'bad',
        headline: '3루 뒤가 비었어요',
        result: '1아웃 2루 (1점 실점)',
        feedback: '타자 주자는 이미 1루를 돌았어요. 3루 뒤를 받칠 사람이 없어서 송구가 빠지자 1루 주자는 홈까지 들어왔어요.',
      },
      {
        label: '제자리',
        moveTo: P(0, 18.44),
        grade: 'bad',
        headline: '3루 뒤가 비었어요',
        result: '1아웃 2루 (1점 실점)',
        feedback: '송구가 3루수 뒤로 빠졌는데 아무도 없어서, 1루 주자는 홈까지 들어오고 타자 주자는 2루까지 갔어요.',
      },
    ],
    explanation:
      '주자 1루에서 우전 안타가 나오면 1루 주자는 3루까지 노리고, 우익수는 3루로 던져요. 이 송구는 가장 긴 송구라 빠지기도 쉬워요. ' +
      '그래서 투수는 3루 뒤 파울 지역으로 달려가 백업해요. "공이 가는 베이스의 뒤"가 투수의 자리라고 기억하면 쉬워요. 홈으로 던지면 홈 뒤, 3루로 던지면 3루 뒤예요.',
  },

  {
    id: 'p-wildpitch',
    kind: 'choice',
    setup: 'wildpitch',
    title: '1사 3루 / 폭투',
    event: '폭투 (공이 포수 뒤로 빠짐)',
    position: 'P',
    situation: { outs: 1, runners: { first: false, second: false, third: true }, batter: 'R' },
    brief: '변화구가 원바운드로 들어가요. 포수가 못 막으면 공이 뒤로 빠지고, 3루 주자가 홈을 노려요.',
    prompt: '공이 뒤로 빠졌다! 어디로?',
    options: [
      {
        label: '홈 커버',
        moveTo: P(-0.9, 1.2),
        grade: 'best',
        takes: true,
        headline: '홈에서 태그아웃',
        result: '2아웃 주자 없음',
        feedback: '포수가 공을 주우러 간 사이 홈을 지키고 있다가, 포수 송구를 받아 3루 주자를 태그했어요.',
      },
      {
        label: '마운드에 그대로',
        moveTo: P(0, 18.44),
        grade: 'bad',
        headline: '홈이 비었어요',
        result: '1아웃 주자 없음, 1점 내줌',
        feedback: '포수가 공을 주웠지만 홈에 받아 줄 사람이 없어서 던지지 못했어요. 3루 주자가 그대로 들어왔어요.',
      },
      {
        label: '3루 커버',
        moveTo: P(-18.8, 19.6),
        grade: 'bad',
        headline: '홈이 비었어요',
        result: '1아웃 주자 없음, 1점 내줌',
        feedback: '3루 주자는 이미 홈으로 뛰었어요. 비어 있는 건 3루가 아니라 홈이에요. 포수가 던질 곳이 없어서 1점을 줬어요.',
      },
    ],
    explanation:
      '폭투나 패스트볼로 공이 포수 뒤로 빠지면, 포수는 공을 주우러 뒤로 가고 홈이 비어요. 이때 홈을 막을 수 있는 건 투수뿐이에요. ' +
      '공이 빠지는 걸 보자마자 홈으로 달려가 포수 송구를 받아 태그하세요. 홈 플레이트 앞쪽(3루 쪽)에 서서, 주자를 몸으로 막지 말고 태그만 하는 게 안전해요.',
  },
  {
    id: 'p-wildpitch-2',
    kind: 'choice',
    setup: 'wildpitch',
    title: '2사 2, 3루 / 패스트볼',
    event: '패스트볼 (공이 포수 뒤로 빠짐)',
    position: 'P',
    situation: { outs: 2, runners: { first: false, second: true, third: true }, batter: 'R' },
    brief: '2사 2, 3루예요. 공이 포수 미트를 맞고 뒤로 빠지면 주자들이 한 베이스씩 노려요.',
    prompt: '공이 뒤로 빠졌다! 어디로?',
    options: [
      {
        label: '홈 커버',
        moveTo: P(-0.9, 1.2),
        grade: 'best',
        takes: true,
        headline: '홈에서 태그아웃',
        result: '3아웃, 이닝 종료',
        feedback: '홈으로 들어온 3루 주자를 태그해서 이닝을 끝냈어요.',
      },
      {
        label: '3루 커버',
        moveTo: P(-18.8, 19.6),
        grade: 'bad',
        headline: '홈이 비었어요',
        result: '2아웃 3루, 1점 내줌',
        feedback: '2루 주자가 3루로 오는 게 보였겠지만, 먼저 막아야 하는 건 점수가 나는 홈이에요. 홈이 비어서 3루 주자가 들어왔어요.',
      },
      {
        label: '마운드에 그대로',
        moveTo: P(0, 18.44),
        grade: 'bad',
        headline: '홈이 비었어요',
        result: '2아웃 3루, 1점 내줌',
        feedback: '포수가 공을 주웠지만 홈에 받아 줄 사람이 없어서 던지지 못했어요.',
      },
    ],
    explanation:
      '공이 뒤로 빠지면 투수는 무조건 홈 커버예요. 주자가 여럿이어도 점수가 나는 홈이 가장 중요해요. ' +
      '2아웃이라 홈에서 3루 주자를 잡으면 그대로 이닝이 끝나요. 포수가 공을 줍는 동안 홈 앞(3루 쪽)에 자리 잡고 송구를 기다리세요.',
  },
  {
    id: 'p-liner',
    kind: 'throw',
    title: '무사 1루 / 투수 직선타',
    event: '투수 정면 직선타 (히트 앤드 런)',
    position: 'P',
    situation: { outs: 0, runners: ON_FIRST, batter: 'R' },
    brief: '투구와 동시에 1루 주자가 2루로 뛰었어요(히트 앤드 런). 공을 던진 직후, 투수 정면으로 강한 타구가 날아와요.',
    fielders: { ...DP, ...HOLD_1B },
    batted: { type: 'liner', catchPoint: P(0.4, 17.2), travelTime: 0.3 },
    covers: { first: '1B', second: 'SS', third: '3B', home: 'C' },
    hitAndRun: true,
    explanation:
      '땅에 닿기 전에 잡은 타구(직선타)는 잡는 순간 타자가 아웃이에요. 주자는 원래 베이스로 돌아가야(귀루) 하고, 돌아오기 전에 공이 그 베이스에 먼저 닿으면 주자도 아웃이에요. ' +
      '히트 앤드 런으로 1루 주자가 2루 쪽으로 멀리 나가 있으니, 잡자마자 1루로 던지면 한 번에 아웃 2개예요. 공을 던진 직후라 몸이 기울어 있어도, 잡았으면 서두르지 말고 1루수에게 정확히 던지세요. 2루에는 돌아오는 주자가 없어서 던져도 소용없어요.',
  },
  // ---------------- 1루수 ----------------
  {
    id: '1b-hold',
    kind: 'choice',
    setup: 'pickoff',
    title: '무사 1루 / 투구 전 위치',
    event: '투구 전 수비 위치',
    position: '1B',
    situation: { outs: 0, runners: ON_FIRST, batter: 'R' },
    brief: '투수가 세트 포지션에 들어가기 전이에요. 1루수는 어디에 서 있어야 할까요?',
    prompt: '투구 전에 어디에 설까?',
    options: [
      {
        label: '1루에 붙어서 견제 대비',
        moveTo: P(20.0, 18.7),
        grade: 'best',
        takes: true,
        headline: '주자를 1루에 묶었어요',
        result: '무사 1루',
        feedback: '1루수가 베이스에 붙어 있으니 투수가 바로 견제할 수 있었고, 주자는 급히 귀루했어요.',
      },
      {
        label: '평소 수비 위치',
        moveTo: P(21.5, 24.5),
        grade: 'bad',
        headline: '주자가 쉽게 2루를 훔쳤어요',
        result: '무사 2루',
        feedback: '베이스가 비어 있으면 투수가 견제를 못 해요. 주자가 리드를 크게 하고 편하게 도루했어요.',
      },
      {
        label: '2루 쪽으로 이동',
        moveTo: P(15, 30),
        grade: 'bad',
        headline: '주자가 쉽게 2루를 훔쳤어요',
        result: '무사 2루',
        feedback: '1루에서 더 멀어져서 견제가 불가능해요. 주자가 리드를 크게 하고 편하게 도루했어요.',
      },
    ],
    explanation:
      '1루 주자를 베이스 근처에 묶어 두는 걸 홀딩이라고 해요. 1루수가 베이스에 붙어 있으면 투수가 언제든 견제할 수 있어서 주자가 리드를 짧게 할 수밖에 없고, 도루도 어려워져요. ' +
      '2아웃에 점수 차가 클 때는 일부러 안 붙기도 하지만, 기본은 붙는 거예요.',
  },
  {
    id: '1b-liner',
    kind: 'throw',
    title: '1사 1루 / 1루수 직선타',
    event: '정면 직선타 (히트 앤드 런)',
    position: '1B',
    situation: { outs: 1, runners: ON_FIRST, batter: 'R' },
    brief: '투구와 동시에 1루 주자가 2루로 뛰었어요(히트 앤드 런). 1루수 정면으로 강한 타구가 날아와요.',
    fielders: HOLD_1B,
    batted: { type: 'liner', catchPoint: P(20.8, 20.2), travelTime: 0.35 },
    covers: { second: '2B', third: '3B', home: 'C' },
    selfBases: ['first'],
    hitAndRun: true,
    explanation:
      '땅에 닿기 전에 잡은 타구(직선타)는 잡는 순간 타자가 아웃이에요. 이때 주자는 원래 있던 베이스로 돌아가야(귀루) 하고, 돌아오기 전에 공이 그 베이스에 먼저 닿으면 주자도 아웃이에요. ' +
      '1루가 바로 옆이니 직접 밟으면 한 번에 아웃 2개예요. 2루에는 돌아오는 주자가 없어서 던져도 소용없어요.',
  },
  {
    id: '1b-361',
    kind: 'throw',
    title: '1사 1루 / 1루수 땅볼',
    event: '정면 땅볼',
    position: '1B',
    situation: { outs: 1, runners: ON_FIRST, batter: 'R' },
    brief: '투구 후 1루수는 베이스에서 떨어져 수비 위치로 나왔어요. 1루수 쪽으로 땅볼이 와요. 투수가 1루 커버를 들어가요.',
    fielders: { '1B': P(21, 25), ...DP },
    batted: { type: 'grounder', catchPoint: P(20, 27), travelTime: 1.4 },
    covers: { first: 'P', second: 'SS', third: '3B', home: 'C' },
    selfBases: ['first'],
    explanation:
      '1루를 먼저 밟으면 타자는 아웃이지만, 그 순간 1루 주자는 더 이상 밀려서 뛰는 게 아니게 돼요(포스 해제). 그러면 2루에서는 베이스만 밟아선 안 되고 태그를 해야 해서 병살이 어려워져요. ' +
      '그래서 2루로 먼저 던지고, 유격수가 1루 커버를 들어온 투수에게 던지는 게(3-6-1 병살) 정석이에요. 판단이 늦었다면 1루를 직접 밟아 아웃 하나를 챙기세요.',
  },
  {
    id: '1b-bunt',
    kind: 'throw',
    title: '무사 1루 / 1루 쪽 번트',
    event: '1루 쪽 번트',
    position: '1B',
    situation: { outs: 0, runners: ON_FIRST, batter: 'R' },
    brief: '타자가 번트 자세예요. 1루수는 앞으로 대시하고, 2루수가 1루 커버, 유격수가 2루 커버를 들어가요.',
    fielders: HOLD_1B,
    fielderMoves: { '3B': P(-13, 12) },
    batted: { type: 'bunt', catchPoint: P(7, 9), travelTime: 1.8 },
    covers: { first: '2B', second: 'SS', third: '3B', home: 'C' },
    explanation:
      '희생번트는 공격 팀이 아웃 하나를 내주고 주자를 2루로 보내려는 작전이에요. 수비는 공을 빨리 잡아서 2루에서 선행 주자를 잡을 수 있으면 잡고, 늦었으면 1루에서 확실하게 아웃 하나를 챙겨요. ' +
      '2루 송구는 판단이 조금만 늦어도 세이프가 되니, 망설여지면 1루로 던지세요.',
  },
  {
    id: '1b-cutoff',
    kind: 'choice',
    setup: 'cutoff',
    title: '1사 2루 / 중전 안타',
    event: '중전 안타',
    position: '1B',
    situation: { outs: 1, runners: { first: false, second: true, third: false }, batter: 'R' },
    brief: '1루수는 평소보다 조금 앞에 있어요. 타구가 투수 옆을 지나 중견수 앞으로 굴러가요.',
    fielders: { '1B': P(21, 22) },
    prompt: '어디로 움직일까?',
    options: [
      {
        label: '마운드와 홈 사이 커트 위치',
        moveTo: P(1.5, 14),
        grade: 'best',
        takes: true,
        headline: '커트로 타자 주자를 1루에 묶었어요',
        result: '1아웃 1, 3루',
        feedback: '중견수의 홈 송구를 중간에서 끊었어요. 2루 주자는 3루에서 멈췄고, 타자 주자도 2루를 노리지 못했어요.',
      },
      {
        label: '1루 지키기',
        moveTo: P(19.2, 19.8),
        grade: 'bad',
        headline: '타자 주자가 2루까지 갔어요',
        result: '1아웃 2, 3루',
        feedback: '송구를 끊어줄 사람이 없어서 공이 홈까지 가는 사이에 타자 주자가 공짜로 2루까지 갔어요.',
      },
      {
        label: '홈 뒤 백업',
        moveTo: P(0, -7),
        grade: 'bad',
        headline: '타자 주자가 2루까지 갔어요',
        result: '1아웃 2, 3루',
        feedback: '홈 뒤 백업은 투수 몫이에요. 커트맨이 없어서 공이 홈까지 가는 사이 타자 주자가 2루까지 갔어요.',
      },
    ],
    explanation:
      '주자 2루에서 외야 안타가 나오면 2루 주자는 홈을 노리고, 외야수는 홈으로 던져요. 중견수와 우익수의 홈 송구는 보통 1루수가 커트맨이에요. ' +
      '송구 길목(마운드와 홈 사이)에 커트맨이 서 있으면, 홈 승부가 안 될 때 공을 중간에서 잘라 다른 주자를 잡거나 묶을 수 있어요. 커트맨이 없으면 공이 홈까지 가는 사이 타자 주자가 공짜로 한 베이스를 더 가요.',
  },

  {
    id: '1b-cover',
    kind: 'choice',
    setup: 'cover',
    title: '무사 주자 없음 / 유격수 땅볼',
    event: '유격수 땅볼',
    position: '1B',
    situation: { outs: 0, runners: NO_RUNNERS, batter: 'R' },
    brief: '1루수는 평소보다 조금 깊게 서 있어요. 타구가 어디로 가는지 보고 바로 움직여야 해요.',
    fielders: { '1B': P(23, 28) },
    play: { fielder: 'SS', catchPoint: P(-9.5, 32), travelTime: 1.5, base: 'first', batted: 'grounder' },
    prompt: '유격수 쪽 땅볼! 어디로?',
    options: [
      {
        label: '1루 베이스 커버',
        moveTo: P(19.0, 19.6),
        grade: 'best',
        takes: true,
        headline: '1루 아웃',
        result: '1아웃 주자 없음',
        feedback: '바로 1루로 달려가 베이스에 발을 대고 유격수 송구를 받았어요.',
      },
      {
        label: '공 쪽으로 대시',
        moveTo: P(10, 27),
        grade: 'bad',
        headline: '1루가 비었어요',
        result: '무사 2루',
        feedback: '공은 유격수가 잡아요. 1루수까지 공을 쫓으면 송구를 받을 사람이 없어서, 공이 빠지는 사이 타자가 2루까지 갔어요.',
      },
      {
        label: '제자리',
        moveTo: P(23, 28),
        grade: 'bad',
        headline: '1루가 비었어요',
        result: '무사 2루',
        feedback: '1루에 아무도 없어서 유격수 송구가 빠졌고, 타자가 2루까지 갔어요.',
      },
    ],
    explanation:
      '내야 땅볼은 대부분 1루에서 아웃을 잡아요. 그래서 공이 다른 내야수 쪽으로 가면 1루수는 곧바로 1루 베이스로 달려가 발을 베이스에 대고 송구를 기다려야 해요. ' +
      '너무 당연해 보이지만, 공을 구경하느라 늦게 출발하는 실수가 가장 흔해요.',
  },
  {
    id: '1b-2out',
    kind: 'throw',
    title: '2사 1루 / 1루 베이스 근처 땅볼',
    event: '1루 베이스 근처 땅볼',
    position: '1B',
    situation: { outs: 2, runners: ON_FIRST, batter: 'R' },
    brief: '투구 후 1루수는 베이스에서 떨어져 수비 위치로 나왔어요. 1루 베이스 근처로 땅볼이 와요.',
    fielders: { '1B': P(21, 25), ...DP },
    batted: { type: 'grounder', catchPoint: P(19.8, 22), travelTime: 1.3 },
    covers: { first: 'P', second: 'SS', third: '3B', home: 'C' },
    selfBases: ['first'],
    explanation:
      '2아웃이면 아웃 하나로 이닝이 끝나요. 바로 옆 1루를 직접 밟는 게 가장 빠르고 확실해요. ' +
      '2루로 던져도 아웃은 되지만, 멀리 던질수록 실책 위험이 커지고 2루로 뛰는 1루 주자가 송구 길목에 있어요.',
  },

  {
    id: '1b-step',
    kind: 'throw',
    title: '무사 1루 / 1루 베이스 근처 땅볼',
    event: '1루 베이스 근처 땅볼',
    position: '1B',
    situation: { outs: 0, runners: ON_FIRST, batter: 'R' },
    brief: '병살 대형이에요. 1루수는 베이스에서 떨어져 수비 위치에 있고, 투수가 1루 커버를 들어가요. 1루 베이스 근처로 땅볼이 와요.',
    fielders: { ...DP, '1B': P(21, 25) },
    batted: { type: 'grounder', catchPoint: P(19.8, 22), travelTime: 1.3 },
    covers: { first: 'P', second: 'SS', third: '3B', home: 'C' },
    selfBases: ['first'],
    explanation:
      '1루 주자는 밀려서 뛰니 2루는 베이스만 밟아도 아웃(포스아웃)이에요. 2루로 먼저 던지고 1루로 돌려받으면(투수 커버) 둘 다 포스아웃이라 가장 확실한 병살이에요(3-6-1). ' +
      '1루를 먼저 밟아도 병살은 되지만, 타자가 아웃되는 순간 1루 주자의 포스가 풀려서 2루에서는 주자를 직접 태그해야 해요. 유격수가 그걸 모르고 베이스만 밟으면 세이프예요. 1루를 먼저 밟았다면 2루로 던지면서 "태그!"라고 알려 주세요.',
  },
  {
    id: '1b-loaded',
    kind: 'throw',
    title: '무사 만루 / 1루 베이스 근처 땅볼',
    event: '1루 베이스 근처 땅볼',
    position: '1B',
    situation: { outs: 0, runners: { first: true, second: true, third: true }, batter: 'R' },
    brief: '무사 만루예요. 내야는 병살 대형이고, 1루수는 베이스에서 떨어져 있어요. 1루 베이스 근처로 땅볼이 와요.',
    fielders: { ...DP, '1B': P(21, 25) },
    batted: { type: 'grounder', catchPoint: P(19.8, 22), travelTime: 1.3 },
    covers: { first: 'P', second: 'SS', third: '3B', home: 'C' },
    selfBases: ['first'],
    explanation:
      '만루에서는 홈까지 모든 베이스가 포스예요. 홈으로 던지면 포수가 홈을 밟아 3루 주자를 잡고, 1루로 이어 던져 병살(3-2-3)까지 돼서 실점 없이 아웃 2개예요. ' +
      '1루가 가깝다고 먼저 밟으면 다른 주자들의 포스가 모두 풀려요. 그러면 홈은 주자를 직접 태그해야 하는 어려운 플레이가 되고 실점 위험이 커져요. 만루에서는 "1루부터 밟지 말고 홈부터"를 기억하세요.',
  },
  {
    id: '1b-advance',
    kind: 'throw',
    title: '무사 2루 / 1루수 땅볼',
    event: '1루수 정면 땅볼',
    position: '1B',
    situation: { outs: 0, runners: { first: false, second: true, third: false }, batter: 'R' },
    brief: '보통 수비 위치예요. 1루수 정면으로 땅볼이 오면 2루 주자는 3루로 뛰어요.',
    batted: { type: 'grounder', catchPoint: P(20, 27), travelTime: 1.4 },
    covers: { first: 'P', second: 'SS', third: '3B', home: 'C' },
    selfBases: ['first'],
    runnerActs: { second: 'advance' },
    alsoGood: ['third'],
    explanation:
      '2루 주자는 뒤에 1루 주자가 없어서 밀려 뛰는 게 아니에요. 그래서 3루에서 잡으려면 베이스가 아니라 주자를 태그해야 하고, 1루수 자리에서 3루까지는 송구도 멀어요. ' +
      '1루와 3루 모두 좋은 판단이에요. 2루 주자의 스타트가 늦었거나 발이 느려서 3루에서 여유 있게 잡을 수 있으면, 앞 주자를 잡는 3루가 더 이득이에요(득점권 주자가 사라져요). ' +
      '반대로 주자가 맞자마자 스타트했거나 발이 빨라 3루가 아슬아슬하면, 무리하지 말고 확실한 1루 아웃을 챙기세요. 1루 베이스가 가까우면 직접 밟는 게 가장 빨라요.',
  },
  // ---------------- 2루수 ----------------
  {
    id: '2b-dp',
    kind: 'throw',
    title: '1사 1루 / 2루수 정면 땅볼',
    event: '정면 땅볼',
    position: '2B',
    situation: { outs: 1, runners: ON_FIRST, batter: 'R' },
    brief: '병살 대형으로 조금 앞당겨 서 있어요. 땅볼이 오면 유격수가 2루 커버를 들어와요.',
    fielders: { ...DP, ...HOLD_1B },
    batted: { type: 'grounder', catchPoint: P(8.5, 31.5), travelTime: 1.45 },
    covers: { first: '1B', second: 'SS', third: '3B', home: 'C' },
    explanation:
      '1루 주자는 타자가 치면 무조건 2루로 뛰어야 해서 2루는 베이스만 밟아도 아웃(포스아웃)이에요. 2루수가 2루로 던지고, 커버 들어온 유격수가 1루로 이어 던지면 병살(4-6-3)로 이닝이 끝나요. ' +
      '병살이 어려울 만큼 늦었어도 2루에서 앞 주자를 잡는 게 1루보다 나아요. 주자를 득점권(2루)에 남기지 않으니까요.',
  },
  {
    id: '2b-steal',
    kind: 'choice',
    setup: 'steal',
    title: '무사 1루 / 주자 도루',
    event: '1루 주자 도루',
    position: '2B',
    situation: { outs: 0, runners: ON_FIRST, batter: 'R' },
    brief: '투수가 공을 던지는 순간 주자가 뛰면 바로 움직여야 해요.',
    fielders: HOLD_1B,
    fielderMoves: { SS: P(-3, 44) },
    prompt: '주자가 뛰었다! 어디로?',
    options: [
      {
        label: '2루 커버',
        moveTo: P(0.6, 38.3),
        grade: 'best',
        takes: true,
        headline: '도루 저지!',
        result: '1아웃 주자 없음',
        feedback: '오른손 타자일 때는 2루수가 커버를 들어가요. 포수 송구를 받아 태그했어요.',
      },
      {
        label: '2루 뒤 백업',
        moveTo: P(3, 44),
        grade: 'bad',
        headline: '2루가 비었어요',
        result: '무사 3루',
        feedback: '오른손 타자일 때 커버는 2루수 몫이에요. 유격수도 백업으로 가서 아무도 2루에 없었고, 송구가 외야로 빠졌어요.',
      },
      {
        label: '제자리',
        moveTo: P(11, 36),
        grade: 'bad',
        headline: '2루가 비었어요',
        result: '무사 3루',
        feedback: '아무도 2루에 들어가지 않아서 포수 송구가 외야로 빠졌고, 주자는 3루까지 갔어요.',
      },
    ],
    explanation:
      '이 게임은 대부분의 타자가 오른손 타자라는 전제로 만들었어요. 오른손 타자일 때 도루 커버는 2루수가 들어가요. 오른손 타자는 3루·유격수 쪽으로 잡아당기는 타구가 많아서 유격수가 그 자리를 지켜야 하니까요. ' +
      '커버를 안 들어가는 유격수는 2루 뒤로 가서 포수 송구가 빠질 때를 대비(백업)해요. 팀마다 사인으로 바꾸기도 하니 경기 전에 서로 정해두는 게 가장 중요해요.',
  },
  {
    id: '2b-corners',
    kind: 'throw',
    title: '1사 1, 3루 / 2루수 땅볼',
    event: '정면 땅볼',
    position: '2B',
    situation: { outs: 1, runners: { first: true, second: false, third: true }, batter: 'R' },
    brief: '병살 대형이에요. 공이 맞으면 3루 주자는 홈으로 뛰어요. 땅볼이 오면 유격수가 2루 커버를 들어와요.',
    fielders: { ...DP, ...HOLD_1B },
    batted: { type: 'grounder', catchPoint: P(8.5, 31.5), travelTime: 1.45 },
    covers: { first: '1B', second: 'SS', third: '3B', home: 'C' },
    runnerActs: { third: 'advance' },
    explanation:
      '병살로 세 번째 아웃을 잡으면, 그 사이에 3루 주자가 홈을 밟아도 점수가 인정되지 않아요. 마지막 아웃이 포스아웃이면 득점이 무효가 되거든요. ' +
      '그래서 병살을 완성할 수 있으면 2루가 최선이에요. 하지만 판단이 늦어서 병살이 어렵다면, 2루 아웃 하나로는 1점을 주게 되니 홈으로 던져 3루 주자를 잡는 게 나아요.',
  },
  {
    id: '2b-advance',
    kind: 'throw',
    title: '무사 2루 / 2루수 땅볼',
    event: '정면 땅볼',
    position: '2B',
    situation: { outs: 0, runners: { first: false, second: true, third: false }, batter: 'R' },
    brief: '보통 수비 위치예요. 2루수 쪽 땅볼이면 2루 주자는 공이 자기 뒤로 가니까 3루로 뛰어요.',
    batted: { type: 'grounder', catchPoint: P(10, 33), travelTime: 1.45 },
    covers: { first: '1B', second: 'SS', third: '3B', home: 'C' },
    runnerActs: { second: 'advance' },
    explanation:
      '2루 주자는 뒤에 1루 주자가 없어서 밀려 뛰는 게 아니에요. 그래서 3루에서 잡으려면 베이스를 밟는 게 아니라 주자를 직접 태그해야 해요. ' +
      '잡자마자 던지면 3루 태그도 시간은 되고, 성공하면 득점권 주자를 지울 수 있어요. 하지만 2루수 자리에서 3루는 먼 데다 몸 반대 방향이라, 송구가 빗나가면 주자가 홈까지 들어와 실점까지 이어져요. ' +
      '그래서 둘 다 좋은 판단이에요. 자신 있으면 3루, 자신 없으면 확실한 1루 아웃을 챙기고 주자 3루를 받아들이세요.',
  },
  {
    id: '2b-relay',
    kind: 'choice',
    setup: 'gap',
    side: 'right',
    title: '무사 주자 없음 / 우중간 장타',
    event: '우중간 장타',
    position: '2B',
    situation: { outs: 0, runners: NO_RUNNERS, batter: 'R' },
    brief: '타구가 우중간을 가르고 펜스 쪽으로 굴러가요.',
    fielderMoves: { SS: P(-0.6, 38.3) },
    prompt: '어디로 움직일까?',
    options: [
      {
        label: '외야 쪽으로 나가 중계',
        moveTo: P(13, 58),
        grade: 'best',
        takes: true,
        headline: '빠른 중계로 2루타에서 막았어요',
        result: '무사 2루',
        feedback: '우익수와 2루를 잇는 직선 위에서 공을 받아줬어요. 공이 빨리 내야로 돌아와서 타자 주자가 2루에서 멈췄어요.',
      },
      {
        label: '2루 커버',
        moveTo: P(0.6, 38.3),
        grade: 'bad',
        headline: '중계가 없어서 3루타가 됐어요',
        result: '무사 3루',
        feedback: '2루 커버는 유격수가 들어가요. 2루수까지 2루로 가면 외야에서 오는 긴 송구를 이어줄 사람이 없어요.',
      },
      {
        label: '1루 커버',
        moveTo: P(19.2, 19.8),
        grade: 'bad',
        headline: '중계가 없어서 3루타가 됐어요',
        result: '무사 3루',
        feedback: '타자 주자는 이미 1루를 지났어요. 1루를 지킬 필요가 없고, 중계를 나가야 해요.',
      },
    ],
    explanation:
      '외야로 빠진 장타는 외야수가 혼자 내야까지 던지기엔 멀어요. 그래서 내야수가 중간까지 나가 공을 이어주는데, 이걸 중계(릴레이)라고 해요. ' +
      '우중간과 우익선상은 2루수, 좌중간과 좌익선상은 유격수가 중계를 나가고, 나머지 한 명은 2루를 커버해요.',
  },

  {
    id: '2b-bunt-cover',
    kind: 'choice',
    setup: 'cover',
    title: '무사 1루 / 번트 수비',
    event: '번트',
    position: '2B',
    situation: { outs: 0, runners: ON_FIRST, batter: 'R' },
    brief: '번트가 예상돼서 2루수는 평소보다 앞으로 나와 있어요. 투수가 공을 던지는 순간 타자가 번트 자세를 잡아요.',
    fielders: { ...HOLD_1B, '2B': P(12, 30) },
    fielderMoves: { SS: P(-0.6, 38.3), '3B': P(-12, 12) },
    play: { fielder: '1B', catchPoint: P(6, 9.5), travelTime: 1.8, base: 'first', batted: 'bunt' },
    prompt: '번트다! 어디로?',
    options: [
      {
        label: '1루 커버',
        moveTo: P(19.0, 19.6),
        grade: 'best',
        takes: true,
        headline: '1루 아웃',
        result: '1아웃 2루',
        feedback: '1루수가 번트를 잡으러 나간 사이 2루수가 1루를 커버해서 송구를 받았어요.',
      },
      {
        label: '2루 커버',
        moveTo: P(0.6, 38.4),
        grade: 'bad',
        headline: '1루가 비었어요',
        result: '무사 2, 3루',
        feedback: '2루 커버는 유격수 몫이에요. 1루수가 앞으로 나와 있어서 1루가 비었고, 송구가 빠졌어요.',
      },
      {
        label: '앞으로 대시',
        moveTo: P(10, 15),
        grade: 'bad',
        headline: '1루가 비었어요',
        result: '무사 2, 3루',
        feedback: '번트는 1루수, 3루수, 투수가 처리해요. 2루수까지 앞으로 오면 1루를 커버할 사람이 없어요.',
      },
    ],
    explanation:
      '번트 수비는 정해진 순서대로 움직이는 게 전부예요. 1루수와 3루수가 앞으로 대시하고, 2루수는 1루, 유격수는 2루를 커버해요. ' +
      '2루수가 1루 커버를 늦게 들어가면 번트를 잘 잡아도 던질 곳이 없어요. 타자가 번트 자세를 잡는 순간 바로 1루로 출발하세요.',
  },

  {
    id: '2b-cover',
    kind: 'choice',
    setup: 'cover',
    title: '1사 1루 / 유격수 땅볼',
    event: '유격수 땅볼',
    position: '2B',
    situation: { outs: 1, runners: ON_FIRST, batter: 'R' },
    brief: '병살 대형이에요. 타구가 어디로 가는지 보고 바로 움직여야 해요.',
    fielders: { ...DP, ...HOLD_1B },
    play: { fielder: 'SS', catchPoint: P(-8.5, 31.5), travelTime: 1.45, base: 'second', batted: 'grounder' },
    prompt: '유격수 쪽 땅볼! 어디로?',
    options: [
      {
        label: '2루 커버',
        moveTo: P(0.6, 38.4),
        grade: 'best',
        takes: true,
        headline: '2루 포스아웃',
        result: '2아웃 1루',
        feedback: '유격수 송구를 2루에서 받아 앞 주자를 잡았어요. 바로 1루로 이어 던지면 병살(6-4-3)까지 노릴 수 있어요.',
      },
      {
        label: '2루 뒤 백업',
        moveTo: P(3, 44),
        grade: 'bad',
        headline: '2루가 비었어요',
        result: '1아웃 1, 3루',
        feedback: '유격수가 공을 잡았으니 2루에 들어갈 사람은 2루수뿐이에요. 송구를 받을 사람이 없어서 공이 빠졌어요.',
      },
      {
        label: '1루 커버',
        moveTo: P(19.0, 19.6),
        grade: 'bad',
        headline: '2루가 비었어요',
        result: '1아웃 1, 3루',
        feedback: '1루는 1루수가 지켜요. 2루에 아무도 없어서 유격수 송구가 빠졌고, 1루 주자는 3루까지 갔어요.',
      },
    ],
    explanation:
      '유격수 쪽 땅볼이면 2루수가 2루 커버를 들어가 병살의 중간 연결을 맡아요(6-4-3). 2루수 쪽 땅볼이면 반대로 유격수가 들어가요. ' +
      '2루수는 2루에서 받으면 몸이 1루 쪽을 향하고 있어서 바로 던지기 편하지만, 1루 주자가 슬라이딩해 들어오니 받자마자 베이스를 밟고 빠지면서 던지세요.',
  },
  {
    id: '2b-liner',
    kind: 'throw',
    title: '1사 1, 2루 / 2루수 직선타',
    event: '정면 직선타 (히트 앤드 런)',
    position: '2B',
    situation: { outs: 1, runners: { first: true, second: true, third: false }, batter: 'R' },
    brief: '투구와 동시에 1루 주자와 2루 주자가 스타트했어요(히트 앤드 런). 2루수 정면으로 강한 타구가 날아와요.',
    fielders: { ...DP, ...HOLD_1B },
    batted: { type: 'liner', catchPoint: P(8.4, 33), travelTime: 0.45 },
    covers: { first: '1B', second: 'SS', third: '3B', home: 'C' },
    hitAndRun: true,
    explanation:
      '직선타는 잡는 순간 타자가 아웃이에요. 히트 앤드 런이라 1루 주자와 2루 주자 모두 다음 베이스 쪽으로 멀리 나가 있어서, 원래 베이스로 돌아가기 전에 그 베이스로 던지면 귀루 아웃이에요. ' +
      '1사라 아웃 하나만 더하면 이닝이 끝나요. 유격수가 들어오는 2루가 가깝지만 1루도 여유가 있어서, 둘 중 정확히 던질 수 있는 쪽이면 돼요.',
  },
  {
    id: '2b-2out',
    kind: 'throw',
    title: '2사 1, 2루 / 2루수 땅볼',
    event: '2루수 정면 땅볼',
    position: '2B',
    situation: { outs: 2, runners: { first: true, second: true, third: false }, batter: 'R' },
    brief: '2사 1, 2루예요. 2아웃이라 공이 맞으면 주자들은 모두 뛰어요. 2루수 정면으로 땅볼이 와요.',
    batted: { type: 'grounder', catchPoint: P(10, 33), travelTime: 1.45 },
    covers: { first: '1B', second: 'SS', third: '3B', home: 'C' },
    explanation:
      '2아웃이면 아웃 하나로 이닝이 끝나요. 주자가 1, 2루라 1루·2루·3루가 모두 포스아웃이라, 여유 있게 잡을 수 있는 곳 어디로 던져도 좋은 판단이에요. ' +
      '보통은 송구가 짧고 확실한 1루나, 유격수가 들어오는 2루로 토스하는 게 가장 안전해요. 3루도 아웃은 되지만 송구가 길어서 굳이 고를 이유는 없어요.',
  },
  {
    id: '2b-receive',
    kind: 'choice',
    setup: 'receive',
    title: '1사 1루 / 3루수 땅볼 (2루에서 받기)',
    event: '3루수 정면 땅볼',
    position: '2B',
    situation: { outs: 1, runners: ON_FIRST, batter: 'R' },
    brief: '병살 대형이에요. 3루수 쪽 땅볼이면 2루수가 2루 커버를 들어가고, 3루수가 2루로 던져요. 받으면 밟을까, 태그할까?',
    fielders: { ...DP, ...HOLD_1B },
    receive: { fielder: '3B', catchPoint: P(-20, 25.5), travelTime: 1.25, base: 'second', force: true },
    prompt: '3루수가 2루로 던진다! 받으면?',
    options: receiveOptions({ outs: 1, runners: ON_FIRST, batter: 'R' }, 'second', true, false, RECEIVE_SPOT.second['2B']),
    explanation:
      '1루 주자는 타자에게 밀려서 2루로 뛰는 주자예요(포스). 그래서 2루에서 공을 받으면 베이스만 밟아도 아웃이에요. ' +
      '태그해도 아웃이 되긴 하지만, 주자를 찾아 글러브를 내리는 만큼 느려지고 슬라이딩에 놓칠 수도 있어요. 포스면 밟고, 바로 1루로 이어 던질 준비를 하세요.',
  },
  // ---------------- 유격수 ----------------
  {
    id: 'ss-dp',
    kind: 'throw',
    title: '1사 1루 / 유격수 정면 땅볼',
    event: '정면 땅볼',
    position: 'SS',
    situation: { outs: 1, runners: ON_FIRST, batter: 'R' },
    brief: '병살 대형으로 조금 앞당겨 서 있어요. 땅볼이 오면 2루수가 2루 커버를 들어와요.',
    fielders: { ...DP, ...HOLD_1B },
    batted: { type: 'grounder', catchPoint: P(-8.2, 31.2), travelTime: 1.45 },
    covers: { first: '1B', second: '2B', third: '3B', home: 'C' },
    explanation:
      '1루 주자는 타자가 공을 치면 무조건 2루로 뛰어야 해요. 그래서 2루는 태그 없이 베이스만 밟아도 아웃(포스아웃)이에요. ' +
      '2루에서 아웃을 잡고 바로 1루로 이어 던지면 한 번에 아웃 2개, 병살로 이닝이 끝나요. ' +
      '판단이 늦어서 병살이 어려워도 2루에서 앞 주자를 잡는 게 1루보다 나아요. 주자를 득점권(2루)에 남기지 않으니까요. ' +
      '3루와 홈에는 뛰어오는 주자가 없어서 던져도 아웃을 잡을 수 없어요.',
  },
  {
    id: 'ss-2out',
    kind: 'throw',
    title: '2사 2루 / 유격수 땅볼',
    event: '정면 땅볼',
    position: 'SS',
    situation: { outs: 2, runners: { first: false, second: true, third: false }, batter: 'R' },
    brief: '보통 수비 위치예요. 2아웃이라 주자는 공이 맞는 순간 무조건 뛰어요.',
    batted: { type: 'grounder', catchPoint: P(-10, 32.5), travelTime: 1.5 },
    covers: { first: '1B', second: '2B', third: '3B', home: 'C' },
    explanation:
      '2아웃이면 아웃 하나만 잡으면 이닝이 끝나요. 2루 주자는 뒤에 1루 주자가 없어서 밀려 뛰는 게 아니라, 3루에서 잡으려면 주자를 직접 태그해야 해서 위험해요. ' +
      '반면 타자 주자는 무조건 1루로 뛰어야 하니까 1루는 베이스만 밟으면 아웃(포스아웃)이에요. 가장 확실한 1루로 던지는 게 최선이에요.',
  },
  {
    id: 'ss-liner',
    kind: 'throw',
    title: '1사 1루 / 유격수 직선타',
    event: '정면 직선타 (히트 앤드 런)',
    position: 'SS',
    situation: { outs: 1, runners: ON_FIRST, batter: 'R' },
    brief: '투구와 동시에 1루 주자가 2루로 뛰었어요(히트 앤드 런). 2루수는 2루 커버를 들어가요. 유격수 정면으로 강한 타구가 날아와요.',
    fielders: HOLD_1B,
    fielderMoves: { '2B': P(0.6, 38.3) },
    batted: { type: 'liner', catchPoint: P(-10, 34.5), travelTime: 0.45 },
    covers: { first: '1B', second: '2B', third: '3B', home: 'C' },
    hitAndRun: true,
    explanation:
      '땅에 닿기 전에 잡은 타구(직선타)는 잡는 순간 타자가 아웃이에요. 이때 주자는 원래 있던 베이스로 돌아가야(귀루) 하고, 돌아오기 전에 공이 그 베이스에 먼저 가면 주자도 아웃이에요. ' +
      '1루 주자가 2루 쪽으로 멀리 나가 있으니 1루로 던지면 한 번에 아웃 2개! 2루에는 돌아오는 주자가 없어서 던져도 소용없어요.',
  },
  {
    id: 'ss-steal',
    kind: 'choice',
    setup: 'steal',
    title: '무사 1루 / 주자 도루',
    event: '1루 주자 도루',
    position: 'SS',
    situation: { outs: 0, runners: ON_FIRST, batter: 'R' },
    brief: '투수가 공을 던지는 순간 주자가 뛰면 바로 움직여야 해요.',
    fielders: HOLD_1B,
    fielderMoves: { '2B': P(0.6, 38.3) },
    otherCovers: true,
    prompt: '주자가 뛰었다! 어디로?',
    options: [
      {
        label: '2루 뒤 백업',
        moveTo: P(-3, 44),
        grade: 'best',
        headline: '완벽한 백업',
        result: '1아웃 주자 없음',
        feedback: '오른손 타자라 2루수가 커버를 들어갔고, 유격수는 뒤에서 송구가 빠질 때를 대비했어요.',
      },
      {
        label: '2루 커버',
        moveTo: P(-0.6, 38.3),
        grade: 'ok',
        headline: '커버가 둘이에요',
        result: '1아웃 주자 없음',
        feedback: '아웃은 잡았지만 2루수와 둘 다 2루에 들어갔어요. 송구가 빠졌다면 막을 사람이 없어서 주자가 3루까지 갔을 거예요.',
      },
      {
        label: '제자리',
        moveTo: P(-11, 35.5),
        grade: 'bad',
        headline: '백업이 없었어요',
        result: '1아웃 주자 없음',
        feedback: '이번엔 송구가 잘 와서 아웃이 됐지만, 빠졌다면 백업이 없어서 주자가 3루까지 갔을 거예요.',
      },
    ],
    explanation:
      '이 게임은 대부분의 타자가 오른손 타자라는 전제로 만들었어요. 오른손 타자일 때 도루 커버는 2루수가 들어가요. 오른손 타자는 3루·유격수 쪽으로 잡아당기는 타구가 많아서 유격수가 그 자리를 지켜야 하니까요. ' +
      '그렇다고 유격수가 가만히 있으면 안 되고, 2루 뒤로 가서 포수 송구가 빠질 때를 대비(백업)해요. 팀마다 사인으로 바꾸기도 하니 경기 전에 서로 정해두는 게 가장 중요해요.' +
      ' 공이 가는 곳마다 그 뒤를 받쳐주는 사람이 있어야 실책 하나가 실점으로 이어지지 않아요.',
  },
  {
    id: 'ss-relay',
    kind: 'choice',
    setup: 'gap',
    side: 'left',
    title: '무사 주자 없음 / 좌중간 장타',
    event: '좌중간 장타',
    position: 'SS',
    situation: { outs: 0, runners: NO_RUNNERS, batter: 'R' },
    brief: '타구가 좌중간을 가르고 펜스 쪽으로 굴러가요.',
    fielderMoves: { '2B': P(0.6, 38.3) },
    prompt: '어디로 움직일까?',
    options: [
      {
        label: '외야 쪽으로 나가 중계',
        moveTo: P(-13, 58),
        grade: 'best',
        takes: true,
        headline: '빠른 중계로 2루타에서 막았어요',
        result: '무사 2루',
        feedback: '좌익수와 2루를 잇는 직선 위에서 공을 받아줬어요. 공이 빨리 내야로 돌아와서 타자 주자가 2루에서 멈췄어요.',
      },
      {
        label: '2루 커버',
        moveTo: P(-0.6, 38.3),
        grade: 'bad',
        headline: '중계가 없어서 3루타가 됐어요',
        result: '무사 3루',
        feedback: '2루 커버는 2루수가 들어가요. 유격수까지 2루로 가면 외야에서 오는 긴 송구를 이어줄 사람이 없어요.',
      },
      {
        label: '3루 커버',
        moveTo: P(-19, 20),
        grade: 'bad',
        headline: '중계가 없어서 3루타가 됐어요',
        result: '무사 3루',
        feedback: '3루는 3루수가 지켜요. 유격수가 중계를 안 나가면 좌익수의 긴 송구가 내야까지 오는 데 너무 오래 걸려요.',
      },
    ],
    explanation:
      '외야로 빠진 장타는 외야수가 혼자 내야까지 던지기엔 멀어요. 그래서 내야수가 중간까지 나가 공을 이어주는데, 이걸 중계(릴레이)라고 해요. ' +
      '좌중간과 좌익선상은 유격수, 우중간과 우익선상은 2루수가 중계를 나가고, 나머지 한 명은 2루를 커버해요.',
  },

  {
    id: 'ss-cover',
    kind: 'choice',
    setup: 'cover',
    title: '1사 1루 / 2루수 땅볼',
    event: '2루수 땅볼',
    position: 'SS',
    situation: { outs: 1, runners: ON_FIRST, batter: 'R' },
    brief: '병살 대형이에요. 타구가 어디로 가는지 보고 바로 움직여야 해요.',
    fielders: { ...DP, ...HOLD_1B },
    play: { fielder: '2B', catchPoint: P(8.5, 31.5), travelTime: 1.45, base: 'second', batted: 'grounder' },
    prompt: '2루수 쪽 땅볼! 어디로?',
    options: [
      {
        label: '2루 커버',
        moveTo: P(-0.6, 38.4),
        grade: 'best',
        takes: true,
        headline: '2루 포스아웃',
        result: '2아웃 1루',
        feedback: '2루수 송구를 2루에서 받아 앞 주자를 잡았어요. 바로 1루로 이어 던지면 병살(4-6-3)까지 노릴 수 있어요.',
      },
      {
        label: '2루 뒤 백업',
        moveTo: P(-3, 44),
        grade: 'bad',
        headline: '2루가 비었어요',
        result: '1아웃 1, 3루',
        feedback: '2루수가 공을 잡았으니 2루에 들어갈 사람은 유격수뿐이에요. 송구를 받을 사람이 없어서 공이 빠졌어요.',
      },
      {
        label: '제자리',
        moveTo: P(-9, 34),
        grade: 'bad',
        headline: '2루가 비었어요',
        result: '1아웃 1, 3루',
        feedback: '2루에 아무도 없어서 2루수 송구가 빠졌고, 1루 주자는 3루까지 갔어요.',
      },
    ],
    explanation:
      '2루수 쪽 땅볼이면 유격수가 2루 커버를 들어가 병살의 중간 연결을 맡아요(4-6-3). 반대로 유격수 쪽 땅볼이면 2루수가 들어가요. ' +
      '"공을 잡지 않은 쪽이 2루로 간다"고 기억하면 쉬워요. 커버가 늦으면 병살은커녕 앞 주자도 못 잡아요. 받은 다음에는 바로 1루로 이어 던져야 병살이 완성돼요.',
  },
  {
    id: 'ss-hole',
    kind: 'throw',
    title: '무사 1, 2루 / 유격수 깊은 땅볼',
    event: '3루 쪽 깊은 땅볼',
    position: 'SS',
    situation: { outs: 0, runners: { first: true, second: true, third: false }, batter: 'R' },
    brief: '병살 대형이에요. 3루 쪽으로 깊은 땅볼이 와요.',
    fielders: { ...DP, ...HOLD_1B },
    batted: { type: 'grounder', catchPoint: P(-15, 28), travelTime: 1.5 },
    covers: { first: '1B', second: '2B', third: '3B', home: 'C' },
    explanation:
      '1, 2루라 3루도 포스 상황이에요. 3루 쪽 깊은 타구라 3루가 가장 가까워요. 3루에서 앞 주자를 잡으면 득점권에서 가장 위험한 주자를 지울 수 있고, 3루수가 1루로 이어 던지면 병살까지 돼요. ' +
      '2루를 거치는 병살도 가능하지만, 그러면 3루에 주자가 남아요.',
  },

  {
    id: 'ss-loaded',
    kind: 'throw',
    title: '무사 만루 / 유격수 땅볼',
    event: '유격수 정면 땅볼',
    position: 'SS',
    situation: { outs: 0, runners: { first: true, second: true, third: true }, batter: 'R' },
    brief: '무사 만루예요. 내야는 병살 대형이에요. 유격수 정면으로 땅볼이 와요.',
    fielders: DP,
    batted: { type: 'grounder', catchPoint: P(-8.5, 31.5), travelTime: 1.45 },
    covers: { first: '1B', second: '2B', third: '3B', home: 'C' },
    explanation:
      '만루에서는 홈도 포스예요. 홈으로 던지면 포수가 홈을 밟아 3루 주자를 잡고 1루로 이어 던져 병살까지 노릴 수 있어서, 실점 없이 아웃 2개예요. ' +
      '2루나 3루로 시작하는 병살도 아웃 2개지만 그 사이 3루 주자가 들어와 1점을 줘요. 무사라 실점을 막는 홈이 가장 좋아요. 다만 판단이 늦어 홈이 아슬아슬해지면, 2루(6-4-3)로 병살을 노리세요.',
  },
  {
    id: 'ss-runner2',
    kind: 'throw',
    title: '무사 2루 / 유격수 땅볼',
    event: '유격수 정면 땅볼',
    position: 'SS',
    situation: { outs: 0, runners: { first: false, second: true, third: false }, batter: 'R' },
    brief: '무사 2루예요. 유격수 쪽 땅볼인데 2루 주자가 3루로 뛰어요.',
    batted: { type: 'grounder', catchPoint: P(-10, 32), travelTime: 1.4 },
    covers: { first: '1B', second: '2B', third: '3B', home: 'C' },
    runnerActs: { second: 'advance' },
    explanation:
      '유격수 쪽 땅볼은 2루 주자 앞으로 굴러가는 타구라 원래는 뛰면 안 되는 상황이에요. 그런데 주자가 3루로 뛰었다면, 바로 옆 3루로 던져 앞 주자를 잡을 기회예요. ' +
      '3루는 포스가 아니라 3루수가 주자를 태그해야 하지만, 송구가 짧고 시간 여유가 커서 충분히 잡혀요. 앞 주자를 지우면 득점권 주자가 사라져서 1루 아웃보다 훨씬 이득이에요.',
  },
  {
    id: 'ss-receive',
    kind: 'choice',
    setup: 'receive',
    title: '1사 1루 / 1루수 땅볼 (2루에서 받기)',
    event: '1루 베이스 근처 땅볼',
    position: 'SS',
    situation: { outs: 1, runners: ON_FIRST, batter: 'R' },
    brief: '병살 대형이에요. 1루수 쪽 땅볼이면 유격수가 2루 커버를 들어가요. 1루수가 공을 잡아 1루를 먼저 밟고 2루로 던져요. 받으면 밟을까, 태그할까?',
    fielders: { ...DP, '1B': P(21, 25) },
    receive: { fielder: '1B', catchPoint: P(19.8, 22), travelTime: 1.3, base: 'second', force: false, via: 'step1' },
    prompt: '1루수가 1루를 밟고 2루로 던진다! 받으면?',
    options: receiveOptions({ outs: 1, runners: ON_FIRST, batter: 'R' }, 'second', false, true, RECEIVE_SPOT.second.SS),
    explanation:
      '1루수가 1루를 먼저 밟아 타자를 잡았어요. 타자가 아웃되는 순간 1루 주자는 더 이상 밀리지 않아서 포스가 풀려요. ' +
      '그래서 2루에서는 베이스만 밟아서는 아웃이 안 되고, 주자를 직접 태그해야 해요. 1루수가 던지기 전에 "태그!"라고 외쳐 주는 게 좋지만, 받는 쪽도 앞에서 무슨 일이 있었는지 보고 스스로 판단해야 해요.',
  },
  // ---------------- 3루수 ----------------
  {
    id: '3b-bunt-charge',
    kind: 'choice',
    setup: 'bunt',
    title: '무사 1루 / 번트 자세',
    event: '번트 자세',
    position: '3B',
    situation: { outs: 0, runners: ON_FIRST, batter: 'R' },
    brief: '타자가 투구 전부터 번트 자세를 잡았어요. 3루수는 어떻게 대비해야 할까요?',
    fielders: HOLD_1B,
    fielderMoves: { '1B': P(7, 9), '2B': P(19, 19.8), SS: P(-0.6, 38.3) },
    prompt: '투구 때 어디로 움직일까?',
    options: [
      {
        label: '앞으로 대시',
        moveTo: P(-12, 11.5),
        grade: 'best',
        takes: true,
        headline: '번트를 빨리 잡아 1루 아웃',
        result: '1아웃 2루',
        feedback: '앞으로 나와 있었기 때문에 3루 쪽 번트를 바로 잡아서 여유 있게 1루로 던졌어요.',
      },
      {
        label: '제자리',
        moveTo: P(-21.5, 24),
        grade: 'bad',
        headline: '번트 안타가 됐어요',
        result: '무사 1, 2루',
        feedback: '3루수가 뒤에 있어서 투수가 마운드에서 뛰어와 처리해야 했고, 송구가 늦었어요.',
      },
      {
        label: '3루 베이스 커버',
        moveTo: P(-19, 20),
        grade: 'bad',
        headline: '번트 안타가 됐어요',
        result: '무사 1, 2루',
        feedback: '3루에는 주자가 없어서 지킬 필요가 없어요. 투수가 혼자 번트를 처리하느라 송구가 늦었어요.',
      },
    ],
    explanation:
      '번트가 예상되면 1루수와 3루수는 투구와 동시에 앞으로 대시해서 굴러오는 공을 빨리 잡아요. 그 사이 2루수는 1루, 유격수는 2루를 커버해요. ' +
      '번트 수비는 1초도 안 되는 차이로 아웃과 세이프가 갈려서, 미리 정해둔 대로 움직이는 게 전부예요.',
  },
  {
    id: '3b-tiebreak',
    kind: 'throw',
    title: '승부치기 무사 1, 2루 / 3루 쪽 번트',
    event: '3루 쪽 번트 (승부치기)',
    position: '3B',
    situation: { outs: 0, runners: { first: true, second: true, third: false }, batter: 'R' },
    brief: '승부치기 상황이에요. 타자가 3루 쪽으로 번트를 댔어요. 3루수는 대시했고, 유격수가 3루, 2루수가 1루 커버를 들어가요.',
    fielders: { '3B': P(-19.5, 21) },
    fielderMoves: { '1B': P(8, 12) },
    batted: { type: 'bunt', catchPoint: P(-11, 10.5), travelTime: 2.0 },
    covers: { first: '2B', third: 'SS', home: 'C' },
    explanation:
      '1, 2루에서는 두 주자 모두 밀려서 뛰기 때문에 3루도 베이스만 밟으면 아웃(포스아웃)이에요. 번트를 빨리 잡으면 3루로 던져 득점권의 앞 주자를 지우는 게 최선이에요. ' +
      '망설이면 3루도 1루도 다 놓칠 수 있어요. 2루는 유격수가 3루로 가서 비어 있으니 던질 수 없어요. 승부치기는 매번 이 상황으로 시작하니 꼭 몸에 익혀두세요.',
  },
  {
    id: '3b-infield-in',
    kind: 'throw',
    title: '1사 3루 / 전진 수비 땅볼',
    event: '정면 땅볼 (전진 수비)',
    position: '3B',
    situation: { outs: 1, runners: { first: false, second: false, third: true }, batter: 'R' },
    brief: '3루 주자의 득점을 막으려고 내야가 앞으로 나와 있어요(전진 수비). 공이 맞으면 3루 주자가 홈으로 뛰어요.',
    fielders: INFIELD_IN,
    batted: { type: 'grounder', catchPoint: P(-14, 15.5), travelTime: 0.9 },
    covers: { first: '1B', second: '2B', home: 'C' },
    selfBases: ['third'],
    runnerActs: { third: 'advance' },
    explanation:
      '전진 수비는 3루 주자의 득점을 막으려고 앞으로 나와 있는 거예요. 땅볼이 오면 홈으로! 3루 주자는 밀려 뛰는 게 아니라서 포수가 태그해야 하지만, 거리가 짧아 충분히 잡을 수 있어요. ' +
      '판단이 늦었다면 1루에서 아웃을 챙기는 게 나아요. 1점은 주지만 아웃 카운트는 늘어나요.',
  },
  {
    id: '3b-2out',
    kind: 'throw',
    title: '2사 만루 / 3루수 땅볼',
    event: '3루 베이스 근처 땅볼',
    position: '3B',
    situation: { outs: 2, runners: { first: true, second: true, third: true }, batter: 'R' },
    brief: '3루 베이스 근처로 땅볼이 와요.',
    batted: { type: 'grounder', catchPoint: P(-20.2, 21.8), travelTime: 1.2 },
    covers: { first: '1B', second: '2B', home: 'C' },
    selfBases: ['third'],
    explanation:
      '만루에서는 모든 주자가 밀려서 뛰기 때문에 어느 베이스든 밟기만 하면 아웃(포스아웃)이에요. 2아웃이니 아웃 하나면 이닝이 끝나요. ' +
      '그렇다면 가장 가깝고 확실한 곳, 바로 옆의 3루를 직접 밟는 게 최선이에요. 멀리 던질수록 송구 실책이 날 위험이 커져요.',
  },
  {
    id: '3b-dp',
    kind: 'throw',
    title: '1사 1루 / 3루수 땅볼',
    event: '정면 땅볼',
    position: '3B',
    situation: { outs: 1, runners: ON_FIRST, batter: 'R' },
    brief: '병살 대형이에요. 3루수 정면으로 땅볼이 와요. 2루수가 2루 커버를 들어가요.',
    fielders: { ...DP, ...HOLD_1B },
    batted: { type: 'grounder', catchPoint: P(-20, 25.5), travelTime: 1.25 },
    covers: { first: '1B', second: '2B', home: 'C' },
    selfBases: ['third'],
    explanation:
      '3루수 땅볼에 1루 주자가 있으면 2루로 던져 앞 주자를 잡고, 2루수가 1루로 이어 던지는 병살(5-4-3)이 정석이에요. ' +
      '3루수 자리에서 1루는 내야에서 가장 먼 송구라, 1루로 바로 던지는 것보다 2루를 거치는 게 아웃도 더 많이 잡고 덜 위험해요. 3루에는 뛰어오는 주자가 없어요.',
  },
  {
    id: '3b-slow',
    kind: 'throw',
    title: '무사 주자 없음 / 느린 땅볼',
    event: '3루 쪽 느린 땅볼',
    position: '3B',
    situation: { outs: 0, runners: NO_RUNNERS, batter: 'R' },
    brief: '빗맞은 타구가 3루 쪽으로 느리게 굴러와요. 3루수는 앞으로 뛰어나가 잡아요.',
    batted: { type: 'roller', catchPoint: P(-13, 14), travelTime: 2.1 },
    covers: { first: '1B', second: '2B', home: 'C' },
    selfBases: ['third'],
    explanation:
      '느린 땅볼은 앞으로 뛰어나와 잡자마자 1루로 던져야 해요. 공이 느린 만큼 타자 주자는 이미 1루 가까이 와 있어서, 잠깐만 망설여도 세이프가 돼요. ' +
      '다른 베이스에는 주자가 없으니 고민할 것도 없이 1루예요. 이 상황은 판단보다 속도를 연습하는 상황이에요.',
  },
  {
    id: '3b-liner',
    kind: 'throw',
    title: '무사 2, 3루 / 3루수 직선타',
    event: '3루수 정면 직선타',
    position: '3B',
    situation: { outs: 0, runners: { first: false, second: true, third: true }, batter: 'R' },
    brief: '무사 2, 3루예요. 주자들은 리드하고 있다가 타구를 보고 움직여요. 3루수 정면으로 강한 타구가 날아와요.',
    batted: { type: 'liner', catchPoint: P(-20.2, 23.2), travelTime: 0.35 },
    covers: { first: '1B', second: 'SS', home: 'C' },
    selfBases: ['third'],
    explanation:
      '직선타는 잡는 순간 타자가 아웃이에요. 3루 주자는 리드했다가 타구에 한 발 나와 있어서, 원래 베이스로 돌아가기 전에 3루를 밟으면 귀루 아웃이에요. ' +
      '3루가 바로 옆이니 던지지 말고 직접 밟는 게 가장 빨라요. 2루 주자는 2루 가까이 있어서 2루로 던져도 늦어요.',
  },
  {
    id: '3b-step',
    kind: 'throw',
    title: '1사 1, 2루 / 3루 베이스 근처 땅볼',
    event: '3루 베이스 근처 땅볼',
    position: '3B',
    situation: { outs: 1, runners: { first: true, second: true, third: false }, batter: 'R' },
    brief: '1사 1, 2루예요. 병살 대형이고, 3루 베이스 근처로 땅볼이 와요.',
    fielders: { ...DP, ...HOLD_1B },
    batted: { type: 'grounder', catchPoint: P(-20, 22), travelTime: 1.2 },
    covers: { first: '1B', second: '2B', home: 'C' },
    selfBases: ['third'],
    explanation:
      '주자가 1, 2루라 2루와 3루가 모두 포스예요. 3루 베이스 근처에서 잡았다면 직접 3루를 밟아 2루 주자를 잡고, 2루나 1루로 이어 던지면 병살이에요. ' +
      '3루를 밟아 2루 주자를 잡아도, 그 뒤의 1루 주자와 타자는 여전히 밀려서 뛰니까 2루와 1루는 계속 포스예요. 포스가 풀리는 건 아웃된 주자보다 앞에 있는 주자뿐이에요. ' +
      '2루로 바로 던져 시작하는 병살(5-4-3)도 좋은 판단이에요. 1사라 병살이면 이닝이 끝나요.',
  },
  {
    id: '3b-corners',
    kind: 'throw',
    title: '무사 1, 3루 / 3루수 땅볼',
    event: '3루수 정면 땅볼',
    position: '3B',
    situation: { outs: 0, runners: { first: true, second: false, third: true }, batter: 'R' },
    brief: '무사 1, 3루예요. 병살 대형이고, 3루 주자는 공이 맞으면 홈으로 뛰어요. 3루수 정면으로 땅볼이 와요.',
    fielders: { ...DP, ...HOLD_1B },
    batted: { type: 'grounder', catchPoint: P(-20, 25.5), travelTime: 1.25 },
    covers: { first: '1B', second: '2B', home: 'C' },
    selfBases: ['third'],
    runnerActs: { third: 'advance' },
    explanation:
      '병살 대형의 기본은 2루로 던져 병살(5-4-3)로 아웃 2개를 잡는 거예요. 1점은 주지만 무사에 아웃 2개를 잡아요. ' +
      '3루수는 홈과 가까워서 홈에서 3루 주자를 태그로 잡기도 쉬워요. 1점이 중요한 접전이나 경기 후반이면 홈 승부도 좋은 판단이에요. ' +
      '3루 주자가 홈으로 뛰는 걸 보고 3루를 밟아도 소용없어요. 3루 주자는 밀려서 뛰는 게 아니라서 3루는 포스아웃이 안 돼요.',
  },
  {
    id: '3b-receive',
    kind: 'choice',
    setup: 'receive',
    title: '무사 2루 / 유격수 땅볼 (3루에서 받기)',
    event: '유격수 정면 땅볼',
    position: '3B',
    situation: { outs: 0, runners: { first: false, second: true, third: false }, batter: 'R' },
    brief: '무사 2루예요. 유격수 쪽 땅볼에 2루 주자가 3루로 뛰고, 유격수가 3루로 던져요. 3루수는 3루 베이스로 들어가 받아요. 받으면 밟을까, 태그할까?',
    receive: { fielder: 'SS', catchPoint: P(-8.5, 31.5), travelTime: 1.45, base: 'third', force: false },
    prompt: '유격수가 3루로 던진다! 받으면?',
    options: receiveOptions({ outs: 0, runners: { first: false, second: true, third: false }, batter: 'R' }, 'third', false, false, RECEIVE_SPOT.third),
    explanation:
      '2루 주자 뒤(1루)에는 주자가 없어서, 2루 주자는 밀려서 뛰는 게 아니라 스스로 3루를 노린 거예요. 그래서 3루에서는 베이스만 밟아서는 아웃이 안 되고, 주자를 직접 태그해야 해요. ' +
      '만약 주자가 1, 2루였다면 2루 주자도 밀려서 뛰니 3루는 밟기만 해도 아웃이에요. 공을 받기 전에 "이 주자는 밀려서 오는가?"를 먼저 떠올리세요.',
  },
];

// 기본 상황 난이도: 1 기초(먼저 익힐 기본 원칙) / 2 응용 / 3 심화(상황에 따라 갈리거나 특수한 규칙)
const LEVELS: Record<string, 1 | 2 | 3> = {
  'p-dp': 1, 'p-cover-1b': 1,
  'p-bunt': 2, 'p-liner': 2, 'p-wildpitch': 2, 'p-backup-home': 2, 'p-backup-third': 2,
  'p-third': 3, 'p-loaded': 3, 'p-wildpitch-2': 3,
  '1b-cover': 1, '1b-hold': 1, '1b-2out': 1,
  '1b-361': 2, '1b-step': 2, '1b-liner': 2, '1b-bunt': 2, '1b-advance': 2,
  '1b-cutoff': 3, '1b-loaded': 3,
  '2b-dp': 1, '2b-cover': 1, '2b-steal': 1,
  '2b-receive': 2, '2b-2out': 2, '2b-bunt-cover': 2, '2b-relay': 2, '2b-liner': 2,
  '2b-advance': 3, '2b-corners': 3,
  'ss-dp': 1, 'ss-cover': 1, 'ss-steal': 1,
  'ss-2out': 2, 'ss-relay': 2, 'ss-liner': 2, 'ss-runner2': 2,
  'ss-hole': 3, 'ss-loaded': 3, 'ss-receive': 3,
  '3b-dp': 1, '3b-slow': 1, '3b-2out': 1,
  '3b-receive': 2, '3b-step': 2, '3b-liner': 2, '3b-bunt-charge': 2,
  '3b-infield-in': 3, '3b-corners': 3, '3b-tiebreak': 3,
};
const POS_ORDER: PositionId[] = ['P', '1B', '2B', 'SS', '3B'];
for (const s of SCENARIOS) s.level = LEVELS[s.id] ?? 2;
// 포지션별로 기초 → 응용 → 심화 순서로 정렬한다 (같은 난이도는 만든 순서). '다음 상황'도 이 순서를 따른다
SCENARIOS.sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || a.level! - b.level!);

export function scenariosFor(position: PositionId) {
  return SCENARIOS.filter((s) => s.position === position);
}
