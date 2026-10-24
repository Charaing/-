import type { Preset, Settings } from '../types';
import { createStore } from '../stores/store';

export const DEFAULT_SETTINGS: Settings = {
  mode: 'mix',
  rounds: 3,
  roundSec: 120,
  restSec: 60,
  prepSec: 5,
  difficulty: 'intermediate',
  intervalSec: 7,
  randomInterval: true,
  randomRange: 20,
  comboRatio: 75,
  linkCommands: true,
  recentLimit: 5,
  coachCues: true,
  customSelection: [],
  voiceURI: null,
  rate: 1.05,
  volume: 1,
  voiceStyle: 'live',
  readStyle: 'coach',
  stance: 'orthodox',
  preBeep: false,
  bell: true,
  countdown: true,
  timeAnnounce: true,
  tone: 'dark',
  keepAwake: true,
  timerSize: 'normal',
  vibrate: false,
  animation: true,
  audioMode: 'live',
  audioMix: 'mix',
};

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, n));
};

/** 저장된 값이 손상되었거나 범위를 벗어나도 안전한 값으로 보정 */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const s: Settings = { ...DEFAULT_SETTINGS, ...r };
  s.rounds = Math.round(clamp(s.rounds, 1, 12, 3));
  s.roundSec = Math.round(clamp(s.roundSec, 30, 180, 120));
  s.restSec = Math.round(clamp(s.restSec, 15, 120, 60));
  s.prepSec = ([3, 5, 10] as const).includes(s.prepSec) ? s.prepSec : 5;
  s.intervalSec = clamp(s.intervalSec, 3, 30, 7);
  s.randomRange = Math.round(clamp(s.randomRange, 0, 30, 20));
  s.comboRatio = Math.round(clamp(s.comboRatio, 0, 100, 75));
  s.recentLimit = Math.round(clamp(s.recentLimit, 0, 10, 5));
  s.rate = clamp(s.rate, 0.85, 1.35, 1.05);
  s.volume = clamp(s.volume, 0, 1, 1);
  if (!['combo', 'footwork', 'mix', 'technique', 'custom'].includes(s.mode)) s.mode = 'mix';
  if (!['beginner', 'intermediate', 'advanced'].includes(s.difficulty)) s.difficulty = 'intermediate';
  if (!['basic', 'live', 'number'].includes(s.voiceStyle)) s.voiceStyle = 'live';
  if (!['coach', 'number', 'formal'].includes(s.readStyle)) s.readStyle = 'coach';
  if (!['orthodox', 'southpaw'].includes(s.stance)) s.stance = 'orthodox';
  if (!['live', 'track'].includes(s.audioMode)) s.audioMode = 'live';
  if (!['mix', 'duck', 'solo'].includes(s.audioMix)) s.audioMix = 'mix';
  if (!Array.isArray(s.customSelection)) s.customSelection = [];
  return s;
}

export const settingsStore = createStore<Settings>(DEFAULT_SETTINGS, 'bvc.settings.v1', sanitizeSettings);

export function updateSettings(patch: Partial<Settings>) {
  settingsStore.set((s) => sanitizeSettings({ ...s, ...patch }));
}

export function resetSettings() {
  settingsStore.set({ ...DEFAULT_SETTINGS });
}

export const INTERVAL_PRESETS = [
  { label: '빠르게', sec: 4 },
  { label: '보통', sec: 7 },
  { label: '여유롭게', sec: 12 },
  { label: '아주 여유롭게', sec: 18 },
] as const;

const BUILTIN_PRESETS: Preset[] = [
  { id: 'p_basic', name: '기본 샌드백', values: { mode: 'mix', rounds: 3, roundSec: 120, restSec: 60, intervalSec: 7, difficulty: 'intermediate', comboRatio: 75 } },
  { id: 'p_short', name: '짧은 콤비네이션', values: { mode: 'technique', rounds: 3, roundSec: 90, restSec: 45, intervalSec: 10, difficulty: 'beginner' } },
  { id: 'p_foot', name: '풋워크', values: { mode: 'footwork', rounds: 3, roundSec: 60, restSec: 30, intervalSec: 5 } },
  { id: 'p_hard', name: '실전 3분', values: { mode: 'mix', rounds: 5, roundSec: 180, restSec: 60, intervalSec: 5, difficulty: 'advanced', comboRatio: 80 } },
];

export const presetStore = createStore<Preset[]>(BUILTIN_PRESETS, 'bvc.presets.v1', (raw) => (Array.isArray(raw) ? (raw as Preset[]) : BUILTIN_PRESETS));

export function savePresetFromCurrent(name: string) {
  const s = settingsStore.get();
  const values: Partial<Settings> = {
    mode: s.mode, rounds: s.rounds, roundSec: s.roundSec, restSec: s.restSec, prepSec: s.prepSec,
    difficulty: s.difficulty, intervalSec: s.intervalSec, randomInterval: s.randomInterval,
    randomRange: s.randomRange, comboRatio: s.comboRatio, linkCommands: s.linkCommands,
  };
  presetStore.set((p) => [...p, { id: `p_${Date.now().toString(36)}`, name: name.trim().slice(0, 20) || '내 프리셋', values }]);
}

export function applyPreset(p: Preset) {
  updateSettings(p.values);
}

export function deletePreset(id: string) {
  presetStore.set((p) => p.filter((x) => x.id !== id));
}

export function resetPresets() {
  presetStore.set(BUILTIN_PRESETS);
}

/** 첫 실행 안전 안내 확인 여부 */
export const onboardStore = createStore<{ safetySeen: boolean; installDismissed: boolean }>(
  { safetySeen: false, installDismissed: false },
  'bvc.onboard.v1',
);
