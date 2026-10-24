import { useMemo, useState } from 'react';
import { Delete, Heart, Pencil, Plus, Repeat, Trash2, Volume2 } from 'lucide-react';
import { useStore } from '../stores/store';
import {
  allCombinations, customStore, deleteCustomCombo, filterCombinations, getCombination, prefsStore, saveCustomCombo,
  setWeight, toggleFavorite, type LibraryFilter,
} from '../services/CombinationDatabase';
import { settingsStore, updateSettings } from '../services/SettingsManager';
import { engine } from '../services/WorkoutEngine';
import { speak, unlockSpeech } from '../audio/VoiceEngine';
import { PUNCH_CODES, punchFullName } from '../data/punches';
import { comboRateMul, comboSpeech, comboSub } from '../utils/speech';
import { WEIGHT_NAMES } from '../utils/labels';
import { Button, Chip, PageHeader, Segmented, Sheet, Toggle, cx } from '../components/ui';
import { PunchPill, PunchRow, comboMeta, comboTitle } from '../components/ComboView';
import type { Combination, PunchCode, Weight } from '../types';

function sayCombo(punches: PunchCode[]) {
  const s = settingsStore.get();
  unlockSpeech();
  speak(comboSpeech(punches, s.readStyle, s.voiceStyle, s.stance), { interrupt: true, rateMul: comboRateMul(punches.length, s.voiceStyle) });
}

const FILTERS: { v: LibraryFilter; l: string }[] = [
  { v: 'all', l: '전체' },
  { v: 'beginner', l: '초급' },
  { v: 'intermediate', l: '중급' },
  { v: 'advanced', l: '고급' },
  { v: 'n2', l: '2연타' },
  { v: 'n3', l: '3연타' },
  { v: 'n4', l: '4연타' },
  { v: 'n5', l: '5연타' },
  { v: 'n6', l: '6연타' },
  { v: 'body', l: '바디 포함' },
  { v: 'nobody', l: '바디 제외' },
  { v: 'fav', l: '즐겨찾기' },
  { v: 'custom', l: '내 콤비' },
  { v: 'excluded', l: '제외됨' },
];

function ComboItem({ c, fav, weight, onOpen }: { c: Combination; fav: boolean; weight: Weight; onOpen: () => void }) {
  const stance = useStore(settingsStore).stance;
  return (
    <div className={cx('flex items-center gap-2 border-b border-line last:border-b-0', weight === 'excluded' && 'opacity-45')}>
      <button type="button" onClick={onOpen} className="press min-w-0 flex-1 px-4 py-3 text-left">
        <div className="mb-1.5 flex items-center gap-2 text-[12px] text-mute">
          <span className="tnum font-bold text-fg">{comboTitle(c)}</span>
          <span>{comboMeta(c)}</span>
          {fav && <Heart size={12} className="text-accent" fill="currentColor" />}
          {weight !== 'normal' && <span className="rounded bg-bg2 px-1.5 py-0.5 text-[11px] font-semibold">{WEIGHT_NAMES[weight]}</span>}
        </div>
        <PunchRow punches={c.punches} size="sm" />
        <div className="mt-1.5 truncate text-[14px] text-mute">{comboSub(c.punches, stance)}</div>
      </button>
      <button type="button" aria-label="음성으로 듣기" onClick={() => sayCombo(c.punches)} className="press mr-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-bg2">
        <Volume2 size={20} />
      </button>
    </div>
  );
}

function Editor({ open, onClose, editId }: { open: boolean; onClose: () => void; editId: string | null }) {
  const existing = editId ? getCombination(editId) : undefined;
  const [seq, setSeq] = useState<PunchCode[]>(existing?.punches ?? []);
  const [name, setName] = useState(existing?.name ?? '');
  const [err, setErr] = useState<string | null>(null);
  const stance = useStore(settingsStore).stance;
  const add = (p: PunchCode) => {
    setErr(null);
    setSeq((s) => (s.length >= 8 ? s : [...s, p]));
  };
  const save = () => {
    const r = saveCustomCombo(seq, name, editId ?? undefined);
    if (!r.ok) return setErr(r.error);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={editId ? '콤비 수정' : '새 콤비 만들기'}>
      <div className="mb-4 flex min-h-[72px] flex-wrap items-center gap-1.5 rounded-2xl bg-card p-3">
        {seq.length === 0 ? <span className="px-1 text-[14px] text-mute">아래 펀치를 눌러 순서대로 추가하세요</span> : <PunchRow punches={seq} size="md" />}
      </div>
      {seq.length > 0 && <div className="mb-4 px-1 text-[15px] text-mute">{comboSub(seq, stance)}</div>}
      <div className="mb-3 grid grid-cols-4 gap-2">
        {PUNCH_CODES.map((p) => (
          <button key={p} type="button" onClick={() => add(p)} className="press flex h-[68px] flex-col items-center justify-center rounded-2xl bg-card">
            <PunchPill code={p} size="sm" />
            <span className="mt-1 text-[11px] text-mute">{punchFullName(p, stance).replace(/\(.+\)/, '').replace('앞손', '앞').replace('뒷손', '뒤')}</span>
          </button>
        ))}
      </div>
      <div className="mb-4 flex gap-2">
        <Button kind="secondary" className="flex-1" onClick={() => setSeq((s) => s.slice(0, -1))} disabled={!seq.length}>
          <Delete size={18} /> 지우기
        </Button>
        <Button kind="secondary" className="flex-1" onClick={() => sayCombo(seq)} disabled={!seq.length}>
          <Volume2 size={18} /> 미리듣기
        </Button>
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={24}
        placeholder="이름 (선택)"
        className="mb-3 h-12 w-full rounded-xl bg-card px-3 text-fg placeholder:text-mute focus:outline-none"
      />
      {err && <div className="mb-3 rounded-xl bg-danger/15 px-3 py-2 text-[14px] text-[#ffb3b5]">{err}</div>}
      <Button className="mb-4 w-full" onClick={save} disabled={!seq.length}>
        저장
      </Button>
    </Sheet>
  );
}

function Detail({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (id: string) => void }) {
  const prefs = useStore(prefsStore);
  const s = useStore(settingsStore);
  useStore(customStore);
  const [reps, setReps] = useState(5);
  const c = id ? getCombination(id) : undefined;
  if (!c) return null;
  const fav = prefs.favorites.includes(c.id);
  const weight = prefs.weights[c.id] ?? 'normal';
  const inCustom = s.customSelection.includes(c.id);
  return (
    <Sheet open={!!id} onClose={onClose} title={`${comboTitle(c)} · ${comboMeta(c)}`}>
      <div className="mb-4 rounded-3xl bg-card px-4 py-6 text-center">
        <div className="mb-3 flex justify-center">
          <PunchRow punches={c.punches} size="lg" />
        </div>
        <div className="text-[19px] font-bold">{comboSub(c.punches, s.stance)}</div>
      </div>
      <ol className="mb-4 space-y-1.5">
        {c.punches.map((p, i) => (
          <li key={i} className="flex items-center gap-3 rounded-xl bg-card px-3 py-2">
            <span className="tnum w-5 text-[13px] text-mute">{i + 1}</span>
            <PunchPill code={p} size="sm" />
            <span className="text-[15px]">{punchFullName(p, s.stance)}</span>
          </li>
        ))}
      </ol>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Button kind="secondary" onClick={() => sayCombo(c.punches)}>
          <Volume2 size={18} /> 음성으로 듣기
        </Button>
        <Button kind="secondary" onClick={() => toggleFavorite(c.id)} className={fav ? 'text-accent' : ''}>
          <Heart size={18} fill={fav ? 'currentColor' : 'none'} /> {fav ? '즐겨찾기됨' : '즐겨찾기'}
        </Button>
      </div>
      <div className="mb-1.5 px-1 text-[14px] font-bold">등장 빈도</div>
      <div className="mb-4">
        <Segmented
          options={(['often', 'normal', 'rare', 'excluded'] as Weight[]).map((w) => ({ value: w, label: WEIGHT_NAMES[w] }))}
          value={weight}
          onChange={(w) => setWeight(c.id, w)}
        />
      </div>
      <div className="mb-4 flex items-center justify-between rounded-2xl bg-card px-4 py-3">
        <div>
          <div className="text-[15px] font-medium">커스텀 세션에 포함</div>
          <div className="text-[13px] text-mute">커스텀 모드에서 이 콤비가 나옵니다</div>
        </div>
        <Toggle
          label="커스텀 세션에 포함"
          checked={inCustom}
          onChange={(v) => updateSettings({ customSelection: v ? [...s.customSelection, c.id] : s.customSelection.filter((x) => x !== c.id) })}
        />
      </div>
      <div className="mb-4 rounded-2xl bg-card p-3">
        <div className="mb-2 px-1 text-[15px] font-medium">반복 연습</div>
        <div className="mb-3">
          <Segmented small options={[3, 5, 10, 20].map((n) => ({ value: n, label: `${n}회` }))} value={reps} onChange={setReps} />
        </div>
        <Button
          className="w-full"
          onClick={() => {
            onClose();
            engine.start({ repeat: { comboId: c.id, count: reps } });
          }}
        >
          <Repeat size={18} /> {reps}회 반복 시작
        </Button>
      </div>
      {c.custom && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Button kind="secondary" onClick={() => onEdit(c.id)}>
            <Pencil size={18} /> 수정
          </Button>
          <Button
            kind="danger"
            onClick={() => {
              deleteCustomCombo(c.id);
              updateSettings({ customSelection: s.customSelection.filter((x) => x !== c.id) });
              onClose();
            }}
          >
            <Trash2 size={18} /> 삭제
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export function Library() {
  const prefs = useStore(prefsStore);
  useStore(customStore);
  useStore(settingsStore);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; id: string | null; key: number }>({ open: false, id: null, key: 0 });
  const list = useMemo(() => filterCombinations(allCombinations(), filter, prefs.favorites, prefs.weights), [filter, prefs]);

  return (
    <div className="pt-safe pb-nav px-4">
      <PageHeader
        title="콤비네이션"
        right={
          <button type="button" onClick={() => setEditor((e) => ({ open: true, id: null, key: e.key + 1 }))} className="press flex h-10 items-center gap-1.5 rounded-full bg-card px-3.5 text-[14px] font-bold">
            <Plus size={18} /> 만들기
          </button>
        }
      />
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        {FILTERS.map((f) => (
          <Chip key={f.v} active={filter === f.v} onClick={() => setFilter(f.v)}>
            {f.l}
          </Chip>
        ))}
      </div>
      <p className="mb-3 px-1 text-[13px] text-mute">
        {list.length}개 · 숫자 1 잽, 2 스트레이트, 3 앞손 훅, 4 뒷손 훅, B는 바디
      </p>
      {list.length === 0 ? (
        <div className="rounded-2xl bg-card px-4 py-10 text-center text-[14px] text-mute">
          {filter === 'custom' ? '아직 만든 콤비가 없습니다. 오른쪽 위 ‘만들기’로 추가하세요.' : '조건에 맞는 콤비가 없습니다.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-card">
          {list.map((c) => (
            <ComboItem key={c.id} c={c} fav={prefs.favorites.includes(c.id)} weight={prefs.weights[c.id] ?? 'normal'} onOpen={() => setOpenId(c.id)} />
          ))}
        </div>
      )}
      <Detail
        id={openId}
        onClose={() => setOpenId(null)}
        onEdit={(id) => {
          setOpenId(null);
          setEditor((e) => ({ open: true, id, key: e.key + 1 }));
        }}
      />
      <Editor key={editor.key} open={editor.open} editId={editor.id} onClose={() => setEditor((e) => ({ ...e, open: false }))} />
    </div>
  );
}
