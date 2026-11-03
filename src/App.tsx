import { useEffect } from 'react';
import { engine, recorder, useLab } from './state/store';
import { NotesDialog } from './ui/common/NotesDialog';
import { Toast } from './ui/common/Toast';
import { Header } from './ui/layout/Header';
import { Sidebar } from './ui/layout/Sidebar';
import { StageView } from './ui/stage/StageView';

const TYPING_ELEMENTS = ['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'];

export function App() {
  useEffect(() => {
    function togglePause(event: KeyboardEvent) {
      const { notesOpen, paused, setPaused } = useLab.getState();
      const focused = document.activeElement?.tagName ?? '';
      if (event.code === 'Space' && !TYPING_ELEMENTS.includes(focused) && !notesOpen) {
        event.preventDefault();
        setPaused(!paused);
      }
    }
    function leavePage() {
      engine.camera.stop(false);
      recorder.shutdown();
    }
    function hidePage() {
      if (document.hidden && useLab.getState().cameraActivity !== 'off') engine.camera.stop();
    }
    document.addEventListener('keydown', togglePause);
    document.addEventListener('visibilitychange', hidePage);
    window.addEventListener('pagehide', leavePage);
    return () => {
      document.removeEventListener('keydown', togglePause);
      document.removeEventListener('visibilitychange', hidePage);
      window.removeEventListener('pagehide', leavePage);
    };
  }, []);

  return (
    <>
      <Header />
      <div className="flex h-[calc(100dvh-var(--header-height))] phone:flex-col">
        <Sidebar />
        <StageView />
      </div>
      <NotesDialog />
      <Toast />
    </>
  );
}
