import type { FootworkStep } from '../types';

/** 명세서 8장 기본 스텝 12개 */
export const FOOTWORK_STEPS: readonly FootworkStep[] = [
  { id: 'f01', label: '앞으로 한 걸음', speech: '앞으로!', linkPrefix: '앞으로', minSec: 2, basic: true },
  { id: 'f02', label: '뒤로 한 걸음', speech: '뒤로 빠져!', linkPrefix: '뒤로 빠져, 다시', minSec: 2, basic: true },
  { id: 'f03', label: '왼쪽 사이드스텝', speech: '왼쪽 사이드스텝!', linkPrefix: '왼쪽 스텝', minSec: 2, basic: true },
  { id: 'f04', label: '오른쪽 사이드스텝', speech: '오른쪽 스텝!', linkPrefix: '오른쪽 스텝', minSec: 2, basic: true },
  { id: 'f05', label: '왼쪽으로 이동', speech: '왼쪽으로!', linkPrefix: '왼쪽으로 이동', minSec: 3, basic: true },
  { id: 'f06', label: '오른쪽으로 이동', speech: '오른쪽으로 이동!', linkPrefix: '오른쪽으로 이동', minSec: 3, basic: true },
  { id: 'f07', label: '앞으로 갔다가 뒤로', speech: '앞으로, 뒤로!', minSec: 3, basic: false },
  { id: 'f08', label: '뒤로 갔다가 앞으로', speech: '뒤로, 다시 앞으로!', minSec: 3, basic: false },
  { id: 'f09', label: '왼쪽 피벗', speech: '왼쪽 피벗!', minSec: 2.5, basic: false },
  { id: 'f10', label: '오른쪽 피벗', speech: '오른쪽 피벗!', minSec: 2.5, basic: false },
  { id: 'f11', label: '가드 유지하며 이동', speech: '가드 올리고, 이동!', minSec: 4, basic: false },
  { id: 'f12', label: '가볍게 스텝 유지', speech: '스텝 계속!', minSec: 4, basic: true },
];

/** 짧은 코칭 큐 (선택 사항) */
export const COACH_CUES: readonly string[] = ['가드 올려!', '거리 유지!', '가드 유지!', '호흡!', '턱 당겨!'];
