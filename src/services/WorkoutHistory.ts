import type { WorkoutRecord } from '../types';
import { createStore } from '../stores/store';

export const historyStore = createStore<WorkoutRecord[]>([], 'bvc.history.v1', (raw) => (Array.isArray(raw) ? (raw as WorkoutRecord[]) : []));

const MAX_RECORDS = 500;

export function addRecord(r: WorkoutRecord) {
  historyStore.set((l) => [r, ...l.filter((x) => x.id !== r.id)].slice(0, MAX_RECORDS));
}

export function clearHistory() {
  historyStore.set([]);
}

export function deleteRecord(id: string) {
  historyStore.set((l) => l.filter((x) => x.id !== id));
}

export type HistoryRange = 'today' | 'd7' | 'd30' | 'all';

export function startOfToday(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function filterByRange(list: WorkoutRecord[], range: HistoryRange, now = Date.now()): WorkoutRecord[] {
  if (range === 'all') return list;
  const from = range === 'today' ? startOfToday(now) : now - (range === 'd7' ? 7 : 30) * 86400_000;
  return list.filter((r) => r.startedAt >= from);
}

export function summarize(list: WorkoutRecord[]) {
  return list.reduce(
    (a, r) => ({
      sessions: a.sessions + 1,
      workMs: a.workMs + r.workMs,
      totalMs: a.totalMs + r.totalMs,
      rounds: a.rounds + r.roundsCompleted,
      combos: a.combos + r.comboCount,
      footwork: a.footwork + r.footworkCount,
    }),
    { sessions: 0, workMs: 0, totalMs: 0, rounds: 0, combos: 0, footwork: 0 },
  );
}
