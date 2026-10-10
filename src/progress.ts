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
  mode?: 'judge' | 'action';
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
