import { useEffect, useState } from 'react';
import { Eye, EyeOff, Pause, Play, Square, RotateCcw, Volume2 } from 'lucide-react';
import { useStore } from '../stores/store';
import { engine, engineStore } from '../services/WorkoutEngine';
import { settingsStore, updateSettings } from '../services/SettingsManager';
import { wakeLockState } from '../services/WakeLock';
import { formatClock, formatDuration } from '../services/timeline';
import { speak, unlockSpeech } from '../audio/VoiceEngine';
import { AUDIO_NAMES, DIFF_NAMES, MODE_NAMES } from '../utils/labels';
import { Button, HoldButton, Notice, Slider, cx } from '../components/ui';
import { Stat } from './Train';

const PHASE_NAMES = { prep: '준비', work: '라운드', rest: '휴식', done: '종료', idle: '' } as const;

function Preparing() {
  const st = useStore(engineStore);
  return (
    <div className="flex flex-1 flex-col justify-center px-6">
      <div className="mb-2 text-[24px] font-extrabold">{st.status === 'ready' ? '트랙 준비 완료' : '오디오 트랙 만드는 중'}</div>
      <p className="mb-6 text-[15px] leading-relaxed text-mute">
        {st.status === 'ready'
          ? `총 ${formatDuration(st.totalMs)} 분량입니다. 에어팟을 연결하고 재생을 누르세요. 잠금 화면에서도 재생·일시정지할 수 있습니다(기기에 따라 다름).`
          : '전체 명령 순서를 정하고 음성과 무음 구간을 하나의 트랙으로 합치고 있습니다.'}
      </p>
      {st.status === 'preparing' && !st.error && (
        <>
          <div className="mb-2 h-2 overflow-hidden rounded-full bg-card">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(st.prepareProgress * 100)}%` }} />
          </div>
          <div className="tnum text-[13px] text-mute">
            {st.prepareLabel} · {Math.round(st.prepareProgress * 100)}%
          </div>
        </>
      )}
      {st.error && (
        <Notice
          tone="error"
          action={
            <>
              <Button className="h-10 text-[14px]" onClick={() => engine.retryPrepare()}>
                다시 시도
              </Button>
              <Button kind="secondary" className="h-10 text-[14px]" onClick={() => engine.fallbackToLive()}>
                실시간 TTS로 시작
              </Button>
            </>
          }
        >
          {st.error}
          <div className="mt-1 text-[13px] opacity-80">설정 → 연속 오디오 음성 준비에서 녹음 음성이나 TTS 서버를 확인하세요.</div>
        </Notice>
      )}
      {st.status === 'ready' && (
        <button type="button" onClick={() => engine.playPreparedTrack()} className="press flex h-[72px] w-full items-center justify-center gap-2.5 rounded-[24px] bg-accent text-[20px] font-extrabold text-bg">
          <Play size={24} fill="currentColor" /> 재생 시작
        </button>
      )}
      <Button kind="ghost" className="mt-4" onClick={() => engine.stop()}>
        취소
      </Button>
    </div>
  );
}

function Summary() {
  const st = useStore(engineStore);
  const r = st.record;
  if (!r) return null;
  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-5 pt-6">
      <div className="mb-1 text-[30px] font-black tracking-tight">{r.completed ? '수고하셨습니다' : '훈련을 중단했습니다'}</div>
      <p className="mb-6 text-[15px] text-mute">
        {MODE_NAMES[r.mode]}
        {r.mode !== 'footwork' && r.mode !== 'custom' && r.mode !== 'repeat' ? ` · ${DIFF_NAMES[r.difficulty]}` : ''} · {AUDIO_NAMES[r.audioMode]}
      </p>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Stat label="총 훈련 시간" value={formatDuration(r.workMs)} big />
        <Stat label="완료한 라운드" value={`${r.roundsCompleted} / ${r.roundsPlanned}`} big />
        <Stat label="총 휴식 시간" value={formatDuration(r.restMs)} />
        <Stat label="전체 소요" value={formatDuration(r.totalMs)} />
        <Stat label="콤비네이션 명령" value={`${r.comboCount}회`} />
        <Stat label="풋워크 명령" value={`${r.footworkCount}회`} />
      </div>
      <div className="mb-6 rounded-2xl bg-card px-4 py-3">
        <div className="text-[12px] font-medium text-mute">음성으로 안내한 펀치 수</div>
        <div className="tnum mt-0.5 text-[19px] font-extrabold">{r.calledPunches}개</div>
        <div className="mt-1 text-[12px] leading-snug text-mute">코치가 지시한 개수입니다. 실제로 친 횟수는 센서 없이 알 수 없습니다.</div>
      </div>
      <div className="pb-safe mt-auto">
        <Button className="mb-2 w-full" onClick={() => engine.dismiss()}>
          확인
        </Button>
      </div>
    </div>
  );
}

function QuickAdjust() {
  const s = useStore(settingsStore);
  return (
    <div className="mx-5 mb-4 rounded-2xl bg-card px-4 py-3">
      <div className="mb-1 text-[13px] font-semibold text-mute">일시정지 중 빠른 조절</div>
      <div className="text-[14px]">음성 속도</div>
      <Slider ariaLabel="음성 속도" value={s.rate} min={0.85} max={1.35} step={0.05} onChange={(v) => updateSettings({ rate: v })} format={(v) => `${v.toFixed(2)}배`} />
      <div className="text-[14px]">명령 간격</div>
      <Slider ariaLabel="명령 간격" value={s.intervalSec} min={3} max={30} step={0.5} onChange={(v) => updateSettings({ intervalSec: v })} format={(v) => `${v}초`} />
    </div>
  );
}

export function Workout() {
  const st = useStore(engineStore);
  const s = useStore(settingsStore);
  const wl = useStore(wakeLockState);
  const [minimal, setMinimal] = useState(false);

  // 훈련 중 스와이프로 페이지가 움직이지 않도록 고정
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const block = (e: TouchEvent) => {
      if ((e.target as HTMLElement).closest('input,[data-scroll]')) return;
      e.preventDefault();
    };
    document.addEventListener('touchmove', block, { passive: false });
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('touchmove', block);
    };
  }, []);

  const shell = (children: React.ReactNode) => (
    <div className="pt-safe pb-safe fixed inset-0 z-40 flex flex-col bg-bg" style={{ touchAction: 'none', overscrollBehavior: 'none' }}>
      <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col">{children}</div>
    </div>
  );

  if (st.status === 'preparing' || (st.status === 'ready' && st.audioMode === 'track')) return shell(<Preparing />);
  if (st.status === 'done') return shell(<div data-scroll className="flex flex-1 flex-col" style={{ touchAction: 'pan-y' }}><Summary /></div>);

  const paused = st.status === 'paused';
  const work = st.phase === 'work';
  const rest = st.phase === 'rest';
  const prep = st.phase === 'prep';
  const isRepeat = st.mode === 'repeat';
  const segProgress = st.segDurMs ? 1 - st.remainingMs / st.segDurMs : 0;
  const final10 = work && !isRepeat && st.remainingMs <= 10_000;
  const timerText = isRepeat && work ? formatClock(st.elapsedMs) : formatClock(st.remainingMs);
  const big = s.timerSize === 'large';
  const cmd = work ? st.command : null;

  return shell(
    <>
      {/* 상단 */}
      <div className={cx('flex items-center justify-between px-5 pt-2 transition-opacity', minimal && 'opacity-40')}>
        <div className="tnum text-[17px] font-extrabold tracking-wide">
          {isRepeat ? (
            <>반복 {st.repeat?.done ?? 0} / {st.repeat?.total}</>
          ) : (
            <>
              ROUND {Math.max(1, st.round)} <span className="text-mute">/ {st.totalRounds}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={cx('rounded-full px-3 py-1 text-[13px] font-bold', work ? 'bg-accent text-bg' : 'bg-card text-fg')}>
            {paused ? '일시정지' : PHASE_NAMES[st.phase]}
          </span>
          <button type="button" aria-label={minimal ? '전체 화면 표시' : '미니멀 화면'} onClick={() => setMinimal((m) => !m)} className="press flex h-9 w-9 items-center justify-center rounded-full bg-card text-mute">
            {minimal ? <Eye size={17} /> : <EyeOff size={17} />}
          </button>
        </div>
      </div>
      <div className={cx('px-5 pt-1 text-[13px] text-mute transition-opacity', minimal && 'opacity-0')}>
        {MODE_NAMES[st.mode]} · {AUDIO_NAMES[st.audioMode]}
        {s.keepAwake && wl.error ? ` · ${wl.error}` : ''}
      </div>

      {/* 타이머 */}
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <div
          className={cx(
            'tnum font-black leading-none tracking-[-0.04em] transition-colors',
            big ? 'text-[min(31vw,170px)]' : 'text-[min(25vw,136px)]',
            work ? (final10 ? 'text-accent' : 'text-fg') : 'text-mute',
            paused && 'opacity-50',
          )}
        >
          {timerText}
        </div>
        <div className={cx('mt-4 h-1.5 w-[min(70vw,320px)] overflow-hidden rounded-full bg-card', isRepeat && 'invisible')}>
          <div className={cx('h-full rounded-full', work ? 'bg-accent' : 'bg-[#39414d]')} style={{ width: `${Math.min(100, segProgress * 100)}%` }} />
        </div>

        {/* 현재 명령 */}
        <div className="mt-10 flex min-h-[148px] w-full flex-col items-center justify-start text-center">
          {cmd ? (
            <div key={st.commandSeq} className={cx(s.animation && 'cmd-in')}>
              <div className={cx('font-extrabold leading-tight tracking-tight', cmd.punches && cmd.kind === 'combo' ? 'tnum text-[min(11vw,52px)]' : 'text-[min(9vw,42px)]', st.speaking ? 'text-accent' : 'text-fg')}>
                {cmd.kind === 'combo' ? cmd.label : cmd.kind === 'link' ? cmd.label.split(' + ')[1] : cmd.label}
              </div>
              <div className="mt-2 text-[min(5.4vw,22px)] font-semibold text-mute">{cmd.kind === 'link' ? cmd.sub : cmd.kind === 'combo' ? cmd.sub : cmd.sub}</div>
            </div>
          ) : (
            <div className="text-[min(7vw,30px)] font-bold text-mute">
              {prep && '준비하세요'}
              {rest && (paused ? '휴식 중' : `휴식 — 다음 ${st.round}라운드`)}
              {work && !paused && '시작'}
              {st.phase === 'done' && '훈련 종료'}
            </div>
          )}
          <div className={cx('tnum mt-4 h-5 text-[14px] text-mute transition-opacity', minimal && 'opacity-0')}>
            {work && !paused && st.nextInMs != null && `다음 명령까지 ${Math.ceil(st.nextInMs / 1000)}초`}
          </div>
        </div>
      </div>

      {st.error && (
        <div className="px-5">
          <Notice
            tone="error"
            action={
              <Button
                className="h-10 text-[14px]"
                onClick={() => {
                  unlockSpeech();
                  engine.clearError();
                  speak('원투!', { interrupt: true });
                }}
              >
                <Volume2 size={16} /> 음성 다시 시도
              </Button>
            }
          >
            {st.error}
          </Notice>
        </div>
      )}
      {st.notice && !st.error && (
        <div className="px-5">
          <Notice>{st.notice}</Notice>
        </div>
      )}
      {paused && st.audioMode === 'live' && <QuickAdjust />}

      {/* 하단 버튼: 크게, 서로 멀리 */}
      <div className="flex items-stretch gap-4 px-5 pb-2 pt-2">
        <button
          type="button"
          onClick={() => (paused ? (st.audioMode === 'track' ? engine.playPreparedTrack() : engine.resume()) : engine.pause())}
          className={cx('press flex h-[76px] flex-[2] items-center justify-center gap-2.5 rounded-[24px] text-[19px] font-extrabold', paused ? 'bg-accent text-bg' : 'bg-card text-fg')}
        >
          {paused ? <Play size={24} fill="currentColor" /> : <Pause size={24} fill="currentColor" />}
          {paused ? '재개' : '일시정지'}
        </button>
        <HoldButton onDone={() => engine.stop()} className="press h-[76px] flex-1 rounded-[24px] bg-danger/15 text-danger">
          <span className="flex flex-col items-center leading-tight">
            <span className="flex items-center gap-1.5 text-[17px] font-extrabold">
              <Square size={16} fill="currentColor" /> 종료
            </span>
            <span className="mt-0.5 text-[11px] font-semibold opacity-80">길게 누르기</span>
          </span>
        </HoldButton>
      </div>
      {paused && (
        <button type="button" className="press mx-auto mb-1 flex items-center gap-1.5 px-3 py-2 text-[13px] text-mute" onClick={() => engine.stop()}>
          <RotateCcw size={14} /> 지금 끝내고 기록 보기
        </button>
      )}
    </>,
  );
}
