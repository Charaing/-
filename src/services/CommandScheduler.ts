import type { Combination, Command, FootworkStep, Settings, Weight } from '../types';
import { FOOTWORK_STEPS, COACH_CUES } from '../data/footwork';
import { allowedDifficulties } from './CombinationDatabase';
import { comboLabel, comboRateMul, comboSpeech, comboSub } from '../utils/speech';

export type Rng = () => number;

export const WEIGHT_VALUE: Record<Weight, number> = { often: 3, normal: 1, rare: 0.35, excluded: 0 };

export interface SchedulerContext {
  settings: Settings;
  combos: Combination[];
  weights: Record<string, Weight>;
  rng?: Rng;
}

export interface SchedulerState {
  recentCombos: string[];
  recentSteps: string[];
  lastKinds: Command['kind'][];
  longStreak: number;
  indexInRound: number;
}

export const newSchedulerState = (): SchedulerState => ({ recentCombos: [], recentSteps: [], lastKinds: [], longStreak: 0, indexInRound: 0 });

/** 모드·난이도·가중치·제외 규칙을 반영한 콤비 후보 */
export function comboPool(ctx: SchedulerContext): Combination[] {
  const { settings: s, combos, weights } = ctx;
  const w = (c: Combination) => WEIGHT_VALUE[weights[c.id] ?? 'normal'];
  if (s.mode === 'custom') {
    const sel = new Set(s.customSelection);
    return combos.filter((c) => sel.has(c.id) && w(c) > 0);
  }
  if (s.mode === 'footwork') return [];
  const allowed = allowedDifficulties(s.difficulty);
  let pool = combos.filter((c) => allowed.includes(c.difficulty) && w(c) > 0);
  if (s.mode === 'technique') pool = pool.filter((c) => c.count <= 3);
  return pool;
}

export function stepPool(s: Settings): FootworkStep[] {
  if (s.mode === 'technique' || s.difficulty === 'beginner') return FOOTWORK_STEPS.filter((f) => f.basic);
  return [...FOOTWORK_STEPS];
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rng: Rng): T | undefined {
  const total = items.reduce((a, t) => a + Math.max(0, weight(t)), 0);
  if (total <= 0) return items.length ? items[Math.floor(rng() * items.length)] : undefined;
  let r = rng() * total;
  for (const t of items) {
    r -= Math.max(0, weight(t));
    if (r <= 0) return t;
  }
  return items[items.length - 1];
}

export function comboCommand(c: Combination, s: Settings): Command {
  return {
    kind: 'combo',
    text: comboSpeech(c.punches, s.readStyle, s.voiceStyle, s.stance),
    comboId: c.id,
    punches: c.punches,
    label: comboLabel(c.punches),
    sub: comboSub(c.punches, s.stance),
    minSec: 0.8 + c.count * 0.45,
    long: c.count >= 5,
    rateMul: comboRateMul(c.count, s.voiceStyle),
  };
}

function stepCommand(f: FootworkStep): Command {
  return { kind: 'footwork', text: f.speech, stepId: f.id, label: f.label, sub: '풋워크', minSec: f.minSec, long: false, rateMul: 1 };
}

function linkCommand(f: FootworkStep, c: Combination, s: Settings): Command {
  const combo = comboSpeech(c.punches, s.readStyle, s.voiceStyle === 'live' ? 'basic' : s.voiceStyle, s.stance).replace(/[.!]$/, '');
  return {
    kind: 'link',
    text: `${f.linkPrefix}, ${combo}!`,
    comboId: c.id,
    stepId: f.id,
    punches: c.punches,
    label: `${f.label} + ${comboLabel(c.punches)}`,
    sub: `${f.linkPrefix} · ${comboSub(c.punches, s.stance)}`,
    minSec: f.minSec + 0.8 + c.count * 0.45,
    long: false,
    rateMul: 0.97,
  };
}

function pickCombo(pool: Combination[], st: SchedulerState, ctx: SchedulerContext, rng: Rng, maxCount = 99): Combination | undefined {
  const { settings: s, weights } = ctx;
  let cands = pool.filter((c) => c.count <= maxCount);
  if (!cands.length) cands = pool;
  // 최근 n개 반복 회피 (후보가 부족하면 점점 완화)
  const limit = Math.min(s.recentLimit, Math.max(0, cands.length - 1));
  const recent = new Set(st.recentCombos.slice(-limit));
  const fresh = cands.filter((c) => !recent.has(c.id));
  if (fresh.length) cands = fresh;
  return weightedPick(
    cands,
    (c) => {
      let w = WEIGHT_VALUE[weights[c.id] ?? 'normal'];
      // 긴 콤비 연속 등장 억제
      if (c.count >= 5 && st.longStreak >= 1) w *= 0.25;
      if (c.count >= 5 && st.indexInRound < 2) w *= 0.5; // 라운드 초반 워밍업
      return w;
    },
    rng,
  );
}

function pickStep(pool: FootworkStep[], st: SchedulerState, rng: Rng, linkOnly = false): FootworkStep | undefined {
  let cands = linkOnly ? pool.filter((f) => f.linkPrefix) : pool;
  const last = st.recentSteps.slice(-2);
  const fresh = cands.filter((f) => !last.includes(f.id));
  if (fresh.length) cands = fresh;
  return cands[Math.floor(rng() * cands.length)];
}

/** 다음 명령 선택. 후보가 없으면 null */
export function nextCommand(ctx: SchedulerContext, st: SchedulerState): Command | null {
  const rng = ctx.rng ?? Math.random;
  const s = ctx.settings;
  const combos = comboPool(ctx);
  const steps = stepPool(s);

  let ratio: number; // 콤비 확률
  switch (s.mode) {
    case 'combo': ratio = 1; break;
    case 'footwork': ratio = 0; break;
    case 'custom': ratio = 1; break;
    case 'technique': ratio = 0.8; break;
    default: ratio = s.comboRatio / 100;
  }
  if (!combos.length) ratio = 0;
  if (s.mode !== 'footwork' && s.mode !== 'mix' && s.mode !== 'technique' && !combos.length) return null;

  // 풋워크 3연속 방지 (믹스)
  const lastTwo = st.lastKinds.slice(-2);
  if (s.mode === 'mix' && combos.length && lastTwo.length === 2 && lastTwo.every((k) => k === 'footwork')) ratio = 1;

  let cmd: Command | null = null;
  const cueChance = s.coachCues && s.mode !== 'custom' && s.mode !== 'footwork' ? (s.mode === 'technique' ? 0.08 : 0.05) : 0;
  const lastKind = st.lastKinds[st.lastKinds.length - 1];

  if (cueChance && st.indexInRound >= 3 && lastKind !== 'cue' && rng() < cueChance) {
    const t = COACH_CUES[Math.floor(rng() * COACH_CUES.length)];
    cmd = { kind: 'cue', text: t, label: t.replace('!', ''), sub: '코칭', minSec: 1.5, long: false, rateMul: 1 };
  } else if (rng() < ratio) {
    const canLink = s.mode === 'mix' && s.linkCommands && st.indexInRound >= 2 && lastKind !== 'link' && steps.some((f) => f.linkPrefix);
    if (canLink && rng() < 0.22) {
      const c = pickCombo(combos, st, ctx, rng, 3);
      const f = pickStep(steps, st, rng, true);
      if (c && f) cmd = linkCommand(f, c, s);
    }
    if (!cmd) {
      const c = pickCombo(combos, st, ctx, rng);
      if (c) cmd = comboCommand(c, s);
    }
  } else if (steps.length) {
    const f = pickStep(steps, st, rng);
    if (f) cmd = stepCommand(f);
  }
  if (!cmd) return null;
  recordCommand(st, cmd);
  return cmd;
}

export function recordCommand(st: SchedulerState, cmd: Command) {
  if (cmd.comboId) st.recentCombos = [...st.recentCombos, cmd.comboId].slice(-12);
  if (cmd.stepId) st.recentSteps = [...st.recentSteps, cmd.stepId].slice(-6);
  st.lastKinds = [...st.lastKinds, cmd.kind].slice(-6);
  st.longStreak = cmd.long ? st.longStreak + 1 : 0;
  st.indexInRound += 1;
}

/** 다음 명령까지의 간격(초) — 앞 명령의 음성이 끝난 시점부터 계산 */
export function gapAfter(cmd: Command, s: Settings, rng: Rng = Math.random): number {
  let base = s.intervalSec;
  if (s.mode === 'technique') base = base * 1.4 + 1;
  if (s.randomInterval && s.randomRange > 0) {
    const u = rng() * 2 - 1;
    base = base * (1 + (u * s.randomRange) / 100);
  }
  return Math.max(base, cmd.minSec, 2);
}

export function isPlayable(s: Settings, combos: Combination[], weights: Record<string, Weight>): { ok: boolean; reason?: string } {
  if (s.mode === 'footwork') return { ok: true };
  const pool = comboPool({ settings: s, combos, weights });
  if (s.mode === 'custom' && !pool.length) return { ok: false, reason: '커스텀 모드에 사용할 콤비네이션을 선택하세요.' };
  if ((s.mode === 'combo' || s.mode === 'technique') && !pool.length) return { ok: false, reason: '선택 가능한 콤비네이션이 없습니다. 제외 설정을 확인하세요.' };
  return { ok: true };
}
