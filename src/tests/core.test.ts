import { describe, expect, it } from 'vitest';
import { BUILTIN_COMBINATIONS, RAW_COMBINATIONS, validateCombinations, parseSequence } from '../data/combinations';
import { FOOTWORK_STEPS } from '../data/footwork';
import { PUNCH_CODES } from '../data/punches';
import { comboSpeech, coachTokens } from '../utils/speech';
import { comboPool, gapAfter, newSchedulerState, nextCommand } from '../services/CommandScheduler';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../services/SettingsManager';
import { buildSegments, locate, totalMs } from '../services/timeline';
import { LiveClock } from '../services/clock';
import type { Settings } from '../types';

const seeded = (seed = 42) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('콤비네이션 데이터', () => {
  it('정확히 100개', () => {
    expect(RAW_COMBINATIONS.length).toBe(100);
    expect(BUILTIN_COMBINATIONS.length).toBe(100);
  });
  it('검증 통과 (중복·코드·2~6펀치·음성·난이도)', () => {
    const v = validateCombinations(BUILTIN_COMBINATIONS);
    expect(v.errors).toEqual([]);
  });
  it('중복 시퀀스 없음', () => {
    expect(new Set(RAW_COMBINATIONS).size).toBe(100);
  });
  it('어퍼컷 없음 / 허용 코드만', () => {
    for (const c of BUILTIN_COMBINATIONS) for (const p of c.punches) expect(PUNCH_CODES).toContain(p);
    expect(() => parseSequence('1-2-5')).toThrow();
    expect(() => parseSequence('1-6')).toThrow();
  });
  it('모든 콤비가 3가지 읽기 방식 × 3가지 음성 스타일 × 2 스탠스로 문구 생성', () => {
    for (const c of BUILTIN_COMBINATIONS)
      for (const r of ['coach', 'number', 'formal'] as const)
        for (const v of ['basic', 'live', 'number'] as const)
          for (const st of ['orthodox', 'southpaw'] as const) {
            const t = comboSpeech(c.punches, r, v, st);
            expect(t.length).toBeGreaterThan(1);
            expect(t).not.toMatch(/undefined|어퍼/);
          }
  });
  it('난이도 분포 — 세 단계 모두 존재', () => {
    const d = { beginner: 0, intermediate: 0, advanced: 0 };
    BUILTIN_COMBINATIONS.forEach((c) => d[c.difficulty]++);
    expect(d.beginner).toBeGreaterThan(5);
    expect(d.intermediate).toBeGreaterThan(20);
    expect(d.advanced).toBeGreaterThan(10);
  });
  it('풋워크 12개', () => expect(FOOTWORK_STEPS.length).toBe(12));
});

describe('음성 문구', () => {
  it('명세서 예시와 일치', () => {
    expect(comboSpeech(parseSequence('1-2'), 'coach', 'live', 'orthodox')).toBe('원투!');
    expect(comboSpeech(parseSequence('1-1-2'), 'coach', 'basic', 'orthodox')).toBe('잽, 잽, 투.');
    expect(comboSpeech(parseSequence('1-2-3-2'), 'coach', 'basic', 'orthodox')).toBe('원투, 왼훅, 투.');
    expect(comboSpeech(parseSequence('1-2-3-2'), 'coach', 'live', 'orthodox')).toBe('원투! 왼훅! 투!');
    expect(comboSpeech(parseSequence('1-2-3B'), 'coach', 'basic', 'orthodox')).toBe('원투, 왼 바디 훅.');
    expect(comboSpeech(parseSequence('1-2-3-2'), 'number', 'basic', 'orthodox')).toBe('원, 투, 쓰리, 투.');
    expect(comboSpeech(parseSequence('1-2-3-2'), 'coach', 'number', 'orthodox')).toBe('원, 투, 쓰리, 투!');
    expect(comboSpeech(parseSequence('1-2-3-2'), 'formal', 'basic', 'orthodox')).toBe('잽, 스트레이트, 왼손 훅, 스트레이트.');
  });
  it('사우스포는 앞손 훅이 오른훅', () => {
    expect(comboSpeech(parseSequence('1-2-3'), 'coach', 'basic', 'southpaw')).toBe('원투, 오른훅.');
    expect(comboSpeech(parseSequence('4B'), 'formal', 'basic', 'southpaw')).toBe('왼손 바디 훅.');
  });
  it('원투 묶음 규칙', () => {
    expect(coachTokens(parseSequence('1-2-1-2'), 'orthodox').map((t) => t.text)).toEqual(['원투', '원투']);
    expect(coachTokens(parseSequence('2-1-2'), 'orthodox').map((t) => t.text)).toEqual(['투', '원투']);
    expect(coachTokens(parseSequence('1B-1-2'), 'orthodox').map((t) => t.text)).toEqual(['바디 잽', '원투']);
  });
});

describe('명령 스케줄러', () => {
  const S = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...p });
  const combos = [...BUILTIN_COMBINATIONS];

  it('난이도 필터', () => {
    expect(comboPool({ settings: S({ difficulty: 'beginner', mode: 'combo' }), combos, weights: {} }).every((c) => c.difficulty === 'beginner')).toBe(true);
    expect(comboPool({ settings: S({ difficulty: 'advanced', mode: 'combo' }), combos, weights: {} }).length).toBe(100);
    expect(comboPool({ settings: S({ mode: 'technique', difficulty: 'advanced' }), combos, weights: {} }).every((c) => c.count <= 3)).toBe(true);
  });
  it('제외한 콤비는 선택되지 않음', () => {
    const weights = Object.fromEntries(combos.slice(1).map((c) => [c.id, 'excluded' as const]));
    const st = newSchedulerState();
    const rng = seeded(1);
    for (let i = 0; i < 50; i++) {
      const c = nextCommand({ settings: S({ mode: 'combo', difficulty: 'advanced', coachCues: false }), combos, weights, rng }, st);
      expect(c?.comboId).toBe('c001');
    }
  });
  it('최근 5개 반복 회피', () => {
    const st = newSchedulerState();
    const rng = seeded(7);
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) {
      const c = nextCommand({ settings: S({ mode: 'combo', difficulty: 'advanced', coachCues: false }), combos, weights: {}, rng }, st);
      ids.push(c!.comboId!);
    }
    for (let i = 5; i < ids.length; i++) expect(ids.slice(i - 5, i)).not.toContain(ids[i]);
  });
  it('믹스 비율 ≈ 75:25', () => {
    const st = newSchedulerState();
    const rng = seeded(3);
    let combo = 0, foot = 0;
    for (let i = 0; i < 4000; i++) {
      if (i % 30 === 0) st.indexInRound = 0;
      const c = nextCommand({ settings: S({ mode: 'mix', coachCues: false, linkCommands: false }), combos, weights: {}, rng }, st)!;
      if (c.kind === 'combo') combo++;
      else foot++;
    }
    const ratio = combo / (combo + foot);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(0.82);
  });
  it('풋워크 모드는 풋워크만', () => {
    const st = newSchedulerState();
    for (let i = 0; i < 100; i++) expect(nextCommand({ settings: S({ mode: 'footwork' }), combos, weights: {} }, st)!.kind).toBe('footwork');
  });
  it('커스텀 모드는 선택한 콤비만', () => {
    const st = newSchedulerState();
    const sel = ['c008', 'c041'];
    for (let i = 0; i < 60; i++) expect(sel).toContain(nextCommand({ settings: S({ mode: 'custom', customSelection: sel }), combos, weights: {} }, st)!.comboId);
  });
  it('긴 콤비 연속 억제', () => {
    const st = newSchedulerState();
    const rng = seeded(11);
    let streaks = 0;
    let prevLong = false;
    for (let i = 0; i < 2000; i++) {
      const c = nextCommand({ settings: S({ mode: 'combo', difficulty: 'advanced', coachCues: false }), combos, weights: {}, rng }, st)!;
      if (c.long && prevLong) streaks++;
      prevLong = c.long;
    }
    expect(streaks / 2000).toBeLessThan(0.08);
  });
  it('랜덤 간격 7초 ±20% 범위', () => {
    const rng = seeded(5);
    const cmd = nextCommand({ settings: S({ mode: 'combo' }), combos, weights: {} }, newSchedulerState())!;
    for (let i = 0; i < 500; i++) {
      const g = gapAfter(cmd, S({ intervalSec: 7, randomInterval: true, randomRange: 20 }), rng);
      expect(g).toBeGreaterThanOrEqual(5.6 - 1e-9);
      expect(g).toBeLessThanOrEqual(8.4 + 1e-9);
    }
    expect(gapAfter(cmd, S({ intervalSec: 7, randomInterval: false }))).toBe(7);
  });
});

describe('라운드 타임라인', () => {
  it('3R × 2분, 휴식 1분, 준비 5초', () => {
    const segs = buildSegments({ rounds: 3, roundSec: 120, restSec: 60, prepSec: 5 });
    expect(segs.map((s) => s.phase)).toEqual(['prep', 'work', 'rest', 'work', 'rest', 'work']);
    expect(totalMs(segs)).toBe((5 + 360 + 120) * 1000);
    expect(locate(segs, 4999).seg?.phase).toBe('prep');
    expect(locate(segs, 5000).seg?.phase).toBe('work');
    expect(locate(segs, 125_000).seg?.phase).toBe('rest');
    expect(locate(segs, 125_000).seg?.round).toBe(2);
    expect(locate(segs, totalMs(segs)).seg).toBeNull();
  });
  it('설정 보정', () => {
    const s = sanitizeSettings({ rounds: 99, roundSec: 5, intervalSec: 100, rate: 3, prepSec: 7 });
    expect(s.rounds).toBe(12);
    expect(s.roundSec).toBe(30);
    expect(s.intervalSec).toBe(30);
    expect(s.rate).toBe(1.35);
    expect(s.prepSec).toBe(5);
  });
  it('시계: 일시정지 시간 제외', async () => {
    const c = new LiveClock();
    c.start();
    await new Promise((r) => setTimeout(r, 120));
    c.pause();
    const a = c.now();
    await new Promise((r) => setTimeout(r, 150));
    expect(c.now()).toBe(a);
    c.start();
    await new Promise((r) => setTimeout(r, 100));
    const b = c.now();
    expect(b - a).toBeGreaterThanOrEqual(90);
    expect(b - a).toBeLessThan(200);
  });
});

import { planTimeline } from '../services/TimelinePlanner';

describe('네이티브 타임라인 플래너', () => {
  const S = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...p });
  const combos = [...BUILTIN_COMBINATIONS];
  it('3R 믹스: 안내 순서·구간·종료 위치', () => {
    const plan = planTimeline(S({ rounds: 3, roundSec: 120, restSec: 60, prepSec: 5 }), combos, {}, null, seeded(9));
    const speak = plan.events.filter((e) => e.kind === 'speak').map((e) => e.text);
    expect(speak[0]).toBe('첫 번째 라운드 준비.');
    expect(speak).toContain('시작!');
    expect(speak).toContain('두 번째 라운드, 시작!');
    expect(speak).toContain('세 번째 라운드, 시작!');
    expect(speak.filter((t) => t === '십 초 남았습니다!').length).toBe(3);
    expect(speak.filter((t) => t === '라운드 종료! 휴식.').length).toBe(2);
    expect(speak[speak.length - 1]).toBe('훈련 종료. 수고하셨습니다.');
    expect(plan.durationMs).toBeGreaterThan(totalMs(plan.segs));
    expect(plan.totalRounds).toBe(3);
  });
  it('명령은 라운드 안에서만, 휴식 중 명령 없음, 10초 안내와 겹치지 않음', () => {
    for (let k = 0; k < 20; k++) {
      const s = S({ rounds: 3, roundSec: 60, restSec: 30, intervalSec: 3, randomInterval: true, randomRange: 30 });
      const plan = planTimeline(s, combos, {}, null, seeded(100 + k));
      const cmds = plan.events.filter((e) => e.command);
      expect(cmds.length).toBeGreaterThan(10);
      for (const e of cmds) {
        const seg = plan.segs.find((g) => e.t >= g.start && e.t < g.end)!;
        expect(seg.phase).toBe('work');
        const est = (e.text!.length * 0.2 + 0.6) * 1000;
        expect(e.t + 600).toBeLessThan(seg.end - 3000);
        const ten = seg.end - 10000;
        expect(e.t >= ten + 1000 || e.t + est * 0.8 < ten).toBe(true);
      }
      // 명령 간 최소 간격 확보
      for (let i = 1; i < cmds.length; i++) expect(cmds[i].t - cmds[i - 1].t).toBeGreaterThan(2000);
    }
  });
  it('반복 연습: 정확한 횟수', () => {
    const plan = planTimeline(S({ prepSec: 3 }), combos, {}, { comboId: 'c008', count: 5 });
    const cmds = plan.events.filter((e) => e.command);
    expect(cmds.length).toBe(5);
    expect(cmds.every((e) => e.command!.comboId === 'c008')).toBe(true);
    expect(plan.events[plan.events.length - 1].text).toBe('반복 연습 종료. 수고하셨습니다.');
  });
  it('풋워크 모드는 풋워크 명령만', () => {
    const plan = planTimeline(S({ mode: 'footwork' }), combos, {}, null, seeded(4));
    expect(plan.events.filter((e) => e.command).every((e) => e.command!.kind === 'footwork')).toBe(true);
  });
});
