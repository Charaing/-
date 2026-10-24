import { useMemo, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { useStore } from '../stores/store';
import { INTERVAL_PRESETS, deletePreset, presetStore, savePresetFromCurrent, settingsStore, updateSettings } from '../services/SettingsManager';
import { allCombinations, customStore } from '../services/CombinationDatabase';
import { deleteRecord, filterByRange, historyStore, summarize, type HistoryRange } from '../services/WorkoutHistory';
import { formatDuration, formatSec } from '../services/timeline';
import { AUDIO_MIX_DESC, AUDIO_MIX_NAMES, DIFF_NAMES, MODE_DESC, MODE_NAMES } from '../utils/labels';
import { isNativeApp } from '../native/CoachEngine';
import type { AudioMix } from '../types';

const NATIVE = isNativeApp();

export function AudioMixSection() {
  const s = useStore(settingsStore);
  return (
    <Section
      title="다른 앱 음악"
      hint={`${AUDIO_MIX_DESC[s.audioMix]} 화면이 잠겨도 코치 음성과 타이머는 계속 진행됩니다.`}
    >
      <Row label="코치 음성과 음악" stack>
        <Segmented
          options={(['mix', 'duck', 'solo'] as AudioMix[]).map((v) => ({ value: v, label: AUDIO_MIX_NAMES[v] }))}
          value={s.audioMix}
          onChange={(v) => updateSettings({ audioMix: v })}
        />
      </Row>
    </Section>
  );
}
import { Button, Chip, PageHeader, Row, Section, Segmented, Sheet, Slider, Stepper, Toggle, cx } from '../components/ui';
import { PunchRow, comboTitle } from '../components/ComboView';
import type { Difficulty, TrainingMode } from '../types';

export function CustomSelectSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore(settingsStore);
  useStore(customStore);
  const list = allCombinations();
  const sel = new Set(s.customSelection);
  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateSettings({ customSelection: [...next] });
  };
  return (
    <Sheet open={open} onClose={onClose} title={`커스텀 세션 · ${sel.size}개 선택`}>
      <div className="mb-3 flex gap-2">
        <Button kind="secondary" className="h-10 flex-1 text-[14px]" onClick={() => updateSettings({ customSelection: [] })}>
          모두 해제
        </Button>
        <Button kind="secondary" className="h-10 flex-1 text-[14px]" onClick={() => updateSettings({ customSelection: list.filter((c) => c.custom).map((c) => c.id) })}>
          내 콤비만
        </Button>
      </div>
      <div className="mb-6 space-y-1.5">
        {list.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => toggle(c.id)}
            className={cx('press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', sel.has(c.id) ? 'bg-card' : 'bg-transparent')}
          >
            <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', sel.has(c.id) ? 'bg-accent text-bg' : 'bg-card')}>
              {sel.has(c.id) && <Check size={16} strokeWidth={3} />}
            </span>
            <span className="tnum w-12 shrink-0 text-[13px] text-mute">{comboTitle(c)}</span>
            <PunchRow punches={c.punches} size="sm" />
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function TrainingSetup() {
  const s = useStore(settingsStore);
  const presets = useStore(presetStore);
  const [customOpen, setCustomOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const modes: TrainingMode[] = ['mix', 'combo', 'footwork', 'technique', 'custom'];
  const usesDifficulty = s.mode !== 'custom';

  return (
    <>
      <Section title="훈련 모드">
        {modes.map((m) => (
          <Row
            key={m}
            label={MODE_NAMES[m]}
            desc={MODE_DESC[m]}
            onClick={() => updateSettings({ mode: m })}
          >
            <span className={cx('flex h-6 w-6 items-center justify-center rounded-full', s.mode === m ? 'bg-accent text-bg' : 'bg-bg2')}>
              {s.mode === m && <Check size={15} strokeWidth={3} />}
            </span>
          </Row>
        ))}
        {s.mode === 'custom' && (
          <Row label="세션에 넣을 콤비" desc={`${s.customSelection.length}개 선택됨`} onClick={() => setCustomOpen(true)}>
            <span className="text-[14px] font-semibold text-accent">선택</span>
          </Row>
        )}
      </Section>

      <Section title="라운드">
        <Row label="라운드 수">
          <Stepper value={s.rounds} min={1} max={12} onChange={(v) => updateSettings({ rounds: v })} format={(v) => `${v}R`} />
        </Row>
        <Row label="라운드 시간">
          <Stepper value={s.roundSec} min={30} max={180} step={15} onChange={(v) => updateSettings({ roundSec: v })} format={formatSec} />
        </Row>
        <Row label="휴식 시간">
          <Stepper value={s.restSec} min={15} max={120} step={15} onChange={(v) => updateSettings({ restSec: v })} format={formatSec} />
        </Row>
        <Row label="시작 전 준비" stack>
          <Segmented options={[3, 5, 10].map((v) => ({ value: v as 3 | 5 | 10, label: `${v}초` }))} value={s.prepSec} onChange={(v) => updateSettings({ prepSec: v })} />
        </Row>
      </Section>

      {usesDifficulty && (
        <Section
          title="난이도"
          hint={
            {
              beginner: '2~3연타, 직선과 앞손 훅 위주. 기본 스텝만 나옵니다.',
              intermediate: '2~5연타, 훅과 바디 포함. 초급 콤비도 섞여 나옵니다.',
              advanced: '2~6연타, 100개 전체를 사용합니다. 속도는 따로 조절하세요.',
            }[s.difficulty]
          }
        >
          <Row label="콤비네이션 난이도" stack>
            <Segmented
              options={(['beginner', 'intermediate', 'advanced'] as Difficulty[]).map((d) => ({ value: d, label: DIFF_NAMES[d] }))}
              value={s.difficulty}
              onChange={(v) => updateSettings({ difficulty: v })}
            />
          </Row>
        </Section>
      )}

      <Section title="명령 간격" hint="앞 명령의 음성이 끝난 뒤 다음 명령까지의 시간입니다. 명령이 길어도 겹치지 않습니다.">
        <Row label="간격" stack>
          <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
            {INTERVAL_PRESETS.map((p) => (
              <Chip key={p.sec} active={s.intervalSec === p.sec} onClick={() => updateSettings({ intervalSec: p.sec })}>
                {p.label} {p.sec}초
              </Chip>
            ))}
          </div>
          <Slider ariaLabel="명령 간격" value={s.intervalSec} min={3} max={30} step={0.5} onChange={(v) => updateSettings({ intervalSec: v })} format={(v) => `${v}초`} />
        </Row>
        <Row label="랜덤 간격" desc="매번 간격이 조금씩 달라져 리듬이 고정되지 않습니다">
          <Toggle label="랜덤 간격" checked={s.randomInterval} onChange={(v) => updateSettings({ randomInterval: v })} />
        </Row>
        {s.randomInterval && (
          <Row
            label="변동 폭"
            desc={`${(s.intervalSec * (1 - s.randomRange / 100)).toFixed(1)}~${(s.intervalSec * (1 + s.randomRange / 100)).toFixed(1)}초`}
            stack
          >
            <Slider ariaLabel="변동 폭" value={s.randomRange} min={0} max={30} onChange={(v) => updateSettings({ randomRange: v })} format={(v) => `±${v}%`} />
          </Row>
        )}
      </Section>

      {s.mode === 'mix' && (
        <Section title="믹스 비율">
          <Row label="콤비네이션 / 풋워크" desc={`콤비 ${s.comboRatio}% · 풋워크 ${100 - s.comboRatio}%`} stack>
            <Slider ariaLabel="콤비네이션 비율" value={s.comboRatio} min={0} max={100} step={5} onChange={(v) => updateSettings({ comboRatio: v })} format={(v) => `${v}%`} />
          </Row>
          <Row label="스텝 + 콤비 연결" desc="“왼쪽 스텝, 원투 왼훅!”처럼 이어서 지시">
            <Toggle label="연결 명령" checked={s.linkCommands} onChange={(v) => updateSettings({ linkCommands: v })} />
          </Row>
        </Section>
      )}

      {NATIVE ? (
        <AudioMixSection />
      ) : (
      <Section
          title="오디오 방식"
          hint={
            s.audioMode === 'live'
              ? '기기 음성으로 실시간 안내합니다. 화면이 켜져 있어야 안정적으로 들립니다.'
              : '훈련 전체를 하나의 오디오 트랙으로 만들어 재생합니다. 잠금 화면에서도 이어질 가능성이 높지만 iOS 버전에 따라 멈출 수 있습니다. 설정 → 연속 오디오에서 음성을 먼저 준비하세요.'
          }
        >
          <Row label="재생 방식" stack>
            <Segmented
              options={[
                { value: 'live' as const, label: '실시간 TTS' },
                { value: 'track' as const, label: '연속 오디오 트랙' },
              ]}
              value={s.audioMode}
              onChange={(v) => updateSettings({ audioMode: v })}
            />
          </Row>
        </Section>
      )}

      <Section title="프리셋으로 저장">
        <div className="flex gap-2 p-3">
          <input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            maxLength={20}
            placeholder="이름 (예: 아침 샌드백)"
            className="h-12 min-w-0 flex-1 rounded-xl bg-bg2 px-3 text-fg placeholder:text-mute focus:outline-none"
          />
          <Button
            className="h-12 shrink-0"
            disabled={!presetName.trim()}
            onClick={() => {
              savePresetFromCurrent(presetName);
              setPresetName('');
            }}
          >
            저장
          </Button>
        </div>
        {presets.map((p) => (
          <Row key={p.id} label={p.name} desc={`${p.values.mode ? MODE_NAMES[p.values.mode] : ''} · ${p.values.rounds}R × ${formatSec(p.values.roundSec ?? 0)}`}>
            <button type="button" aria-label={`${p.name} 삭제`} className="press p-2 text-mute" onClick={() => deletePreset(p.id)}>
              <Trash2 size={18} />
            </button>
          </Row>
        ))}
      </Section>

      <CustomSelectSheet open={customOpen} onClose={() => setCustomOpen(false)} />
    </>
  );
}

function History() {
  const list = useStore(historyStore);
  const [range, setRange] = useState<HistoryRange>('d7');
  const filtered = useMemo(() => filterByRange(list, range), [list, range]);
  const sum = summarize(filtered);
  const all = summarize(list);
  const ranges: { v: HistoryRange; l: string }[] = [
    { v: 'today', l: '오늘' },
    { v: 'd7', l: '최근 7일' },
    { v: 'd30', l: '최근 30일' },
    { v: 'all', l: '전체' },
  ];
  return (
    <>
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {ranges.map((r) => (
          <Chip key={r.v} active={range === r.v} onClick={() => setRange(r.v)}>
            {r.l}
          </Chip>
        ))}
      </div>
      <div className="mb-6 grid grid-cols-2 gap-2">
        <Stat label="훈련 시간" value={formatDuration(sum.workMs)} big />
        <Stat label="세션" value={`${sum.sessions}회`} big />
        <Stat label="완료 라운드" value={`${sum.rounds}R`} />
        <Stat label="안내된 콤비" value={`${sum.combos}회`} />
      </div>
      <p className="mb-3 px-1 text-[13px] text-mute">누적 훈련 시간 {formatDuration(all.workMs)} · 총 {all.sessions}회</p>
      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-card px-4 py-10 text-center text-[14px] text-mute">이 기간의 훈련 기록이 없습니다. 홈에서 훈련을 시작해 보세요.</div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-card">
          {filtered.map((r) => (
            <Row
              key={r.id}
              label={
                <span>
                  {new Date(r.startedAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}{' '}
                  <span className="text-mute">{new Date(r.startedAt).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}</span>
                </span>
              }
              desc={`${MODE_NAMES[r.mode]} · ${r.roundsCompleted}/${r.roundsPlanned}R · ${formatDuration(r.workMs)}${r.completed ? '' : ' · 중단'}`}
            >
              <button type="button" aria-label="기록 삭제" className="press p-2 text-mute" onClick={() => deleteRecord(r.id)}>
                <Trash2 size={18} />
              </button>
            </Row>
          ))}
        </div>
      )}
    </>
  );
}

export function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-2xl bg-card px-4 py-3">
      <div className="text-[12px] font-medium text-mute">{label}</div>
      <div className={cx('tnum mt-0.5 font-extrabold', big ? 'text-[24px]' : 'text-[19px]')}>{value}</div>
    </div>
  );
}

export function Train() {
  const [tab, setTab] = useState<'setup' | 'history'>('setup');
  return (
    <div className="pt-safe pb-nav px-4">
      <PageHeader title="훈련" />
      <div className="mb-5">
        <Segmented
          options={[
            { value: 'setup' as const, label: '훈련 설정' },
            { value: 'history' as const, label: '기록' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === 'setup' ? <TrainingSetup /> : <History />}
    </div>
  );
}
