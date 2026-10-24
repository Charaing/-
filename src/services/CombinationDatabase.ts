import type { Combination, Difficulty, PunchCode, Weight } from '../types';
import { BUILTIN_COMBINATIONS, makeCombination, validateCombinations } from '../data/combinations';
import { isPunchCode } from '../data/punches';
import { createStore } from '../stores/store';

export interface CustomComboRaw {
  id: string;
  name: string;
  punches: PunchCode[];
  createdAt: number;
}

export interface ComboPrefs {
  favorites: string[];
  weights: Record<string, Weight>;
}

/** 사용자 데이터는 기본 100개와 분리된 키에 저장 */
export const customStore = createStore<CustomComboRaw[]>([], 'bvc.customCombos.v1', (raw) =>
  Array.isArray(raw)
    ? (raw as CustomComboRaw[]).filter((c) => c && Array.isArray(c.punches) && c.punches.length >= 1 && c.punches.length <= 8 && c.punches.every((p) => isPunchCode(p)))
    : [],
);

export const prefsStore = createStore<ComboPrefs>({ favorites: [], weights: {} }, 'bvc.comboPrefs.v1', (raw) => {
  const r = (raw ?? {}) as Partial<ComboPrefs>;
  return { favorites: Array.isArray(r.favorites) ? r.favorites : [], weights: r.weights && typeof r.weights === 'object' ? r.weights : {} };
});

export const builtinValidation = validateCombinations(BUILTIN_COMBINATIONS, 100);
if (!builtinValidation.ok) console.error('[CombinationDatabase] 기본 데이터 검증 실패', builtinValidation.errors);

let cacheKey: CustomComboRaw[] | null = null;
let cacheList: Combination[] = [];

export function customCombinations(): Combination[] {
  const raw = customStore.get();
  if (raw === cacheKey) return cacheList;
  cacheKey = raw;
  cacheList = raw.map((c) => makeCombination(c.punches, { id: c.id, no: 0, group: 'U', custom: true, name: c.name }));
  return cacheList;
}

export function allCombinations(): Combination[] {
  return [...BUILTIN_COMBINATIONS, ...customCombinations()];
}

export function getCombination(id: string): Combination | undefined {
  return BUILTIN_COMBINATIONS.find((c) => c.id === id) ?? customCombinations().find((c) => c.id === id);
}

export function weightOf(id: string): Weight {
  return prefsStore.get().weights[id] ?? 'normal';
}

export function setWeight(id: string, w: Weight) {
  prefsStore.set((p) => {
    const weights = { ...p.weights };
    if (w === 'normal') delete weights[id];
    else weights[id] = w;
    return { ...p, weights };
  });
}

export function toggleFavorite(id: string) {
  prefsStore.set((p) => ({
    ...p,
    favorites: p.favorites.includes(id) ? p.favorites.filter((x) => x !== id) : [...p.favorites, id],
  }));
}

export function resetComboPrefs() {
  prefsStore.set({ favorites: [], weights: {} });
}

export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

export function saveCustomCombo(punches: PunchCode[], name: string, id?: string): SaveResult {
  if (punches.length < 1) return { ok: false, error: '펀치를 1개 이상 선택하세요.' };
  if (punches.length > 8) return { ok: false, error: '최대 8개까지 만들 수 있습니다.' };
  if (!punches.every(isPunchCode)) return { ok: false, error: '허용되지 않은 펀치가 있습니다.' };
  const key = punches.join('-');
  const dupBuiltin = BUILTIN_COMBINATIONS.find((c) => c.punches.join('-') === key);
  if (dupBuiltin) return { ok: false, error: `기본 콤비 #${String(dupBuiltin.no).padStart(3, '0')}와 같습니다.` };
  const dupCustom = customStore.get().find((c) => c.punches.join('-') === key && c.id !== id);
  if (dupCustom) return { ok: false, error: `이미 '${dupCustom.name}'으로 저장되어 있습니다.` };
  const finalName = name.trim().slice(0, 24) || key;
  if (id) {
    customStore.set((l) => l.map((c) => (c.id === id ? { ...c, punches, name: finalName } : c)));
    return { ok: true, id };
  }
  const newId = `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  customStore.set((l) => [...l, { id: newId, name: finalName, punches, createdAt: Date.now() }]);
  return { ok: true, id: newId };
}

export function deleteCustomCombo(id: string) {
  customStore.set((l) => l.filter((c) => c.id !== id));
  prefsStore.set((p) => {
    const weights = { ...p.weights };
    delete weights[id];
    return { favorites: p.favorites.filter((x) => x !== id), weights };
  });
}

export type LibraryFilter =
  | 'all' | 'beginner' | 'intermediate' | 'advanced'
  | 'n2' | 'n3' | 'n4' | 'n5' | 'n6'
  | 'body' | 'nobody' | 'fav' | 'custom' | 'excluded';

export function filterCombinations(list: Combination[], f: LibraryFilter, favorites: string[], weights: Record<string, Weight>): Combination[] {
  switch (f) {
    case 'all': return list;
    case 'beginner':
    case 'intermediate':
    case 'advanced': return list.filter((c) => c.difficulty === f);
    case 'n2': case 'n3': case 'n4': case 'n5': case 'n6': {
      const n = Number(f[1]);
      return list.filter((c) => c.count === n);
    }
    case 'body': return list.filter((c) => c.hasBody);
    case 'nobody': return list.filter((c) => !c.hasBody);
    case 'fav': return list.filter((c) => favorites.includes(c.id));
    case 'custom': return list.filter((c) => c.custom);
    case 'excluded': return list.filter((c) => weights[c.id] === 'excluded');
  }
}

/** 훈련 난이도 설정에서 허용되는 콤비 난이도 */
export function allowedDifficulties(d: Difficulty): Difficulty[] {
  if (d === 'beginner') return ['beginner'];
  if (d === 'intermediate') return ['beginner', 'intermediate'];
  return ['beginner', 'intermediate', 'advanced'];
}
