import type { DifficultyId } from './config';
import type { Grade } from './scenario';

// 상황별 기록은 이 브라우저에만 저장한다. 저장이 막힌 환경에서도 게임은 그대로 돌아간다.
export interface Record {
  attempts: number;
  best: Grade;
  bestTime: number | null; // 최선의 판단을 했을 때 가장 빨랐던 판단 시간 (게임 시간)
}

interface Saved {
  records: { [id: string]: Record };
  difficulty?: DifficultyId;
  includeGenerated?: boolean;
  hideBall?: boolean;
  runHideBall?: boolean; // 주루 판단 시뮬레이터의 타구 숨기기 (내야 수비와 따로)
  runSkipIntro?: boolean; // 주루 판단 시작 화면(소개) 건너뛰기
  runIncludeGenerated?: boolean; // 주루 판단 랜덤 연습에 자동 생성 상황 섞기 (내야 수비와 따로, 기본은 끔)
  mode?: 'judge' | 'action';
  soundOn?: boolean;
  volume?: number; // 0~1
}

const KEY = 'infield-iq-progress-v1';
const RANK: { [g in Grade]: number } = { best: 2, ok: 1, bad: 0 };

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Saved;
  } catch {
    /* 저장소를 못 쓰면 빈 기록으로 시작 */
  }
  return { records: {} };
}

let saved = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* 저장 실패는 무시한다 */
  }
}

export function getRecord(id: string): Record | undefined {
  return saved.records[id];
}

export function addResult(id: string, grade: Grade, decisionTime: number) {
  const prev = saved.records[id];
  const rec: Record = prev ?? { attempts: 0, best: grade, bestTime: null };
  rec.attempts++;
  if (RANK[grade] > RANK[rec.best]) rec.best = grade;
  if (grade === 'best' && (rec.bestTime === null || decisionTime < rec.bestTime)) rec.bestTime = decisionTime;
  saved.records[id] = rec;
  persist();
}

export function getDifficulty(): DifficultyId {
  return saved.difficulty ?? 'normal';
}

export function setDifficulty(d: DifficultyId) {
  saved.difficulty = d;
  persist();
}

export function getIncludeGenerated(): boolean {
  return saved.includeGenerated ?? true;
}

export function setIncludeGenerated(on: boolean) {
  saved.includeGenerated = on;
  persist();
}

export function getHideBall(): boolean {
  return saved.hideBall ?? false;
}

export function setHideBall(on: boolean) {
  saved.hideBall = on;
  persist();
}

export function getRunHideBall(): boolean {
  return saved.runHideBall ?? false;
}

export function setRunHideBall(on: boolean) {
  saved.runHideBall = on;
  persist();
}

export function getRunSkipIntro(): boolean {
  return saved.runSkipIntro ?? false;
}

export function setRunSkipIntro(on: boolean) {
  saved.runSkipIntro = on;
  persist();
}

export function getRunIncludeGenerated(): boolean {
  return saved.runIncludeGenerated ?? false;
}

export function setRunIncludeGenerated(on: boolean) {
  saved.runIncludeGenerated = on;
  persist();
}

export function getMode(): 'judge' | 'action' {
  return saved.mode ?? 'judge';
}

export function setMode(m: 'judge' | 'action') {
  saved.mode = m;
  persist();
}

export function resetProgress() {
  saved = { records: {}, difficulty: saved.difficulty };
  persist();
}

export function getSoundOn(): boolean {
  return saved.soundOn ?? true;
}

export function setSoundOn(on: boolean) {
  saved.soundOn = on;
  persist();
}

export function getVolume(): number {
  return saved.volume ?? 0.6;
}

export function setVolume(v: number) {
  saved.volume = v;
  persist();
}
