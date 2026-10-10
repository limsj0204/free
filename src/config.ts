// 판정과 연출에 쓰는 수치. WBD 영상을 보면서 조정하는 것을 전제로 한 곳에 모아둔다.
// 단위: 거리 m, 속도 m/s, 시간 s (게임 안의 시간 기준)

export const FIELD = {
  baseDistance: 27.43, // 베이스 사이 거리 (90ft)
  moundDistance: 18.44, // 홈에서 투수판까지
  fenceCenter: 100, // 가운데 펜스 거리
  fenceLine: 88, // 좌우 폴 거리
  fenceHeight: 2.6,
  infieldArcRadius: 29, // 마운드 중심 기준 내야 흙 반경
};

export const PITCH = {
  minKmh: 90,
  maxKmh: 140,
  windupTime: 0.9, // 투구 동작 시작부터 공을 놓을 때까지
};

export const RUN = {
  speed: 7.0, // 주자 달리기 속도
  fielderSpeed: 7.0, // 수비수가 베이스 커버나 위치 이동할 때 속도
  carrySpeed: 6.5, // 공을 들고 베이스를 직접 밟으러 갈 때 속도
  batterStartDelay: 0.35, // 타격 후 타자가 뛰기 시작하기까지
  buntBatterStartDelay: 0.4, // 번트 후 타자가 뛰기 시작하기까지
  runnerStartDelay: 0.15, // 타격 후 밀려서 뛰는 주자가 스타트하기까지
  buntRunnerStartDelay: 0.3, // 번트가 땅에 닿는 걸 보고 주자가 스타트하기까지
  advanceStartDelay: 0.5, // 안 밀려도 뛰는 주자가 타구를 보고 스타트하기까지
  returnReaction: 0.35, // 직선타가 잡힌 걸 보고 귀루를 시작하기까지
  leadOff: 3.0, // 주자 리드 거리
  hitAndRunExtra: 4.0, // 히트 앤드 런으로 투구 때 미리 뛰어나간 거리
  reaction: 0.15, // 위치 판단 후 첫발을 떼기까지
  coverStart: 0.2, // 타격 후 커버 들어가는 수비수가 움직이기 시작하기까지
  buntCoverStart: -0.5, // 번트 수비는 투구와 함께 움직인다 (타격 0.5초 전)
  buntJump: 0.5, // 스타트가 빠른 주자는 번트 때 이만큼 일찍 뛴다
};

export const THROW = {
  speed: 28, // 내야 송구 속도 (약 100km/h)
  tossSpeed: 16, // 가까운 거리 토스 속도
  tossMaxDistance: 8, // 이 거리 이하면 토스로 처리
  transferTime: 0.3, // 결정 후 공을 놓기까지 (글러브에서 빼고 던지는 동작)
  pivotTime: 0.45, // 베이스에서 받아서 다시 던지기까지
  tagTime: 0.15, // 태그 플레이에서 공을 받고 태그하기까지
  catcherSpeed: 30, // 포수 2루 송구 속도
  catcherPopTime: 0.75, // 포수가 공을 받고 던지기까지
  outfieldSpeed: 25, // 외야수 송구 속도
};

// 판단 점수: 아웃이 최우선이고, 실점과 주자 위치, 위험한 플레이를 차례로 감점한다.
export const VALUE = {
  out: 10,
  run: 8,
  tagPlay: 3, // 태그가 필요한 아웃은 실패 위험이 커서 감점
  perMeterThrown: 0.02, // 송구 거리가 길수록 실책 위험이 커서 감점
  bestTolerance: 0.3, // 최선과 이 정도 차이(송구 거리 약 15m)면 똑같이 최선으로 인정
  closeMargin: 0.2, // 정답 플레이가 잡자마자 던져도 이 시간 차이보다 아슬아슬하면, 확실한 아웃 쪽도 정답으로 인정
};

// 결정 순간의 슬로모션 배율. 1이면 실제 속도.
export const DIFFICULTIES = [
  { id: 'easy', label: '입문', timeScale: 0.2, desc: '아주 느리게. 상황을 천천히 보면서 판단' },
  { id: 'normal', label: '보통', timeScale: 0.35, desc: '느리게. 빠른 판단 연습의 시작' },
  { id: 'real', label: '실전', timeScale: 1, desc: '실제 속도. 대회와 같은 시간 압박' },
] as const;

export type DifficultyId = (typeof DIFFICULTIES)[number]['id'];

// 액션 모드: WASD로 직접 움직여 공을 잡고, 조준한 베이스로 좌클릭해서 던진다
export const ACTION = {
  catchRadius: 1.2, // 공이 이 거리 안으로 지나가면 잡힌다
  catchHeight: 1.5, // 땅볼은 이 높이 아래일 때만 잡힌다
  linerCatchHeight: 2.4, // 직선타는 이 높이까지 잡힌다
  stepRadius: 1.2, // 공을 든 채 베이스에 이만큼 다가가면 밟은 것으로 본다
  choiceRadius: 3, // 위치 판단: 선택지 위치에서 이 거리 안이면 그곳에 간 것으로 본다
  // 난이도는 플레이 전체 속도 (판단 순간에만 느려지지 않는다)
  speeds: { easy: 0.5, normal: 0.7, real: 1 } as Record<DifficultyId, number>,
};
