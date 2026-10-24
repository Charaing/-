import type { AudioMode, Command, EngineAudio, Phase, Segment, Settings, TrainingMode, WorkoutRecord } from '../types';
import { CoachEngine, isNativeApp, voiceOptions } from '../native/CoachEngine';
import { planTimeline, toNativeEvents, type TimelinePlan } from './TimelinePlanner';
import { createStore } from '../stores/store';
import { settingsStore } from './SettingsManager';
import { allCombinations, getCombination, prefsStore } from './CombinationDatabase';
import { comboCommand, gapAfter, newSchedulerState, nextCommand, recordCommand, type SchedulerState } from './CommandScheduler';
import { buildSegments, locate, totalMs } from './timeline';
import { LiveClock } from './clock';
import { addRecord } from './WorkoutHistory';
import { acquireWakeLock, releaseWakeLock } from './WakeLock';
import { cancelSpeech, speak, unlockSpeech } from '../audio/VoiceEngine';
import { bell, beep, tick, unlockAudio, vibrate } from '../audio/Beeper';
import { COUNT_WORDS, estimateSpeechSec, roundOrdinal } from '../utils/speech';
import {
  TrackPlayer, getProvider, loadLastTrack, planTrack, renderTrack, saveLastTrack, estimateTrackBytes, type TrackPlan,
} from '../audio/AudioSessionEngine';

const NATIVE = isNativeApp();

export type EngineStatus = 'idle' | 'preparing' | 'ready' | 'running' | 'paused' | 'done';

export interface RepeatSpec {
  comboId: string;
  count: number;
}

export interface EngineState {
  status: EngineStatus;
  audioMode: EngineAudio;
  mode: TrainingMode | 'repeat';
  phase: Phase;
  round: number;
  totalRounds: number;
  remainingMs: number;
  segDurMs: number;
  elapsedMs: number;
  totalMs: number;
  command: Command | null;
  commandSeq: number;
  speaking: boolean;
  nextInMs: number | null;
  repeat: { done: number; total: number } | null;
  prepareProgress: number;
  prepareLabel: string;
  error: string | null;
  notice: string | null;
  record: WorkoutRecord | null;
  restorable: boolean;
}

const INITIAL: EngineState = {
  status: 'idle', audioMode: 'live', mode: 'mix', phase: 'idle', round: 0, totalRounds: 0, remainingMs: 0, segDurMs: 0,
  elapsedMs: 0, totalMs: 0, command: null, commandSeq: 0, speaking: false, nextInMs: null, repeat: null,
  prepareProgress: 0, prepareLabel: '', error: null, notice: null, record: null, restorable: false,
};

export const engineStore = createStore<EngineState>(INITIAL);

const SNAP_KEY = 'bvc.session.v1';

interface Snapshot {
  v: 1;
  audioMode: EngineAudio;
  nplan?: TimelinePlan;
  settings: Settings;
  repeat: RepeatSpec | null;
  ms: number;
  segIndex: number;
  fired: string[];
  counts: Counts;
  startedAt: number;
  savedAt: number;
}

interface Counts {
  combos: number;
  footwork: number;
  punches: number;
  reps: number;
}

class WorkoutEngine {
  private snap: Settings = settingsStore.get();
  private segs: Segment[] = [];
  private clock = new LiveClock();
  private timer: ReturnType<typeof setInterval> | null = null;
  private segIndex = -1;
  private fired = new Set<string>();
  private sched: SchedulerState = newSchedulerState();
  private nextCommandAt = 0;
  private cmdSpeaking = false;
  private announcing = false;
  private gen = 0; // 명령/안내 콜백 무효화용 세대 번호
  private counts: Counts = { combos: 0, footwork: 0, punches: 0, reps: 0 };
  private startedAt = 0;
  private repeat: RepeatSpec | null = null;
  private repeatEndAt = Infinity;
  private lastSave = 0;
  // 트랙 모드
  private player: TrackPlayer | null = null;
  private plan: TrackPlan | null = null;
  // 네이티브(iOS 앱) 모드
  private nplan: TimelinePlan | null = null;
  private nativeLoaded = false; // 네이티브 엔진에 현재 플랜이 올라가 있는지
  private nativePos = 0;
  private nativePolling = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.tick();
        else this.saveSnapshot(true);
      });
      window.addEventListener('pagehide', () => this.saveSnapshot(true));
    }
    engineStore.set((s) => ({ ...s, restorable: this.readSnapshot() != null }));
    if (NATIVE) {
      // 잠금 화면 버튼·전화·이어폰 분리로 네이티브에서 일시정지/재개된 경우
      CoachEngine.addListener('state', (d) => {
        const st = engineStore.get();
        if (st.audioMode !== 'native' || (st.status !== 'running' && st.status !== 'paused')) return;
        this.nativePos = d.position;
        const notice =
          d.reason === 'interruption' ? '전화·알람으로 일시정지했습니다. 재개를 누르면 이어집니다.'
          : d.reason === 'routeLost' ? '이어폰 연결이 끊겨 일시정지했습니다.'
          : null;
        engineStore.set((x) => ({ ...x, status: d.status, notice: notice ?? x.notice }));
        if (d.status === 'paused') this.saveSnapshot(true);
      }).catch(() => {});
      CoachEngine.addListener('finished', (d) => {
        const st = engineStore.get();
        if (st.audioMode !== 'native' || st.status === 'done' || st.status === 'idle') return;
        this.nativePos = d.position;
        this.finish(true);
      }).catch(() => {});
    }
  }

  /* ---------------- 공개 API ---------------- */

  /** 반드시 사용자 터치 핸들러 안에서 호출 (iOS 오디오 잠금 해제) */
  start(opts: { repeat?: RepeatSpec; forceLive?: boolean } = {}) {
    unlockAudio();
    unlockSpeech();
    this.reset();
    this.snap = { ...settingsStore.get() };
    this.repeat = opts.repeat ?? null;
    this.startedAt = Date.now();
    const audioMode: AudioMode = this.repeat || opts.forceLive ? 'live' : this.snap.audioMode;
    if (this.snap.keepAwake) acquireWakeLock();
    if (NATIVE) {
      this.startNativeSession();
      return;
    }
    if (audioMode === 'track') {
      this.prepareTrack();
      return;
    }
    this.segs = this.repeat
      ? [
          { phase: 'prep', round: 1, start: 0, end: this.snap.prepSec * 1000 },
          { phase: 'work', round: 1, start: this.snap.prepSec * 1000, end: this.snap.prepSec * 1000 + 3 * 3600_000 },
        ]
      : buildSegments(this.snap);
    engineStore.set({
      ...INITIAL,
      status: 'running',
      audioMode: 'live',
      mode: this.repeat ? 'repeat' : this.snap.mode,
      totalRounds: this.repeat ? 1 : this.snap.rounds,
      totalMs: this.repeat ? 0 : totalMs(this.segs),
      repeat: this.repeat ? { done: 0, total: this.repeat.count } : null,
    });
    this.clock = new LiveClock();
    this.clock.start();
    // 첫 안내는 터치 이벤트 안에서 바로 말해야 iOS에서 음성이 나온다
    this.segIndex = 0;
    this.announce(this.repeat ? '반복 연습 준비.' : `${roundOrdinal(1)} 준비.`);
    this.loop();
  }

  pause() {
    const st = engineStore.get();
    if (st.status !== 'running') return;
    if (st.audioMode === 'native') {
      engineStore.set((s) => ({ ...s, status: 'paused', speaking: false }));
      CoachEngine.pause()
        .then((r) => {
          this.nativePos = r.position;
          this.saveSnapshot(true);
        })
        .catch(() => {});
      return;
    }
    if (st.audioMode === 'track') {
      this.player?.pause();
      engineStore.set((s) => ({ ...s, status: 'paused' }));
      this.saveSnapshot(true);
      return;
    }
    this.clock.pause();
    this.gen++;
    cancelSpeech();
    this.cmdSpeaking = false;
    this.announcing = false;
    engineStore.set((s) => ({ ...s, status: 'paused', speaking: false }));
    this.saveSnapshot(true);
  }

  /** 사용자 터치 안에서 호출 */
  resume() {
    const st = engineStore.get();
    if (st.status !== 'paused') return;
    unlockAudio();
    unlockSpeech();
    if (this.snap.keepAwake) acquireWakeLock();
    if (st.audioMode === 'native') {
      engineStore.set((s) => ({ ...s, status: 'running', error: null, notice: null }));
      if (!this.nativeLoaded) {
        this.launchNative(this.nativePos);
      } else {
        CoachEngine.resume({ cue: '계속!' }).catch((e) => {
          engineStore.set((s) => ({ ...s, status: 'paused', error: `재개하지 못했습니다: ${(e as Error).message}` }));
        });
      }
      if (!this.timer) this.loop(200);
      return;
    }
    if (st.audioMode === 'track') {
      this.player?.play().then((ok) => ok && engineStore.set((s) => ({ ...s, status: 'running', error: null })));
      if (!this.timer) this.loop(250);
      return;
    }
    this.clock.start();
    const now = this.clock.now();
    this.nextCommandAt = Math.max(this.nextCommandAt, now + 1800);
    engineStore.set((s) => ({ ...s, status: 'running', error: null }));
    const loc = locate(this.segs, now);
    if (loc.seg?.phase === 'work') this.announce('계속!');
    if (!this.timer) this.loop();
  }

  stop() {
    const st = engineStore.get();
    if (st.status === 'idle' || st.status === 'done') return;
    if (st.status === 'preparing' || st.status === 'ready') {
      this.teardown();
      engineStore.set({ ...INITIAL });
      return;
    }
    this.finish(false);
  }

  /** 요약 화면을 닫고 처음으로 */
  dismiss() {
    this.teardown();
    engineStore.set({ ...INITIAL, restorable: false });
  }

  /** 트랙 준비 완료 후 재생 (사용자 터치 안에서) */
  async playPreparedTrack() {
    if (!this.player || !this.plan) return;
    const st = engineStore.get();
    if (st.status !== 'ready' && st.status !== 'paused') return;
    const ok = await this.player.play();
    if (!ok) return;
    const s = this.plan.settings;
    this.player.setupMediaSession(
      'BOXING VOICE COACH',
      `${s.rounds}라운드 · ${Math.round(s.roundSec / 60 * 10) / 10}분`,
      { play: () => this.resume(), pause: () => this.pause(), stop: () => this.stop() },
    );
    engineStore.set((x) => ({ ...x, status: 'running', error: null }));
    if (!this.timer) this.loop(250);
  }

  retryPrepare() {
    this.prepareTrack();
  }

  /** 트랙 생성 실패 시 실시간 모드로 바로 시작 */
  fallbackToLive() {
    this.start({ forceLive: true });
  }

  /** 마지막으로 만든 트랙을 다시 재생 (오프라인 가능) */
  async loadLastTrack(): Promise<boolean> {
    const t = await loadLastTrack();
    if (!t) return false;
    unlockAudio();
    this.reset();
    this.snap = { ...t.plan.settings };
    this.plan = t.plan;
    this.player = this.makePlayer();
    this.player.load(t.blob);
    this.startedAt = Date.now();
    engineStore.set({
      ...INITIAL, status: 'ready', audioMode: 'track', mode: this.snap.mode, totalRounds: this.snap.rounds,
      totalMs: t.plan.durationMs, notice: '저장된 트랙입니다.',
    });
    return true;
  }

  readSnapshot(): Snapshot | null {
    try {
      const raw = localStorage.getItem(SNAP_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Snapshot;
      if (s.v !== 1 || Date.now() - s.savedAt > 3 * 3600_000) return null;
      return s;
    } catch {
      return null;
    }
  }

  discardSnapshot() {
    const s = this.readSnapshot();
    if (s && s.ms > 10_000) {
      // 중단된 세션도 기록으로 남긴다
      this.snap = s.settings;
      this.segs = s.repeat ? [] : buildSegments(s.settings);
      this.counts = s.counts;
      this.startedAt = s.startedAt;
      this.repeat = s.repeat;
      addRecord(this.buildRecord(s.ms, false, s.audioMode));
    }
    try {
      localStorage.removeItem(SNAP_KEY);
    } catch {
      /* noop */
    }
    engineStore.set((x) => ({ ...x, restorable: false }));
  }

  /** 새로고침 전 세션을 일시정지 상태로 복구 */
  async restore(): Promise<boolean> {
    const s = this.readSnapshot();
    if (!s) return false;
    this.reset();
    this.snap = s.settings;
    this.repeat = s.repeat;
    this.counts = s.counts;
    this.startedAt = s.startedAt;
    this.fired = new Set(s.fired);
    if (s.audioMode === 'native') {
      if (!NATIVE || !s.nplan) {
        this.discardSnapshot();
        return false;
      }
      this.nplan = s.nplan;
      this.nativePos = s.ms;
      this.nativeLoaded = false;
      engineStore.set({
        ...INITIAL, status: 'paused', audioMode: 'native', mode: s.repeat ? 'repeat' : s.settings.mode,
        totalRounds: s.nplan.totalRounds, totalMs: s.repeat ? 0 : s.nplan.durationMs,
        repeat: s.repeat ? { done: s.counts.reps, total: s.repeat.count } : null,
        notice: '이전 훈련을 불러왔습니다. 재개를 누르면 이어집니다.',
      });
      this.updatePlanUI(s.nplan, s.ms);
      this.loop(200);
      return true;
    }
    if (s.audioMode === 'track') {
      const t = await loadLastTrack();
      if (!t) {
        this.discardSnapshot();
        return false;
      }
      this.plan = t.plan;
      this.player = this.makePlayer();
      this.player.load(t.blob);
      this.player.seek(s.ms);
      engineStore.set({ ...INITIAL, status: 'paused', audioMode: 'track', mode: this.snap.mode, totalRounds: this.snap.rounds, totalMs: t.plan.durationMs, notice: '이전 훈련을 불러왔습니다. 재생을 누르면 이어집니다.' });
      this.updateTrackUI(s.ms);
      return true;
    }
    this.segs = s.repeat
      ? [
          { phase: 'prep', round: 1, start: 0, end: s.settings.prepSec * 1000 },
          { phase: 'work', round: 1, start: s.settings.prepSec * 1000, end: s.settings.prepSec * 1000 + 3 * 3600_000 },
        ]
      : buildSegments(s.settings);
    this.segIndex = s.segIndex;
    this.clock = new LiveClock(s.ms);
    this.nextCommandAt = s.ms + 2000;
    engineStore.set({
      ...INITIAL, status: 'paused', audioMode: 'live', mode: s.repeat ? 'repeat' : s.settings.mode,
      totalRounds: s.repeat ? 1 : s.settings.rounds, totalMs: s.repeat ? 0 : totalMs(this.segs),
      repeat: s.repeat ? { done: s.counts.reps, total: s.repeat.count } : null,
      notice: '이전 훈련을 불러왔습니다. 재개를 누르면 이어집니다.',
    });
    this.updateLiveUI(s.ms);
    return true;
  }

  clearError() {
    engineStore.set((s) => ({ ...s, error: null, notice: null }));
  }

  /* ---------------- 내부: 공통 ---------------- */

  private reset() {
    this.teardown();
    this.segIndex = -1;
    this.fired = new Set();
    this.sched = newSchedulerState();
    this.nextCommandAt = 0;
    this.cmdSpeaking = false;
    this.announcing = false;
    this.counts = { combos: 0, footwork: 0, punches: 0, reps: 0 };
    this.repeatEndAt = Infinity;
    this.plan = null;
    this.nplan = null;
    this.nativePos = 0;
  }

  private teardown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.gen++;
    if (this.nativeLoaded) {
      CoachEngine.stop().catch(() => {});
      this.nativeLoaded = false;
    }
    cancelSpeech();
    this.player?.dispose();
    this.player = null;
  }

  private loop(ms = 100) {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), ms);
  }

  private tick() {
    const st = engineStore.get();
    if (st.audioMode === 'native') {
      this.nativeTick();
      return;
    }
    if (st.audioMode === 'track') {
      if (this.player && (st.status === 'running' || st.status === 'paused')) {
        this.updateTrackUI(this.player.ms);
        this.player.updatePosition();
        this.saveSnapshot();
      }
      return;
    }
    if (st.status !== 'running') return;
    this.liveTick();
    this.saveSnapshot();
  }

  private saveSnapshot(force = false) {
    const st = engineStore.get();
    if (st.status !== 'running' && st.status !== 'paused') return;
    const now = Date.now();
    if (!force && now - this.lastSave < 1000) return;
    this.lastSave = now;
    const ms = st.audioMode === 'native' ? this.nativePos : st.audioMode === 'track' ? this.player?.ms ?? 0 : this.clock.now();
    const snap: Snapshot = {
      v: 1, audioMode: st.audioMode, nplan: st.audioMode === 'native' ? this.nplan ?? undefined : undefined, settings: this.snap, repeat: this.repeat, ms, segIndex: this.segIndex,
      fired: [...this.fired], counts: this.counts, startedAt: this.startedAt, savedAt: now,
    };
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify(snap));
    } catch {
      /* noop */
    }
  }

  private announce(text: string, then?: () => void) {
    const myGen = ++this.gen; // 진행 중인 명령 콜백 무효화 → 안내가 우선
    this.cmdSpeaking = false;
    this.announcing = true;
    engineStore.set((s) => ({ ...s, speaking: true }));
    speak(text, { interrupt: true }).then((r) => {
      if (myGen !== this.gen) return;
      this.announcing = false;
      engineStore.set((s) => ({ ...s, speaking: false }));
      if (r === 'error' || r === 'unsupported') this.voiceProblem();
      then?.();
    });
  }

  private voiceProblem() {
    const st = engineStore.get();
    if (!st.error) engineStore.set((s) => ({ ...s, error: '음성이 출력되지 않습니다. 무음 모드·볼륨·이어폰 연결을 확인한 뒤 다시 시도해 주세요. 타이머와 화면 표시는 계속 동작합니다.' }));
  }

  /* ---------------- 내부: 실시간 TTS 모드 ---------------- */

  /** crossAt 시각을 지났으면 1회 실행. 백그라운드 복귀 등으로 1.5초 이상 지났다면 소리 없이 넘긴다 */
  private once(key: string, crossAt: number, ms: number, fn: () => void) {
    if (this.fired.has(key) || ms < crossAt) return;
    this.fired.add(key);
    if (ms - crossAt < 1500) fn();
  }

  private liveTick() {
    const ms = this.clock.now();
    const loc = locate(this.segs, ms);
    if (!loc.seg) {
      this.finish(true);
      return;
    }
    if (loc.index !== this.segIndex) {
      const from = this.segIndex;
      this.segIndex = loc.index;
      this.enterSegment(from, loc.index, ms);
    }
    const seg = loc.seg;
    const i = loc.index;
    const dur = seg.end - seg.start;
    const s = settingsStore.get(); // 음성·명령 설정은 훈련 중 변경해도 즉시 반영
    const cd = (k: number) => {
      if (s.countdown) {
        this.announce(COUNT_WORDS[k]);
        vibrate(40);
      }
    };

    if (seg.phase === 'prep' || seg.phase === 'rest') {
      if (seg.phase === 'rest' && dur >= 20000) this.once(`${i}:next`, seg.end - 10000, ms, () => this.announce('다음 라운드 준비.'));
      for (const k of [3, 2, 1]) if (dur - k * 1000 >= 1800) this.once(`${i}:cd${k}`, seg.end - k * 1000, ms, () => cd(k));
    }

    if (seg.phase === 'work') {
      const hasTen = s.timeAnnounce && dur >= 25000 && !this.repeat;
      if (hasTen) {
        this.once(`${i}:ten`, seg.end - 10000, ms, () => {
          this.announce('십 초 남았습니다!', () => {
            this.nextCommandAt = Math.max(this.nextCommandAt, this.clock.now() + 1200);
          });
        });
      }
      if (s.countdown && !this.repeat) for (const k of [3, 2, 1]) this.once(`${i}:b${k}`, seg.end - k * 1000, ms, () => beep(k === 1 ? 990 : 880, 0.12));
      this.commandStep(ms, seg, hasTen, s);
    }
    this.updateLiveUI(ms);
  }

  private enterSegment(from: number, to: number, ms: number) {
    const seg = this.segs[to];
    const fresh = ms - seg.start < 2000; // 백그라운드에서 한참 지난 경우 안내 생략
    const s = settingsStore.get();
    // 지나간 구간의 임계 이벤트는 모두 소진 처리
    if (to - from > 1) for (let j = from + 1; j < to; j++) ['next', 'cd3', 'cd2', 'cd1', 'ten', 'b3', 'b2', 'b1'].forEach((k) => this.fired.add(`${j}:${k}`));
    if (seg.phase === 'work') {
      this.sched.indexInRound = 0;
      this.nextCommandAt = ms + 2200;
      if (fresh) {
        if (s.bell) bell(1);
        vibrate([80, 60, 80]);
        this.announce(seg.round === 1 ? '시작!' : `${roundOrdinal(seg.round)}, 시작!`);
      } else {
        this.nextCommandAt = ms + 1000;
      }
    } else if (seg.phase === 'rest') {
      this.gen++;
      cancelSpeech();
      this.cmdSpeaking = false;
      if (fresh) {
        if (s.bell) bell(2);
        vibrate([200, 100, 200]);
        this.announce('라운드 종료! 휴식.');
      }
    }
  }

  private commandStep(ms: number, seg: Segment, hasTen: boolean, s: Settings) {
    if (this.announcing || this.cmdSpeaking) return;
    if (this.repeat && this.counts.reps >= this.repeat.count) {
      if (ms >= this.repeatEndAt) this.finish(true);
      return;
    }
    if (ms < this.nextCommandAt) return;
    const remaining = seg.end - ms;
    if (remaining < 3500) return;
    // 백그라운드에서 밀린 명령을 한꺼번에 내보내지 않는다
    if (ms - this.nextCommandAt > 3000) {
      this.nextCommandAt = ms + 1000;
      return;
    }
    // 10초 안내 직전에는 기다렸다가 안내 뒤에 이어간다
    if (hasTen && remaining > 10000 && remaining < 13000) return;

    let cmd: Command | null;
    if (this.repeat) {
      const c = getCombination(this.repeat.comboId);
      cmd = c ? comboCommand(c, s) : null;
      if (cmd) recordCommand(this.sched, cmd);
    } else {
      cmd = nextCommand({ settings: { ...this.snap, ...pickLive(s) }, combos: allCombinations(), weights: prefsStore.get().weights }, this.sched);
    }
    if (!cmd) {
      engineStore.set((x) => ({ ...x, notice: '재생할 수 있는 명령이 없습니다. 콤비네이션 제외 설정을 확인하세요.' }));
      this.nextCommandAt = ms + 5000;
      return;
    }
    const est = estimateSpeechSec(cmd.text, s.rate * cmd.rateMul) * 1000;
    const tailGuard = s.countdown && !this.repeat ? 3000 : 0;
    if (est + 800 > remaining - tailGuard) {
      // 라운드 경계를 넘을 명령은 내보내지 않는다
      this.nextCommandAt = seg.end + 1;
      return;
    }
    this.issue(cmd, s);
  }

  private issue(cmd: Command, s: Settings) {
    const myGen = ++this.gen;
    this.cmdSpeaking = true;
    if (cmd.kind === 'combo' || cmd.kind === 'link') {
      this.counts.combos++;
      this.counts.punches += cmd.punches?.length ?? 0;
    }
    if (cmd.kind === 'footwork' || cmd.kind === 'link') this.counts.footwork++;
    if (this.repeat) this.counts.reps++;
    engineStore.set((x) => ({
      ...x, command: cmd, commandSeq: x.commandSeq + 1, speaking: true, notice: null,
      repeat: this.repeat ? { done: this.counts.reps, total: this.repeat.count } : null,
    }));
    vibrate(30);
    const go = () => {
      if (myGen !== this.gen) return;
      speak(cmd.text, { rateMul: cmd.rateMul }).then((r) => {
        if (myGen !== this.gen) return;
        this.cmdSpeaking = false;
        engineStore.set((x) => ({ ...x, speaking: false }));
        if (r === 'error' || r === 'unsupported') this.voiceProblem();
        const gap = gapAfter(cmd, settingsStore.get()) * 1000;
        const now = this.clock.now();
        this.nextCommandAt = now + gap;
        if (this.repeat && this.counts.reps >= this.repeat.count) this.repeatEndAt = now + Math.min(gap, 4000);
      });
    };
    if (s.preBeep) {
      tick();
      setTimeout(go, 180);
    } else go();
  }

  private updateLiveUI(ms: number) {
    const loc = locate(this.segs, ms);
    const seg = loc.seg;
    const repeat = !!this.repeat;
    engineStore.set((x) => ({
      ...x,
      phase: seg ? seg.phase : 'done',
      round: seg ? seg.round : x.round,
      remainingMs: repeat && seg?.phase === 'work' ? 0 : loc.remainingMs,
      segDurMs: seg ? seg.end - seg.start : 0,
      elapsedMs: repeat ? Math.max(0, ms - (this.segs[1]?.start ?? 0)) : ms,
      nextInMs: seg?.phase === 'work' && !this.cmdSpeaking && !this.announcing && Number.isFinite(this.nextCommandAt) && this.nextCommandAt < seg.end
        ? Math.max(0, this.nextCommandAt - ms) : null,
    }));
  }

  /* ---------------- 내부: 연속 오디오 트랙 모드 ---------------- */

  private makePlayer() {
    const p = new TrackPlayer();
    p.onEnded = () => this.finish(true);
    p.onError = (msg) => engineStore.set((s) => ({ ...s, error: msg }));
    p.onPlayState = (playing) => {
      const st = engineStore.get();
      if (st.audioMode !== 'track') return;
      if (!playing && st.status === 'running' && !p.audio.ended) engineStore.set((s) => ({ ...s, status: 'paused' })); // 잠금 화면·전화 등 외부 일시정지
      if (playing && st.status === 'paused') engineStore.set((s) => ({ ...s, status: 'running' }));
    };
    return p;
  }

  private async prepareTrack() {
    const myGen = ++this.gen;
    engineStore.set({
      ...INITIAL, status: 'preparing', audioMode: 'track', mode: this.snap.mode, totalRounds: this.snap.rounds,
      totalMs: totalMs(buildSegments(this.snap)), prepareLabel: '음성 소스 확인 중', prepareProgress: 0.02,
    });
    try {
      const provider = await getProvider();
      const plan = await planTrack(this.snap, allCombinations(), prefsStore.get().weights, provider, (r, l) => {
        if (myGen === this.gen) engineStore.set((s) => ({ ...s, prepareProgress: r, prepareLabel: l }));
      });
      if (myGen !== this.gen) return;
      const mb = estimateTrackBytes(plan.durationMs) / 1e6;
      if (mb > 120) throw new Error(`트랙이 너무 깁니다(약 ${Math.round(mb)}MB). 라운드 수나 시간을 줄여 주세요.`);
      const blob = await renderTrack(plan, (r, l) => {
        if (myGen === this.gen) engineStore.set((s) => ({ ...s, prepareProgress: r, prepareLabel: l }));
      });
      if (myGen !== this.gen) return;
      await saveLastTrack(blob, plan);
      this.plan = plan;
      this.player = this.makePlayer();
      this.player.load(blob);
      engineStore.set((s) => ({ ...s, status: 'ready', prepareProgress: 1, prepareLabel: '준비 완료', totalMs: plan.durationMs }));
    } catch (e) {
      if (myGen !== this.gen) return;
      engineStore.set((s) => ({ ...s, status: 'preparing', error: `연속 오디오 생성 실패: ${(e as Error).message}` }));
    }
  }

  private updateTrackUI(ms: number) {
    if (this.plan) this.updatePlanUI(this.plan, ms);
  }

  /** 미리 계산된 타임라인(트랙/네이티브)의 재생 위치로 화면을 동기화 */
  private updatePlanUI(plan: { segs: Segment[]; events: { t: number; command?: Command }[] }, ms: number) {
    const loc = locate(plan.segs, ms);
    const seg = loc.seg;
    let command: Command | null = null;
    let seq = 0;
    let next: number | null = null;
    const counts = { combos: 0, footwork: 0, punches: 0, reps: 0 };
    for (const e of plan.events) {
      if (!e.command) continue;
      if (e.t <= ms) {
        command = e.command;
        seq++;
        if (e.command.kind === 'combo' || e.command.kind === 'link') {
          counts.combos++;
          counts.punches += e.command.punches?.length ?? 0;
        }
        if (e.command.kind === 'footwork' || e.command.kind === 'link') counts.footwork++;
      } else {
        if (seg?.phase === 'work' && e.t < seg.end) next = e.t - ms;
        break;
      }
    }
    if (seg?.phase !== 'work') command = seg?.phase === 'rest' ? null : command;
    if (this.repeat) counts.reps = counts.combos;
    this.counts = counts;
    this.segIndex = loc.index;
    const repeat = this.repeat;
    engineStore.set((x) => ({
      ...x,
      phase: seg ? seg.phase : 'done',
      round: seg ? seg.round : x.round,
      remainingMs: repeat && seg?.phase === 'work' ? 0 : loc.remainingMs,
      segDurMs: seg ? seg.end - seg.start : 0,
      elapsedMs: repeat ? Math.max(0, ms - (plan.segs[1]?.start ?? 0)) : ms,
      repeat: repeat ? { done: counts.reps, total: repeat.count } : x.repeat,
      command,
      commandSeq: seq,
      nextInMs: next,
    }));
  }

  /* ---------------- 내부: 네이티브(iOS 앱) 모드 ---------------- */

  private startNativeSession() {
    const s = this.snap;
    this.nplan = planTimeline(s, allCombinations(), prefsStore.get().weights, this.repeat);
    engineStore.set({
      ...INITIAL,
      status: 'running',
      audioMode: 'native',
      mode: this.repeat ? 'repeat' : s.mode,
      totalRounds: this.nplan.totalRounds,
      totalMs: this.repeat ? 0 : this.nplan.durationMs,
      repeat: this.repeat ? { done: 0, total: this.repeat.count } : null,
    });
    this.updatePlanUI(this.nplan, 0);
    this.launchNative(0);
    this.loop(200);
  }

  private launchNative(startMs: number) {
    const plan = this.nplan;
    if (!plan) return;
    const s = settingsStore.get();
    this.nativeLoaded = true;
    CoachEngine.start({
      ...voiceOptions(s),
      events: toNativeEvents(plan.events),
      segments: plan.segs.map((x) => ({ phase: x.phase, round: x.round, start: x.start, end: x.end })),
      durationMs: plan.durationMs,
      startMs,
      totalRounds: plan.totalRounds,
      title: 'BOXING VOICE COACH',
    }).catch((e) => {
      this.nativeLoaded = false;
      engineStore.set((x) => ({ ...x, status: 'paused', error: `오디오를 시작하지 못했습니다: ${(e as Error).message}` }));
    });
  }

  private nativeTick() {
    const st = engineStore.get();
    if ((st.status !== 'running' && st.status !== 'paused') || !this.nplan) return;
    if (st.status === 'paused' && !this.nativeLoaded) return;
    if (this.nativePolling) return;
    this.nativePolling = true;
    CoachEngine.getState()
      .then((r) => {
        this.nativePolling = false;
        const cur = engineStore.get();
        if (cur.audioMode !== 'native' || !this.nplan) return;
        this.nativePos = r.position;
        if (r.finished) {
          this.finish(true);
          return;
        }
        if (!r.active && cur.status === 'running' && this.nativeLoaded) {
          // 네이티브 세션이 사라진 경우(시스템이 오디오를 회수) — 일시정지로 전환
          this.nativeLoaded = false;
          engineStore.set((x) => ({ ...x, status: 'paused', notice: '오디오가 중단되었습니다. 재개를 누르면 이어집니다.' }));
          return;
        }
        if (r.active && cur.status === 'running' && !r.running) engineStore.set((x) => ({ ...x, status: 'paused' }));
        if (r.active && cur.status === 'paused' && r.running) engineStore.set((x) => ({ ...x, status: 'running' }));
        this.updatePlanUI(this.nplan, r.position);
        engineStore.set((x) => (x.speaking === r.speaking ? x : { ...x, speaking: r.speaking }));
        this.saveSnapshot();
      })
      .catch(() => {
        this.nativePolling = false;
      });
  }

  /* ---------------- 종료 ---------------- */

  private buildRecord(ms: number, completed: boolean, audioMode: EngineAudio): WorkoutRecord {
    let workMs = 0;
    let restMs = 0;
    let roundsCompleted = 0;
    const segs = this.plan?.segs ?? this.nplan?.segs ?? this.segs;
    if (this.repeat) {
      const prep = this.snap.prepSec * 1000;
      workMs = Math.max(0, ms - prep);
      roundsCompleted = completed ? 1 : 0;
    } else {
      for (const sg of segs) {
        const ov = Math.max(0, Math.min(sg.end, ms) - sg.start);
        if (sg.phase === 'work') {
          workMs += ov;
          if (ms >= sg.end) roundsCompleted++;
        } else if (sg.phase === 'rest') restMs += ov;
      }
    }
    return {
      id: `w_${this.startedAt.toString(36)}`,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      mode: this.repeat ? 'repeat' : this.snap.mode,
      difficulty: this.snap.difficulty,
      roundsPlanned: this.repeat ? 1 : this.snap.rounds,
      roundsCompleted,
      workMs,
      restMs,
      totalMs: workMs + restMs,
      comboCount: this.counts.combos,
      footworkCount: this.counts.footwork,
      calledPunches: this.counts.punches,
      audioMode,
      completed,
    };
  }

  private finish(completed: boolean) {
    const st = engineStore.get();
    if (st.status === 'done' || st.status === 'idle') return;
    const audioMode = st.audioMode;
    const ms = audioMode === 'native' ? this.nativePos : audioMode === 'track' ? this.player?.ms ?? 0 : this.clock.now();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clock.pause();
    if (audioMode === 'native') {
      // 완료 시 종료 안내는 네이티브 타임라인에 이미 포함되어 있다
      if (this.nativeLoaded) CoachEngine.stop().catch(() => {});
      this.nativeLoaded = false;
    } else if (audioMode === 'track') {
      this.player?.pause();
    } else if (completed) {
      const s = settingsStore.get();
      if (s.bell) bell(3);
      this.announce(this.repeat ? '반복 연습 종료. 수고하셨습니다.' : '훈련 종료. 수고하셨습니다.');
    } else {
      this.gen++;
      cancelSpeech();
    }
    const rec = this.buildRecord(ms, completed, audioMode);
    if (completed || rec.workMs >= 5000) addRecord(rec);
    releaseWakeLock();
    try {
      localStorage.removeItem(SNAP_KEY);
    } catch {
      /* noop */
    }
    engineStore.set((x) => ({ ...x, status: 'done', phase: 'done', record: rec, speaking: false, nextInMs: null, restorable: false }));
  }
}

/** 실시간으로 반영할 명령 설정 */
function pickLive(s: Settings): Partial<Settings> {
  return {
    intervalSec: s.intervalSec, randomInterval: s.randomInterval, randomRange: s.randomRange, comboRatio: s.comboRatio,
    linkCommands: s.linkCommands, recentLimit: s.recentLimit, coachCues: s.coachCues, readStyle: s.readStyle,
    voiceStyle: s.voiceStyle, stance: s.stance, customSelection: s.customSelection, difficulty: s.difficulty,
    preBeep: s.preBeep,
  };
}

export const engine = new WorkoutEngine();
