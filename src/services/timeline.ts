import type { Segment, Settings } from '../types';

/** 준비 → (라운드 → 휴식) × n (마지막 휴식 없음) 구간 표 */
export function buildSegments(s: Pick<Settings, 'prepSec' | 'rounds' | 'roundSec' | 'restSec'>): Segment[] {
  const segs: Segment[] = [];
  let t = 0;
  const push = (phase: Segment['phase'], round: number, sec: number) => {
    segs.push({ phase, round, start: t, end: t + sec * 1000 });
    t += sec * 1000;
  };
  push('prep', 1, s.prepSec);
  for (let r = 1; r <= s.rounds; r++) {
    push('work', r, s.roundSec);
    if (r < s.rounds) push('rest', r + 1, s.restSec);
  }
  return segs;
}

export function totalMs(segs: Segment[]): number {
  return segs.length ? segs[segs.length - 1].end : 0;
}

export function locate(segs: Segment[], ms: number): { index: number; seg: Segment | null; remainingMs: number; elapsedMs: number } {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (ms < s.end) return { index: i, seg: s, remainingMs: s.end - ms, elapsedMs: Math.max(0, ms - s.start) };
  }
  return { index: segs.length, seg: null, remainingMs: 0, elapsedMs: 0 };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}시간 ${m}분`;
  if (m) return s ? `${m}분 ${s}초` : `${m}분`;
  return `${s}초`;
}

export function formatSec(sec: number): string {
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}
