import { useEffect, useState } from 'react';
import { Dumbbell, Home as HomeIcon, ListOrdered, Settings as SettingsIcon } from 'lucide-react';
import { useStore } from './stores/store';
import { engine, engineStore } from './services/WorkoutEngine';
import { onboardStore, settingsStore } from './services/SettingsManager';
import { Home } from './pages/Home';
import { Train } from './pages/Train';
import { Library } from './pages/Library';
import { Settings } from './pages/Settings';
import { Workout } from './pages/Workout';
import { Button, Sheet, cx } from './components/ui';

type Tab = 'home' | 'train' | 'library' | 'settings';

const TABS: { id: Tab; label: string; Icon: typeof HomeIcon }[] = [
  { id: 'home', label: '홈', Icon: HomeIcon },
  { id: 'train', label: '훈련', Icon: Dumbbell },
  { id: 'library', label: '콤비네이션', Icon: ListOrdered },
  { id: 'settings', label: '설정', Icon: SettingsIcon },
];

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur" style={{ paddingBottom: 'var(--sab)' }}>
      <div className="mx-auto flex max-w-[520px]" style={{ height: 'var(--nav-h)' }}>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={cx('press flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold', tab === id ? 'text-fg' : 'text-mute')}
          >
            <Icon size={23} strokeWidth={tab === id ? 2.4 : 1.8} />
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function SafetySheet({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="시작하기 전에">
      <ul className="mb-5 space-y-3 text-[15px] leading-relaxed">
        <li>글러브와 핸드랩을 착용하세요.</li>
        <li>샌드백 주변에 팔과 발을 움직일 공간을 충분히 확보하세요.</li>
        <li>속도와 강도는 몸 상태에 맞게 조절하고, 통증이 생기면 바로 멈추세요. 종료 버튼은 항상 화면 아래에 있습니다.</li>
        <li>복싱이 처음이라면 코치에게 기본 자세를 먼저 배우는 것을 권장합니다.</li>
      </ul>
      <Button className="mb-4 w-full" onClick={onConfirm}>
        확인하고 시작
      </Button>
    </Sheet>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const eng = useStore(engineStore);
  const s = useStore(settingsStore);
  const onboard = useStore(onboardStore);
  const [safety, setSafety] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.tone = s.tone;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', s.tone === 'black' ? '#000000' : '#080A0D');
  }, [s.tone]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  const inWorkout = eng.status !== 'idle';

  const requestStart = () => {
    if (!onboard.safetySeen) {
      setSafety(true);
      return;
    }
    engine.start();
  };

  return (
    <div className="mx-auto min-h-full max-w-[520px]">
      {!inWorkout && (
        <>
          {tab === 'home' && <Home goTrain={() => setTab('train')} requestStart={requestStart} />}
          {tab === 'train' && <Train />}
          {tab === 'library' && <Library />}
          {tab === 'settings' && <Settings goTrain={() => setTab('train')} />}
          <BottomNav tab={tab} setTab={setTab} />
        </>
      )}
      {inWorkout && <Workout />}
      <SafetySheet
        open={safety}
        onClose={() => setSafety(false)}
        onConfirm={() => {
          onboardStore.set((o) => ({ ...o, safetySeen: true }));
          setSafety(false);
          engine.start(); // 터치 이벤트 안에서 바로 시작 → iOS 음성 잠금 해제
        }}
      />
    </div>
  );
}
