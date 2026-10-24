import type { ComboGroup, Combination, Difficulty, PunchCode } from '../types';
import { isPunchCode } from './punches';
import { coachTokens, joinWords } from '../utils/speech';

/** 명세서 7장의 기본 콤비네이션 100개 — 순서와 내용을 그대로 유지한다. */
export const RAW_COMBINATIONS: readonly string[] = [
  // A. 기본 콤비네이션 — 1~20
  '1-2', '1-1-2', '1-2-1', '1-2-1-2', '1-1-1-2', '1-2-3', '1-3-2', '1-2-3-2', '1-3-2-3', '2-3-2',
  '3-2', '3-2-3', '2-3-2-3', '1-3', '1-1-3', '1-2-4', '1-4-3', '1-2-3-4', '3-4-3', '1-3-2-3-2',
  // B. 훅과 직선 연결 — 21~40
  '2-3', '2-3-4', '3-4', '4-3', '1-2-4-3', '1-1-3-2', '1-1-2-3', '1-1-2-3-2', '1-2-1-3', '1-3-4',
  '1-4-3-2', '1-2-3-2-3', '1-2-3-4-3', '1-3-2-4', '1-2-1-2-3', '2-1-2', '3-2-1-2', '3-4-3-2', '1-1-3-4', '1-2-3-2-4',
  // C. 바디 포함 콤비네이션 — 41~60
  '1-2-3B', '1-2B-3', '1-3B-3', '1B-2', '1-2-3B-3', '1-2B-3B', '2-3B-2', '1-3B-2', '1B-2-3', '1-2B-3-2',
  '1-2-3B-2', '1-1-2B', '1-2B-3-2B', '1-3B-2-3', '1-2-3B-2B', '1B-1-2', '1-2B-3B-2', '1-1-2-3B', '1-2-3-2B', '1-3B-2B-3',
  // D. 다양한 높이의 펀치 연결 — 61~80
  '1-2-3-4B', '1-2-3B-4', '1B-2-3B', '1-2B-3-4', '1-3B-4-3', '1-2-3B-2-3', '1-2B-3-2-3', '1B-2-3-2', '1-2-3B-4B', '1-3-2B-3',
  '1-1-2B-3', '1-2-4B-3', '1-3B-2-4', '1B-2-3B-2', '1-2B-3B-2-3', '1-3-2B-3B', '1-2-3-4B-3', '1B-2-3-4', '1-2B-3-4B', '1-3B-4B-3',
  // E. 긴 콤비네이션 — 81~100
  '1-2-1-3-2', '1-2-3-2-3-2', '1-1-2-3B-2', '1-2-3B-3-2', '1-3-2-3B-2', '1-1-2B-3-2', '1-2-3-2B-3', '1-2B-3-2-3B', '1B-1-2-3-2', '1-2-3B-2-3B',
  '1-1-2-3-4-3', '1-2-3B-4B-3-2', '1-2B-3-2-3-2', '1-3B-2-3B-2', '1-2-3-4B-3-2', '1-1-2B-3B-2-3', '1-2B-3-4B-3-2', '1-2-3B-2B-3-2', '1-1-2-3B-3-2', '1-2-3-2-3B-2',
];

export const GROUP_NAMES: Record<ComboGroup, string> = {
  A: '기본',
  B: '훅·직선',
  C: '바디',
  D: '높이 변화',
  E: '롱 콤비',
  U: '내 콤비',
};

export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  beginner: '초급',
  intermediate: '중급',
  advanced: '고급',
};

export function parseSequence(seq: string): PunchCode[] {
  const parts = seq.split('-').map((s) => s.trim().toUpperCase());
  for (const p of parts) if (!isPunchCode(p)) throw new Error(`허용되지 않은 펀치 코드: ${p} (${seq})`);
  return parts as PunchCode[];
}

/**
 * 난이도 규칙
 * - 초급: 2~3연타, 바디 없음, 뒷손 훅(4) 없음 → 직선과 앞손 훅 위주
 * - 고급: 6연타, 또는 바디가 섞인 5연타, 또는 바디 펀치가 2개 이상인 4연타 이상
 * - 중급: 그 외 (2~5연타, 훅·바디 포함)
 */
export function difficultyOf(punches: PunchCode[]): Difficulty {
  const n = punches.length;
  const bodies = punches.filter((p) => p.endsWith('B')).length;
  const hasRearHook = punches.some((p) => p[0] === '4');
  if (n <= 3 && bodies === 0 && !hasRearHook) return 'beginner';
  if (n >= 6 || (n === 5 && bodies > 0) || (n >= 4 && bodies >= 2)) return 'advanced';
  return 'intermediate';
}

function groupOf(no: number): ComboGroup {
  return (['A', 'B', 'C', 'D', 'E'] as const)[Math.floor((no - 1) / 20)];
}

export function makeCombination(punches: PunchCode[], opts: { id: string; no: number; group: ComboGroup; custom?: boolean; name?: string }): Combination {
  return {
    id: opts.id,
    no: opts.no,
    punches,
    count: punches.length,
    hasBody: punches.some((p) => p.endsWith('B')),
    difficulty: difficultyOf(punches),
    group: opts.group,
    speech: joinWords(coachTokens(punches, 'orthodox').map((t) => t.text), 'live'),
    custom: opts.custom,
    name: opts.name,
  };
}

export const BUILTIN_COMBINATIONS: readonly Combination[] = RAW_COMBINATIONS.map((seq, i) =>
  makeCombination(parseSequence(seq), { id: `c${String(i + 1).padStart(3, '0')}`, no: i + 1, group: groupOf(i + 1) }),
);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** 명세서 7장 '콤비네이션 데이터 검증' */
export function validateCombinations(list: readonly Combination[], expectCount = 100): ValidationResult {
  const errors: string[] = [];
  if (list.length !== expectCount) errors.push(`콤비네이션 수가 ${list.length}개입니다 (기대값 ${expectCount}).`);
  const seen = new Map<string, string>();
  const ids = new Set<string>();
  for (const c of list) {
    const key = c.punches.join('-');
    if (seen.has(key)) errors.push(`중복 시퀀스 ${key}: ${seen.get(key)} / ${c.id}`);
    seen.set(key, c.id);
    if (ids.has(c.id)) errors.push(`중복 ID ${c.id}`);
    ids.add(c.id);
    if (c.count < 2 || c.count > 6) errors.push(`${c.id} 펀치 수 ${c.count} (2~6 범위 밖)`);
    for (const p of c.punches) if (!isPunchCode(p)) errors.push(`${c.id} 잘못된 코드 ${p}`);
    if (!c.speech || c.speech.length < 2) errors.push(`${c.id} 음성 문구 생성 실패`);
    if (!c.difficulty) errors.push(`${c.id} 난이도 없음`);
    if (/어퍼|upper|[56]/i.test(key + c.speech)) errors.push(`${c.id} 어퍼컷 포함`);
  }
  return { ok: errors.length === 0, errors };
}
