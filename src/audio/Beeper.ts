import { settingsStore } from '../services/SettingsManager';
import { CoachEngine, isNativeApp } from '../native/CoachEngine';

const NATIVE = isNativeApp();

/** 실시간/오프라인 컨텍스트 공용 효과음 합성 */
export function scheduleBeep(ctx: BaseAudioContext, dest: AudioNode, t: number, freq = 880, dur = 0.12, vol = 0.5) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.setValueAtTime(vol, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** 복싱 벨 — 비조화 배음 + 긴 감쇠 */
export function scheduleBell(ctx: BaseAudioContext, dest: AudioNode, t: number, vol = 0.55, strikes = 1) {
  const partials = [
    { f: 1180, a: 1, d: 1.6 },
    { f: 1180 * 2.76, a: 0.45, d: 0.9 },
    { f: 1180 * 5.4, a: 0.2, d: 0.5 },
    { f: 1180 * 0.5, a: 0.25, d: 1.2 },
  ];
  for (let k = 0; k < strikes; k++) {
    const ts = t + k * 0.32;
    for (const p of partials) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = p.f;
      g.gain.setValueAtTime(0, ts);
      g.gain.linearRampToValueAtTime(vol * p.a * 0.5, ts + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, ts + p.d);
      o.connect(g).connect(dest);
      o.start(ts);
      o.stop(ts + p.d + 0.05);
    }
  }
}

export const BELL_SEC = 1.6;

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** 사용자 터치 안에서 호출 — iOS 오디오 잠금 해제 */
export function unlockAudio() {
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  // 무음 버퍼 1개 재생
  try {
    const b = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = b;
    src.connect(c.destination);
    src.start(0);
  } catch {
    /* noop */
  }
}

function play(fn: (c: AudioContext, t: number, vol: number) => void) {
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const vol = Math.max(0.05, settingsStore.get().volume);
  fn(c, c.currentTime + 0.01, vol);
}

export const beep = (freq = 880, dur = 0.12) => play((c, t, v) => scheduleBeep(c, c.destination, t, freq, dur, 0.45 * v));
export const tick = () => play((c, t, v) => scheduleBeep(c, c.destination, t, 1320, 0.05, 0.25 * v));
export const bell = (strikes = 1) =>
  NATIVE
    ? void CoachEngine.playSound({ name: strikes >= 3 ? 'bell3' : strikes === 2 ? 'bell2' : 'bell1' }).catch(() => {})
    : play((c, t, v) => scheduleBell(c, c.destination, t, 0.6 * v, strikes));

export function vibrate(pattern: number | number[]) {
  if (!settingsStore.get().vibrate) return;
  if (NATIVE) {
    const style = Array.isArray(pattern) ? 'medium' : pattern > 50 ? 'medium' : 'light';
    CoachEngine.haptic({ style }).catch(() => {});
    return;
  }
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* noop */
  }
}

export const vibrationSupported = () => NATIVE || typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
