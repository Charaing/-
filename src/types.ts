export type PunchCode = '1' | '2' | '3' | '4' | '1B' | '2B' | '3B' | '4B';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type ComboGroup = 'A' | 'B' | 'C' | 'D' | 'E' | 'U';
export type Weight = 'normal' | 'often' | 'rare' | 'excluded';
export type TrainingMode = 'combo' | 'footwork' | 'mix' | 'technique' | 'custom';
export type VoiceStyle = 'basic' | 'live' | 'number';
export type ReadStyle = 'coach' | 'number' | 'formal';
export type Stance = 'orthodox' | 'southpaw';
export type AudioMode = 'live' | 'track';
export type EngineAudio = AudioMode | 'native';
export type AudioMix = 'mix' | 'duck' | 'solo';

export interface Combination {
  id: string; // 'c001'..'c100' 또는 'u_xxxx'
  no: number; // 표시 번호 (사용자 지정은 0)
  punches: PunchCode[];
  count: number;
  hasBody: boolean;
  difficulty: Difficulty;
  group: ComboGroup;
  speech: string; // 기본(오소독스·코치 스타일) 음성 문구
  custom?: boolean;
  name?: string;
}

export interface FootworkStep {
  id: string; // 'f01'..'f12'
  label: string;
  speech: string;
  linkPrefix?: string; // 콤비와 연결할 때 앞에 붙는 짧은 문구
  minSec: number; // 최소 수행 시간
  basic: boolean;
}

export interface Settings {
  // 훈련
  mode: TrainingMode;
  rounds: number;
  roundSec: number;
  restSec: number;
  prepSec: 3 | 5 | 10;
  difficulty: Difficulty;
  // 명령
  intervalSec: number;
  randomInterval: boolean;
  randomRange: number; // 0~30 (%)
  comboRatio: number; // 0~100 (%), 나머지는 풋워크
  linkCommands: boolean;
  recentLimit: number; // 최근 n개 반복 회피
  coachCues: boolean; // '가드 올려!' 같은 짧은 코칭 큐
  customSelection: string[];
  // 음성
  voiceURI: string | null;
  rate: number; // 0.85~1.35
  volume: number; // 0~1
  voiceStyle: VoiceStyle;
  readStyle: ReadStyle;
  stance: Stance;
  preBeep: boolean;
  bell: boolean;
  countdown: boolean;
  timeAnnounce: boolean;
  // 화면
  tone: 'dark' | 'black';
  keepAwake: boolean;
  timerSize: 'normal' | 'large';
  vibrate: boolean;
  animation: boolean;
  // 오디오
  audioMode: AudioMode;
  audioMix: AudioMix; // iOS 앱: 다른 앱 음악과 함께/줄이기/단독
}

export type CommandKind = 'combo' | 'footwork' | 'link' | 'cue';

export interface Command {
  kind: CommandKind;
  text: string; // 음성 문구
  comboId?: string;
  stepId?: string;
  punches?: PunchCode[];
  label: string; // 화면 표시용 큰 글씨
  sub: string; // 화면 표시용 보조 글씨
  minSec: number; // 이 명령 이후 최소 확보 시간
  long: boolean;
  rateMul: number;
}

export type Phase = 'idle' | 'prep' | 'work' | 'rest' | 'done';

export interface Segment {
  phase: 'prep' | 'work' | 'rest';
  round: number; // 1부터. prep/rest는 다음 라운드 번호
  start: number; // ms (활성 시간 기준)
  end: number;
}

export interface WorkoutRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  mode: TrainingMode | 'repeat';
  difficulty: Difficulty;
  roundsPlanned: number;
  roundsCompleted: number;
  workMs: number;
  restMs: number;
  totalMs: number;
  comboCount: number;
  footworkCount: number;
  calledPunches: number;
  audioMode: EngineAudio;
  completed: boolean;
}

export interface Preset {
  id: string;
  name: string;
  values: Partial<Settings>;
}
