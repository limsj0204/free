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
  batterStartDelay: 0.35, // 타격 후 타자가 뛰기 시작하기까지
  runnerStartDelay: 0.15, // 타격 후 1루 주자가 스타트하기까지
  leadOff: 3.0, // 1루 주자 리드 거리
};

export const THROW = {
  speed: 28, // 내야 송구 속도 (약 100km/h)
  tossSpeed: 16, // 가까운 거리 토스 속도
  tossMaxDistance: 8, // 이 거리 이하면 토스로 처리
  transferTime: 0.3, // 결정 후 공을 놓기까지 (글러브에서 빼고 던지는 동작)
  pivotTime: 0.45, // 2루수가 받아서 1루로 다시 던지기까지
};

export const GROUNDER = {
  travelTime: 1.45, // 타구가 유격수에게 도착하기까지
};

// 결정 순간의 슬로모션 배율. 1이면 실제 속도.
export const DIFFICULTIES = [
  { id: 'easy', label: '입문', timeScale: 0.2, desc: '아주 느리게. 상황을 천천히 보면서 판단' },
  { id: 'normal', label: '보통', timeScale: 0.35, desc: '느리게. 빠른 판단 연습의 시작' },
  { id: 'real', label: '실전', timeScale: 1, desc: '실제 속도. 대회와 같은 시간 압박' },
] as const;

export type DifficultyId = (typeof DIFFICULTIES)[number]['id'];
