import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Mic, Play, Square, Trash2, Volume2 } from 'lucide-react';
import { useStore } from '../stores/store';
import { resetPresets, resetSettings, settingsStore, updateSettings } from '../services/SettingsManager';
import { clearHistory } from '../services/WorkoutHistory';
import { allCombinations, builtinValidation, prefsStore, resetComboPrefs } from '../services/CombinationDatabase';
import { koreanVoices, speak, unlockSpeech, voiceStatus, clearVoiceError } from '../audio/VoiceEngine';
import { bell, unlockAudio, vibrationSupported } from '../audio/Beeper';
import { wakeLockSupported } from '../services/WakeLock';
import { pwaStore } from '../services/PWAService';
import {
  CLIP_DEFS, ClipRecorder, clearClips, clearRemoteCache, deleteClip, idb, recordedKeysStore, recordingSupported,
  refreshRecordedKeys, saveClip, trackSourceStore,
} from '../audio/VoicePack';
import { clipText, requiredKeys } from '../audio/AudioSessionEngine';
import { READ_STYLE_DESC, READ_STYLE_NAMES, VOICE_STYLE_DESC, VOICE_STYLE_NAMES } from '../utils/labels';
import { Button, Notice, PageHeader, Row, Section, Segmented, Slider, Toggle, cx } from '../components/ui';
import type { AudioMix, ReadStyle, VoiceStyle } from '../types';
import { isNativeApp } from '../native/CoachEngine';
import { AUDIO_MIX_DESC, AUDIO_MIX_NAMES } from '../utils/labels';

const NATIVE = isNativeApp();

function VoiceTest() {
  const vs = useStore(voiceStatus);
  const [state, setState] = useState<'idle' | 'playing' | 'ok' | 'fail'>('idle');
  return (
    <div className="p-3">
      <Button
        className="w-full"
        onClick={() => {
          unlockAudio();
          unlockSpeech();
          clearVoiceError();
          setState('playing');
          speak('음성 테스트입니다. 원투, 왼훅, 투!', { interrupt: true }).then((r) => setState(r === 'end' ? 'ok' : r === 'cancelled' ? 'idle' : 'fail'));
        }}
      >
        <Volume2 size={18} /> 음성 테스트
      </Button>
      <p className="mt-2 px-1 text-[13px] leading-relaxed text-mute">
        {state === 'playing' && '재생 중… 이어폰에서 들리는지 확인하세요.'}
        {state === 'ok' && '재생이 끝났습니다. 들리지 않았다면 무음 스위치, 볼륨, 블루투스 연결을 확인하세요.'}
        {state === 'fail' && (vs.lastError ?? '음성이 출력되지 않았습니다.') + ' 다시 시도하거나 기기를 재시작해 보세요.'}
        {state === 'idle' && '음악 앱과 함께 쓸 때도 여기서 먼저 확인하세요. iOS 정책에 따라 음악이 잠시 멈추거나 작아질 수 있습니다.'}
      </p>
      <Button kind="secondary" className="mt-1 h-10 w-full text-[14px]" onClick={() => { unlockAudio(); bell(1); }}>
        벨 소리 테스트
      </Button>
    </div>
  );
}

function ClipRow({ def, has, recording, onRecord, onStop, onPlay, onDelete, disabled }: {
  def: (typeof CLIP_DEFS)[number]; has: boolean; recording: boolean; disabled: boolean;
  onRecord: () => void; onStop: () => void; onPlay: () => void; onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 last:border-b-0">
      <span className={cx('h-2 w-2 shrink-0 rounded-full', has ? 'bg-accent' : def.required ? 'bg-danger' : 'bg-[#39414d]')} />
      <span className="min-w-0 flex-1 truncate text-[15px]">{def.text}</span>
      {recording ? (
        <button type="button" onClick={onStop} className="press flex h-10 items-center gap-1.5 rounded-full bg-danger px-3 text-[13px] font-bold text-bg">
          <Square size={14} fill="currentColor" /> 정지
        </button>
      ) : (
        <button type="button" disabled={disabled} onClick={onRecord} aria-label={`${def.text} 녹음`} className="press flex h-10 w-10 items-center justify-center rounded-full bg-bg2 disabled:opacity-30">
          <Mic size={17} />
        </button>
      )}
      <button type="button" disabled={!has || disabled} onClick={onPlay} aria-label="재생" className="press flex h-10 w-10 items-center justify-center rounded-full bg-bg2 disabled:opacity-30">
        <Play size={16} />
      </button>
      <button type="button" disabled={!has || disabled} onClick={onDelete} aria-label="삭제" className="press flex h-10 w-10 items-center justify-center rounded-full bg-bg2 text-mute disabled:opacity-30">
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function TrackSource() {
  const src = useStore(trackSourceStore);
  const keys = useStore(recordedKeysStore);
  const s = useStore(settingsStore);
  const prefs = useStore(prefsStore);
  const [recKey, setRecKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<ClipRecorder | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  useEffect(() => {
    refreshRecordedKeys();
    return () => rec.current?.cancel();
  }, []);
  const need = useMemo(() => requiredKeys(s, allCombinations(), prefs.weights), [s, prefs]);
  const missing = need.filter((k) => !keys.includes(k));

  const start = async (key: string) => {
    setErr(null);
    try {
      rec.current = new ClipRecorder();
      await rec.current.start();
      setRecKey(key);
    } catch (e) {
      setErr(`마이크를 사용할 수 없습니다: ${(e as Error).message}`);
    }
  };
  const stop = async () => {
    if (!rec.current || !recKey) return;
    try {
      const blob = await rec.current.stop();
      if (blob.size < 500) throw new Error('녹음이 너무 짧습니다.');
      await saveClip(recKey, blob);
    } catch (e) {
      setErr((e as Error).message);
    }
    setRecKey(null);
  };
  const play = async (key: string) => {
    const blob = await idb.get<Blob>('clips', key);
    if (!blob) return;
    const a = new Audio(URL.createObjectURL(blob));
    a.play().catch(() => setErr('재생할 수 없습니다.'));
  };
  const groups = [
    { g: 'punch', t: '펀치 (필수)' },
    { g: 'step', t: '풋워크 (필수)' },
    { g: 'announce', t: '안내 (선택 — 없으면 벨만 울림)' },
  ] as const;

  return (
    <>
      <Section
        title="연속 오디오 음성"
        hint="Web Speech API의 기기 음성은 파일로 저장할 수 없어서, 연속 트랙은 직접 녹음한 음성이나 외부 TTS 서버 음성으로 만듭니다. 녹음 음성은 이 기기 안에만 저장되고 오프라인에서도 쓸 수 있습니다."
      >
        <Row label="음성 소스" stack>
          <Segmented
            options={[
              { value: 'recorded' as const, label: '내 녹음' },
              { value: 'remote' as const, label: '외부 TTS 서버' },
            ]}
            value={src.provider}
            onChange={(v) => trackSourceStore.set((x) => ({ ...x, provider: v }))}
          />
        </Row>
        {src.provider === 'remote' && (
          <Row label="TTS 서버 주소" desc="{text} 자리에 문장이 들어갑니다. 서버가 CORS를 허용하고 mp3·wav를 반환해야 합니다. 받은 음성은 캐시되어 다음부터 오프라인으로 재사용됩니다." stack>
            <input
              value={src.remoteUrl}
              onChange={(e) => trackSourceStore.set((x) => ({ ...x, remoteUrl: e.target.value }))}
              placeholder="https://내서버/tts?lang=ko&text={text}"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              className="h-12 w-full rounded-xl bg-bg2 px-3 text-[15px] text-fg placeholder:text-mute focus:outline-none"
            />
            <div className="mt-2 flex gap-2">
              <Button
                kind="secondary"
                className="h-10 flex-1 text-[14px]"
                onClick={async () => {
                  setTestMsg('요청 중…');
                  try {
                    const url = src.remoteUrl.trim();
                    if (!url.includes('{text}')) throw new Error('{text} 자리표시자가 없습니다.');
                    const res = await fetch(url.replace('{text}', encodeURIComponent('원투, 왼훅, 투!')));
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const b = await res.blob();
                    await new Audio(URL.createObjectURL(b)).play();
                    setTestMsg('정상적으로 받았습니다.');
                  } catch (e) {
                    setTestMsg(`실패: ${(e as Error).message}`);
                  }
                }}
              >
                서버 테스트
              </Button>
              <Button kind="secondary" className="h-10 flex-1 text-[14px]" onClick={() => clearRemoteCache().then(() => setTestMsg('캐시를 비웠습니다.'))}>
                캐시 비우기
              </Button>
            </div>
            {testMsg && <p className="mt-2 text-[13px] text-mute">{testMsg}</p>}
          </Row>
        )}
      </Section>

      {src.provider === 'recorded' && (
        <>
          {!recordingSupported() && <Notice tone="error">이 브라우저는 마이크 녹음(MediaRecorder)을 지원하지 않습니다. iOS 14.5 이상 Safari가 필요합니다.</Notice>}
          <Notice tone={missing.length ? 'warn' : 'info'}>
            {missing.length
              ? `현재 훈련 설정에 필요한 음성 중 ${missing.length}개가 아직 없습니다: ${missing.slice(0, 5).map(clipText).join(', ')}${missing.length > 5 ? ' …' : ''}`
              : '현재 훈련 설정에 필요한 음성이 모두 준비되었습니다.'}
            <div className="mt-1 text-[13px] opacity-80">조용한 곳에서 마이크 버튼을 누르고 또렷하게 말한 뒤 정지를 누르세요. 앞뒤 무음은 자동으로 잘립니다.</div>
          </Notice>
          {err && <Notice tone="error">{err}</Notice>}
          {groups.map(({ g, t }) => (
            <Section key={g} title={t}>
              {CLIP_DEFS.filter((d) => d.group === g).map((d) => (
                <ClipRow
                  key={d.key}
                  def={d}
                  has={keys.includes(d.key)}
                  recording={recKey === d.key}
                  disabled={!recordingSupported() || (recKey != null && recKey !== d.key)}
                  onRecord={() => start(d.key)}
                  onStop={stop}
                  onPlay={() => play(d.key)}
                  onDelete={() => deleteClip(d.key)}
                />
              ))}
            </Section>
          ))}
          <Button kind="danger" className="mb-7 w-full" onClick={() => confirm('녹음한 음성을 모두 지울까요?') && clearClips()}>
            녹음 음성 모두 지우기
          </Button>
        </>
      )}
    </>
  );
}

function Support() {
  const vs = useStore(voiceStatus);
  const pwa = useStore(pwaStore);
  if (NATIVE) {
    const nativeItems: [string, boolean | null, string][] = [
      ['코치 음성', true, 'iOS 음성 엔진 (오프라인)'],
      ['한국어 음성', vs.ready ? vs.korean : null, vs.ready ? (vs.korean ? `${koreanVoices().length}개` : '없음 — 설정에서 내려받기') : '확인 중'],
      ['잠금 화면·백그라운드', true, '타이머와 음성 계속 진행'],
      ['잠금 화면 제어', true, '‘코치만’ 모드에서 표시'],
      ['화면 켜짐 유지', true, '훈련 중 자동'],
      ['진동(햅틱)', true, '사용 가능'],
      ['전화·이어폰 분리', true, '자동 일시정지'],
      ['기본 콤비 데이터', builtinValidation.ok, builtinValidation.ok ? '100개 검증 통과' : `오류 ${builtinValidation.errors.length}건`],
    ];
    return (
      <Section
        title="기기 지원 현황"
        hint="더 자연스러운 한국어 음성은 iPhone 설정 → 손쉬운 사용 → 읽기 및 말하기 → 음성 → 한국어에서 ‘유나(고음질)’ 등을 내려받은 뒤 위 음성 선택에서 고르세요."
      >
        {nativeItems.map(([l, ok, d]) => (
          <Row key={l} label={l}>
            <span className={cx('text-[13px] font-semibold', ok === true ? 'text-accent' : 'text-mute')}>{d}</span>
          </Row>
        ))}
      </Section>
    );
  }
  const items: [string, boolean | null, string][] = [
    ['음성 합성 (실시간 TTS)', vs.supported, vs.supported ? '사용 가능' : '미지원'],
    ['한국어 음성', vs.ready ? vs.korean : null, vs.ready ? (vs.korean ? `${koreanVoices().length}개` : '없음 — 기본 음성으로 읽음') : '확인 중'],
    ['화면 켜짐 유지', wakeLockSupported(), wakeLockSupported() ? '사용 가능' : '미지원 — 자동 잠금을 ‘안 함’으로'],
    ['잠금 화면 미디어 제어', 'mediaSession' in navigator, 'mediaSession' in navigator ? '사용 가능 (연속 트랙 모드)' : '미지원'],
    ['진동', vibrationSupported(), vibrationSupported() ? '사용 가능' : 'iPhone Safari 미지원'],
    ['오프라인 캐시', pwa.swReady, pwa.swReady ? '앱·콤비 데이터 저장됨' : '배포(HTTPS) 후 활성화'],
    ['홈 화면 앱', pwa.standalone, pwa.standalone ? '설치된 앱으로 실행 중' : '브라우저에서 실행 중'],
    ['기본 콤비 데이터', builtinValidation.ok, builtinValidation.ok ? '100개 검증 통과' : `오류 ${builtinValidation.errors.length}건`],
  ];
  return (
    <Section
      title="기기 지원 현황"
      hint="실시간 TTS는 화면이 켜져 있을 때 가장 안정적입니다. iPhone이 잠기면 Safari가 음성 합성을 멈출 수 있습니다. 연속 트랙 모드는 일반 오디오처럼 재생되어 잠금 상태에서도 이어질 가능성이 높지만, iOS 버전에 따라 멈출 수 있습니다. 완전한 백그라운드 재생이 꼭 필요하다면 네이티브 앱이 필요합니다."
    >
      {items.map(([l, ok, d]) => (
        <Row key={l} label={l}>
          <span className={cx('text-[13px] font-semibold', ok === true ? 'text-accent' : ok === false ? 'text-mute' : 'text-mute')}>{d}</span>
        </Row>
      ))}
    </Section>
  );
}

export function Settings({ goTrain }: { goTrain: () => void }) {
  const s = useStore(settingsStore);
  const vs = useStore(voiceStatus);
  const [page, setPage] = useState<'main' | 'track'>('main');
  const voices = vs.voices.filter((v) => v.lang.toLowerCase().startsWith('ko'));
  const voiceList = voices.length ? voices : vs.voices;

  if (page === 'track') {
    return (
      <div className="pt-safe pb-nav px-4">
        <button type="button" className="press mb-2 mt-2 text-[15px] font-semibold text-mute" onClick={() => setPage('main')}>
          ‹ 설정
        </button>
        <PageHeader title="연속 오디오" />
        <TrackSource />
      </div>
    );
  }

  return (
    <div className="pt-safe pb-nav px-4">
      <PageHeader title="설정" />

      <Section>
        <Row label="훈련 설정" desc="모드, 라운드, 휴식, 준비 시간, 난이도" onClick={goTrain}>
          <ChevronRight size={20} className="text-mute" />
        </Row>
        {!NATIVE && (
          <Row label="연속 오디오 음성 준비" desc="잠금 화면 재생용 트랙의 음성" onClick={() => setPage('track')}>
            <ChevronRight size={20} className="text-mute" />
          </Row>
        )}
      </Section>

      <Section title="음성">
        <Row label="음성 스타일" desc={VOICE_STYLE_DESC[s.voiceStyle]} stack>
          <Segmented
            options={(['basic', 'live', 'number'] as VoiceStyle[]).map((v) => ({ value: v, label: VOICE_STYLE_NAMES[v] }))}
            value={s.voiceStyle}
            onChange={(v) => updateSettings({ voiceStyle: v })}
          />
        </Row>
        <Row label="펀치 읽기 방식" desc={s.voiceStyle === 'number' ? '번호 코치 스타일은 항상 번호로 읽습니다' : READ_STYLE_DESC[s.readStyle]} stack>
          <Segmented
            options={(['coach', 'number', 'formal'] as ReadStyle[]).map((v) => ({ value: v, label: READ_STYLE_NAMES[v] }))}
            value={s.readStyle}
            onChange={(v) => updateSettings({ readStyle: v })}
          />
        </Row>
        <Row label="자세" desc={s.stance === 'orthodox' ? '오소독스 — 앞손이 왼손' : '사우스포 — 앞손이 오른손 (3번이 오른훅)'} stack>
          <Segmented
            options={[
              { value: 'orthodox' as const, label: '오소독스' },
              { value: 'southpaw' as const, label: '사우스포' },
            ]}
            value={s.stance}
            onChange={(v) => updateSettings({ stance: v })}
          />
        </Row>
        <Row label="음성 선택" stack>
          <select
            value={s.voiceURI ?? ''}
            onChange={(e) => updateSettings({ voiceURI: e.target.value || null })}
            className="h-12 w-full rounded-xl bg-bg2 px-3 text-[15px] text-fg focus:outline-none"
          >
            <option value="">자동 (기기 한국어 음성 우선)</option>
            {voiceList.map((v) => (
              <option key={v.uri} value={v.uri}>
                {v.name} ({v.lang}){v.local ? '' : ' · 온라인'}
              </option>
            ))}
          </select>
        </Row>
        <Row label="음성 속도" stack>
          <Slider ariaLabel="음성 속도" value={s.rate} min={0.85} max={1.35} step={0.05} onChange={(v) => updateSettings({ rate: v })} format={(v) => `${v.toFixed(2)}배`} />
        </Row>
        <Row label="음성 볼륨" stack>
          <Slider ariaLabel="음성 볼륨" value={Math.round(s.volume * 100)} min={0} max={100} step={5} onChange={(v) => updateSettings({ volume: v / 100 })} format={(v) => `${v}%`} />
        </Row>
        {NATIVE && (
          <Row label="다른 앱 음악" desc={AUDIO_MIX_DESC[s.audioMix]} stack>
            <Segmented
              options={(['mix', 'duck', 'solo'] as AudioMix[]).map((v) => ({ value: v, label: AUDIO_MIX_NAMES[v] }))}
              value={s.audioMix}
              onChange={(v) => updateSettings({ audioMix: v })}
            />
          </Row>
        )}
        <VoiceTest />
      </Section>

      <Section title="알림음과 안내">
        <Row label="명령 전 알림음" desc="명령 직전에 짧은 틱 소리">
          <Toggle label="명령 전 알림음" checked={s.preBeep} onChange={(v) => updateSettings({ preBeep: v })} />
        </Row>
        <Row label="라운드 벨" desc="라운드 시작과 종료에 벨 소리">
          <Toggle label="라운드 벨" checked={s.bell} onChange={(v) => updateSettings({ bell: v })} />
        </Row>
        <Row label="카운트다운" desc="준비·휴식 끝 3초 음성, 라운드 마지막 3초 비프">
          <Toggle label="카운트다운" checked={s.countdown} onChange={(v) => updateSettings({ countdown: v })} />
        </Row>
        <Row label="남은 시간 안내" desc="“십 초 남았습니다!”">
          <Toggle label="남은 시간 안내" checked={s.timeAnnounce} onChange={(v) => updateSettings({ timeAnnounce: v })} />
        </Row>
      </Section>

      <Section title="명령">
        <Row label="최근 명령 반복 제한" desc={s.recentLimit ? `최근 ${s.recentLimit}개 콤비는 가능하면 다시 나오지 않습니다` : '제한 없음'} stack>
          <Slider ariaLabel="최근 명령 반복 제한" value={s.recentLimit} min={0} max={10} onChange={(v) => updateSettings({ recentLimit: v })} format={(v) => `${v}개`} />
        </Row>
        <Row label="코칭 큐" desc="가끔 “가드 올려!”, “거리 유지!” 같은 짧은 지시">
          <Toggle label="코칭 큐" checked={s.coachCues} onChange={(v) => updateSettings({ coachCues: v })} />
        </Row>
        <Row label="스텝 + 콤비 연결 명령" desc="믹스 모드에서 “앞으로, 원투!”">
          <Toggle label="연결 명령" checked={s.linkCommands} onChange={(v) => updateSettings({ linkCommands: v })} />
        </Row>
      </Section>

      <Section title="화면">
        <Row label="배경" stack>
          <Segmented
            options={[
              { value: 'dark' as const, label: '다크' },
              { value: 'black' as const, label: '트루 블랙 (OLED)' },
            ]}
            value={s.tone}
            onChange={(v) => updateSettings({ tone: v })}
          />
        </Row>
        <Row label="훈련 중 화면 켜짐 유지" desc={NATIVE ? '훈련 화면을 보면서 할 때 켜 두세요. 꺼도 잠금 상태에서 음성은 계속 나옵니다.' : wakeLockSupported() ? '훈련하는 동안 화면이 꺼지지 않게 합니다' : '이 기기는 지원하지 않습니다. 설정 → 디스플레이 → 자동 잠금을 길게 바꿔 주세요.'}>
          <Toggle label="화면 켜짐 유지" disabled={!wakeLockSupported()} checked={s.keepAwake && wakeLockSupported()} onChange={(v) => updateSettings({ keepAwake: v })} />
        </Row>
        <Row label="타이머 크기" stack>
          <Segmented
            options={[
              { value: 'normal' as const, label: '보통' },
              { value: 'large' as const, label: '크게' },
            ]}
            value={s.timerSize}
            onChange={(v) => updateSettings({ timerSize: v })}
          />
        </Row>
        <Row label="진동" desc={vibrationSupported() ? '명령과 라운드 전환 때 진동' : '이 기기의 브라우저는 진동을 지원하지 않습니다'}>
          <Toggle label="진동" disabled={!vibrationSupported()} checked={s.vibrate && vibrationSupported()} onChange={(v) => updateSettings({ vibrate: v })} />
        </Row>
        <Row label="명령 표시 애니메이션">
          <Toggle label="명령 표시 애니메이션" checked={s.animation} onChange={(v) => updateSettings({ animation: v })} />
        </Row>
      </Section>

      <Support />

      <Section title="데이터" hint="모든 데이터는 이 기기에만 저장됩니다. 회원가입이나 서버 전송은 없습니다.">
        <Row label="훈련 기록 초기화" onClick={() => confirm('훈련 기록을 모두 지울까요?') && clearHistory()}>
          <span className="text-[14px] font-semibold text-danger">초기화</span>
        </Row>
        <Row label="콤비네이션 설정 초기화" desc="즐겨찾기와 등장 빈도 (내가 만든 콤비는 유지)" onClick={() => confirm('즐겨찾기와 등장 빈도를 초기화할까요?') && resetComboPrefs()}>
          <span className="text-[14px] font-semibold text-danger">초기화</span>
        </Row>
        <Row
          label="모든 설정 초기화"
          desc="훈련·음성·화면 설정과 프리셋"
          onClick={() => {
            if (confirm('모든 설정을 기본값으로 되돌릴까요?')) {
              resetSettings();
              resetPresets();
            }
          }}
        >
          <span className="text-[14px] font-semibold text-danger">초기화</span>
        </Row>
      </Section>
      <p className="mb-6 px-1 text-center text-[12px] text-mute">BOXING VOICE COACH 1.0 · 어퍼컷은 모든 콤비네이션에서 제외되어 있습니다</p>
    </div>
  );
}
