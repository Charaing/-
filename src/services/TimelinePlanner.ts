import type { Combination, Command, Segment, Settings, Weight } from '../types';
import { buildSegments } from './timeline';
import { comboCommand, gapAfter, newSchedulerState, nextCommand, recordCommand, type Rng } from './CommandScheduler';
import { COUNT_WORDS, estimateSpeechSec, roundOrdinal } from '../utils/speech';
import type { NativeEvent } from '../native/CoachEngine';

export interface PlanEvent extends NativeEvent {
  command?: Command;
}

export interface RepeatPlanSpec {
  comboId: string;
  count: number;
}

export interface TimelinePlan {
  segs: Segment[];
  events: PlanEvent[];
  durationMs: number;
  totalRounds: number;
}

/**
 * 네이티브 엔진용 전체 훈련 타임라인.
 * 음성 길이는 추정치로 잡고 여유를 둔다. 네이티브 쪽에서도 앞 음성이 끝나기 전에는
 * 다음 명령을 읽지 않으므로(대기 후 읽기) 겹치지 않는다.
 */
export function planTimeline(
  s: Settings,
  combos: Combination[],
  weights: Record<string, Weight>,
  repeat: RepeatPlanSpec | null = null,
  rng: Rng = Math.random,
): TimelinePlan {
  const events: PlanEvent[] = [];
  const est = (text: string, mul = 1) => estimateSpeechSec(text, s.rate * mul) * 1000 * 1.15 + 200;
  const say = (t: number, text: string, priority = 1, rate = 1, command?: Command) => {
    events.push({ t: Math.round(t), kind: 'speak', text, priority, rate, command });
    return est(text, rate);
  };
  const bellAt = (t: number, strikes: number) => {
    if (s.bell) events.push({ t: Math.round(t), kind: 'bell', strikes });
  };
  const beepAt = (t: number, freq: number) => events.push({ t: Math.round(t), kind: 'beep', freq });
  const countdown = (seg: { start: number; end: number }) => {
    if (!s.countdown) return;
    const dur = seg.end - seg.start;
    for (const k of [3, 2, 1]) if (dur - k * 1000 >= 1800) say(seg.end - k * 1000, COUNT_WORDS[k]);
  };
  const putCommand = (t: number, cmd: Command) => {
    let at = t;
    if (s.preBeep) {
      beepAt(at, 1320);
      at += 180;
    }
    return say(at, cmd.text, 0, cmd.rateMul, cmd) + (s.preBeep ? 180 : 0);
  };

  /* ---------- 반복 연습 ---------- */
  if (repeat) {
    const c = combos.find((x) => x.id === repeat.comboId);
    const prepEnd = s.prepSec * 1000;
    const segs: Segment[] = [{ phase: 'prep', round: 1, start: 0, end: prepEnd }];
    say(100, '반복 연습 준비.');
    countdown(segs[0]);
    bellAt(prepEnd, 1);
    let t = prepEnd + (s.bell ? 250 : 50);
    t += say(t, '시작!') + 1500;
    const st = newSchedulerState();
    for (let i = 0; c && i < repeat.count; i++) {
      const cmd = comboCommand(c, s);
      recordCommand(st, cmd);
      const d = putCommand(t, cmd);
      const gap = gapAfter(cmd, s, rng) * 1000;
      t += d + (i < repeat.count - 1 ? gap : Math.min(gap, 4000));
    }
    segs.push({ phase: 'work', round: 1, start: prepEnd, end: Math.round(t) });
    bellAt(t, 3);
    const doneDur = say(t + (s.bell ? 1100 : 100), '반복 연습 종료. 수고하셨습니다.');
    events.sort((a, b) => a.t - b.t);
    return { segs, events, durationMs: Math.round(t + (s.bell ? 1100 : 100) + doneDur + 1500), totalRounds: 1 };
  }

  /* ---------- 라운드 훈련 ---------- */
  const segs = buildSegments(s);
  const st = newSchedulerState();
  for (const seg of segs) {
    const dur = seg.end - seg.start;
    if (seg.phase === 'prep') {
      say(seg.start + 100, `${roundOrdinal(1)} 준비.`);
      countdown(seg);
    } else if (seg.phase === 'rest') {
      bellAt(seg.start, 2);
      say(seg.start + (s.bell ? 900 : 100), '라운드 종료! 휴식.');
      if (dur >= 20000) say(seg.end - 10000, '다음 라운드 준비.');
      countdown(seg);
    } else {
      st.indexInRound = 0;
      bellAt(seg.start, 1);
      let t = seg.start + (s.bell ? 250 : 50);
      t += say(t, seg.round === 1 ? '시작!' : `${roundOrdinal(seg.round)}, 시작!`) + 1500;
      const hasTen = s.timeAnnounce && dur >= 25000;
      const tenAt = seg.end - 10000;
      const tenEnd = hasTen ? tenAt + est('십 초 남았습니다!') + 1200 : tenAt;
      if (hasTen) say(tenAt, '십 초 남았습니다!');
      if (s.countdown) for (const k of [3, 2, 1]) beepAt(seg.end - k * 1000, k === 1 ? 990 : 880);
      const tailGuard = s.countdown ? 3000 : 0;
      let guard = 0;
      while (seg.end - t > 3500 && guard++ < 600) {
        const cmd = nextCommand({ settings: s, combos, weights, rng }, st);
        if (!cmd) break;
        const d = est(cmd.text, cmd.rateMul) + (s.preBeep ? 180 : 0);
        if (hasTen && t < tenEnd && t + d + 300 > tenAt) t = tenEnd;
        if (t + d + 800 > seg.end - tailGuard) break; // 라운드 경계를 넘는 명령은 만들지 않는다
        putCommand(t, cmd);
        t += d + gapAfter(cmd, s, rng) * 1000;
      }
    }
  }
  const last = segs[segs.length - 1];
  bellAt(last.end, 3);
  const doneAt = last.end + (s.bell ? 1100 : 100);
  const doneDur = say(doneAt, '훈련 종료. 수고하셨습니다.');
  events.sort((a, b) => a.t - b.t);
  return { segs, events, durationMs: Math.round(doneAt + doneDur + 1500), totalRounds: s.rounds };
}

/** 네이티브로 보낼 때는 화면 표시용 command 객체를 뺀다 */
export function toNativeEvents(events: PlanEvent[]): NativeEvent[] {
  return events.map(({ command: _c, ...rest }) => rest);
}
