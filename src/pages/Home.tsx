import { useMemo } from 'react';
import { Play, RotateCcw, Share, WifiOff, X, Disc3 } from 'lucide-react';
import { useStore } from '../stores/store';
import { applyPreset, onboardStore, presetStore, settingsStore, updateSettings } from '../services/SettingsManager';
import { engine, engineStore } from '../services/WorkoutEngine';
import { pwaStore, shouldShowInstallHint } from '../services/PWAService';
import { voiceStatus } from '../audio/VoiceEngine';
import { allCombinations, customStore, prefsStore } from '../services/CombinationDatabase';
import { isPlayable } from '../services/CommandScheduler';
import { buildSegments, formatClock, formatDuration, formatSec, totalMs } from '../services/timeline';
import { AUDIO_MIX_NAMES, DIFF_NAMES, MODE_NAMES } from '../utils/labels';
import { isNativeApp } from '../native/CoachEngine';

const NATIVE = isNativeApp();
import { Button, Chip, Notice, cx } from '../components/ui';
import type { Settings, TrainingMode } from '../types';

/** 라운드 구성을 그대로 보여주는 링: 라운드는 강조색 호, 휴식은 어두운 호 */
function RoundRing({ s }: { s: Settings }) {
  const segs = buildSegments(s).filter((x) => x.phase !== 'prep');
  const total = segs.reduce((a, x) => a + (x.end - x.start), 0);
  const R = 120;
  const C = 2 * Math.PI * R;
  const gap = segs.length > 1 ? 6 : 0;
  let offset = 0;
  return (
    <div className="relative mx-auto aspect-square w-[min(74vw,300px)]">
      <svg viewBox="0 0 280 280" className="h-full w-full -rotate-90">
        <circle cx="140" cy="140" r={R} fill="none" stroke="#1c222b" strokeWidth="14" />
        {segs.map((x, i) => {
          const len = Math.max(0, ((x.end - x.start) / total) * C - gap);
          const el = (
            <circle
              key={i}
              cx="140"
              cy="140"
              r={R}
              fill="none"
              stroke={x.phase === 'work' ? 'var(--accent)' : '#39414d'}
              strokeWidth={x.phase === 'work' ? 14 : 6}
              strokeDasharray={`${len} ${C}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len + gap;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="tnum text-[min(17vw,68px)] font-extrabold leading-none tracking-tight">{formatClock(s.roundSec * 1000)}</div>
        <div className="mt-2 text-[15px] font-semibold text-mute">
          {s.rounds}라운드 · 휴식 {formatSec(s.restSec)}
        </div>
        <div className="mt-1 text-[13px] text-mute">총 {formatDuration(totalMs(buildSegments(s)))}</div>
      </div>
    </div>
  );
}

function Tile({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="press rounded-2xl bg-card px-4 py-3 text-left">
      <div className="text-[12px] font-medium text-mute">{label}</div>
      <div className="tnum mt-0.5 truncate text-[17px] font-bold">{value}</div>
    </button>
  );
}

export function Home({ goTrain, requestStart }: { goTrain: () => void; requestStart: () => void }) {
  const s = useStore(settingsStore);
  const presets = useStore(presetStore);
  const eng = useStore(engineStore);
  const pwa = useStore(pwaStore);
  const onboard = useStore(onboardStore);
  const vs = useStore(voiceStatus);
  const prefs = useStore(prefsStore);
  useStore(customStore);
  const playable = useMemo(() => isPlayable(s, allCombinations(), prefs.weights), [s, prefs]);

  const modes: TrainingMode[] = ['mix', 'combo', 'footwork', 'technique', 'custom'];
  const intervalLabel = s.randomInterval && s.randomRange ? `${s.intervalSec}초 ±${s.randomRange}%` : `${s.intervalSec}초`;

  return (
    <div className="pb-nav px-4">
      <header className="pt-safe flex items-start justify-between pb-4">
        <div className="pt-3 leading-[0.92]">
          <div className="text-[34px] font-black tracking-[-0.02em]">BOXING</div>
          <div className="text-[34px] font-black tracking-[-0.02em] text-mute">VOICE COACH</div>
        </div>
        {!pwa.online && (
          <span className="mt-4 flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-[12px] font-semibold text-mute">
            <WifiOff size={14} /> 오프라인
          </span>
        )}
      </header>

      {eng.restorable && eng.status === 'idle' && (
        <Notice
          tone="warn"
          action={
            <>
              <Button className="h-10 text-[14px]" onClick={() => engine.restore()}>
                <RotateCcw size={16} /> 이어서 하기
              </Button>
              <Button kind="secondary" className="h-10 text-[14px]" onClick={() => engine.discardSnapshot()}>
                기록만 저장하고 닫기
              </Button>
            </>
          }
        >
          진행 중이던 훈련이 있습니다.
        </Notice>
      )}

      {!vs.supported && <Notice tone="error">이 브라우저는 음성 합성을 지원하지 않습니다. iPhone은 Safari에서 열어 주세요. 타이머와 화면 표시는 사용할 수 있습니다.</Notice>}
      {vs.supported && vs.ready && !vs.korean && (NATIVE || s.audioMode === 'live') && (
        <Notice tone="warn">이 기기에서 한국어 음성을 찾지 못했습니다. 설정 → 손쉬운 사용 → 읽기 및 말하기 → 음성에서 한국어 음성을 내려받으면 더 자연스럽게 들립니다.</Notice>
      )}

      {shouldShowInstallHint(pwa) && !onboard.installDismissed && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl bg-card px-4 py-3">
          <Share size={20} className="mt-0.5 shrink-0 text-accent" />
          <div className="flex-1 text-[14px] leading-relaxed">
            <b>홈 화면에 설치</b>
            <div className="text-mute">공유 버튼을 누른 후 ‘홈 화면에 추가’를 선택하세요. 앱처럼 전체 화면으로 실행됩니다.</div>
          </div>
          <button type="button" aria-label="안내 닫기" className="press -mr-1 text-mute" onClick={() => onboardStore.set((o) => ({ ...o, installDismissed: true }))}>
            <X size={20} />
          </button>
        </div>
      )}

      <div className="py-2">
        <RoundRing s={s} />
      </div>

      <div className="no-scrollbar -mx-4 mb-4 mt-5 flex gap-2 overflow-x-auto px-4">
        {modes.map((m) => (
          <Chip key={m} active={s.mode === m} onClick={() => updateSettings({ mode: m })}>
            {MODE_NAMES[m]}
          </Chip>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Tile label="라운드" value={`${s.rounds}R`} onClick={goTrain} />
        <Tile label="라운드 시간" value={formatClock(s.roundSec * 1000)} onClick={goTrain} />
        <Tile label="휴식" value={formatClock(s.restSec * 1000)} onClick={goTrain} />
        <Tile label="명령 간격" value={intervalLabel} onClick={goTrain} />
        <Tile label="난이도" value={s.mode === 'footwork' || s.mode === 'custom' ? '—' : DIFF_NAMES[s.difficulty]} onClick={goTrain} />
        <Tile label="오디오" value={NATIVE ? AUDIO_MIX_NAMES[s.audioMix] : s.audioMode === 'live' ? '실시간' : '연속 트랙'} onClick={goTrain} />
      </div>

      {presets.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 px-1 text-[15px] font-bold">프리셋</h2>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {presets.map((p) => (
              <button key={p.id} type="button" onClick={() => applyPreset(p)} className="press shrink-0 rounded-2xl bg-card px-4 py-3 text-left">
                <div className="text-[14px] font-bold">{p.name}</div>
                <div className="tnum mt-0.5 text-[12px] text-mute">
                  {p.values.mode ? MODE_NAMES[p.values.mode] : ''} · {p.values.rounds ?? s.rounds}R × {formatSec(p.values.roundSec ?? s.roundSec)}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {!NATIVE && s.audioMode === 'track' && (
        <button type="button" onClick={() => engine.loadLastTrack()} className="press mt-4 flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left">
          <Disc3 size={20} className="text-mute" />
          <span className="text-[14px] font-semibold">마지막으로 만든 트랙 다시 재생</span>
        </button>
      )}

      <div className="fixed inset-x-0 z-30 px-4" style={{ bottom: 'calc(var(--nav-h) + var(--sab) + 12px)' }}>
        <div className="mx-auto max-w-[520px]">
          {!playable.ok && <div className="mb-2 rounded-xl bg-bg2 px-3 py-2 text-center text-[13px] text-mute">{playable.reason}</div>}
          <button
            type="button"
            disabled={!playable.ok}
            onClick={requestStart}
            className={cx('press flex h-[64px] w-full items-center justify-center gap-2.5 rounded-[22px] bg-accent text-[19px] font-extrabold text-bg disabled:opacity-35')}
          >
            <Play size={22} fill="currentColor" /> 훈련 시작
          </button>
        </div>
      </div>
    </div>
  );
}
