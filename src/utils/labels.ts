import type { AudioMix, Difficulty, EngineAudio, ReadStyle, TrainingMode, VoiceStyle, Weight } from '../types';

export const AUDIO_NAMES: Record<EngineAudio, string> = { live: '실시간 TTS', track: '연속 트랙', native: '앱 음성 엔진' };

export const AUDIO_MIX_NAMES: Record<AudioMix, string> = { mix: '음악과 함께', duck: '음악 줄이기', solo: '코치만' };
export const AUDIO_MIX_DESC: Record<AudioMix, string> = {
  mix: '다른 앱 음악을 그대로 두고 코치 음성을 겹쳐서 들려줍니다.',
  duck: '훈련하는 동안 다른 앱 음악 소리를 줄여 코치 음성이 잘 들리게 합니다.',
  solo: '다른 앱 음악을 멈추고, 잠금 화면에 재생·일시정지 버튼과 라운드 정보를 표시합니다.',
};

export const MODE_NAMES: Record<TrainingMode | 'repeat', string> = {
  combo: '콤비네이션',
  footwork: '풋워크',
  mix: '믹스',
  technique: '테크닉',
  custom: '커스텀',
  repeat: '반복 연습',
};

export const MODE_DESC: Record<TrainingMode, string> = {
  combo: '100개 콤비 중 난이도에 맞게 랜덤',
  footwork: '펀치 없이 스텝 지시만',
  mix: '콤비와 풋워크를 비율대로 섞어서',
  technique: '짧은 콤비와 기본 스텝, 넉넉한 간격',
  custom: '내가 고른 콤비만',
};

export const DIFF_NAMES: Record<Difficulty, string> = { beginner: '초급', intermediate: '중급', advanced: '고급' };

export const VOICE_STYLE_NAMES: Record<VoiceStyle, string> = { basic: '기본 코치', live: '실전 코치', number: '번호 코치' };
export const VOICE_STYLE_DESC: Record<VoiceStyle, string> = {
  basic: '차분하고 명확하게 — “원투, 왼훅.”',
  live: '짧고 힘 있게 — “원투! 왼훅! 투!”',
  number: '번호로 빠르게 — “원, 투, 쓰리, 투!”',
};

export const READ_STYLE_NAMES: Record<ReadStyle, string> = { coach: '코치', number: '번호', formal: '정식 명칭' };
export const READ_STYLE_DESC: Record<ReadStyle, string> = {
  coach: '1-2-3-2 → 원투, 왼훅, 투',
  number: '1-2-3-2 → 원, 투, 쓰리, 투',
  formal: '1-2-3-2 → 잽, 스트레이트, 왼손 훅, 스트레이트',
};

export const WEIGHT_NAMES: Record<Weight, string> = { normal: '일반', often: '자주', rare: '적게', excluded: '제외' };
