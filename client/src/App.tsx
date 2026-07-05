import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './screens/Home.js';
import Tutorial from './screens/Tutorial.js';
import Create from './screens/Create.js';
import Join from './screens/Join.js';
import SessionRouter from './screens/SessionRouter.js';
import { initAudio, playUiClick, playUiHover } from './audio/synth.js';

export default function App() {
  // Global UI click + hover sounds. Any element matching the .btn-flash /
  // .btn-primary / .btn-go / .btn-danger / .btn-cool / .btn-grape / .btn-ghost
  // classes gets the soft click. data-sfx="hover" gets the hover tick.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('.btn-flash, .btn-primary, .btn-go, .btn-danger, .btn-cool, .btn-grape, .btn-ghost, [data-sfx="click"]')) {
        initAudio();
        playUiClick();
      }
    }
    function onMouseOver(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('[data-sfx="hover"]')) {
        initAudio();
        playUiHover();
      }
    }
    document.addEventListener('click', onClick, true);
    document.addEventListener('mouseover', onMouseOver, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mouseover', onMouseOver, true);
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tutorial" element={<Tutorial />} />
        <Route path="/create" element={<Create />} />
        <Route path="/join" element={<Join />} />
        <Route path="/join/:sessionId" element={<Join />} />
        <Route path="/session/:id" element={<SessionRouter />} />
      </Routes>
    </BrowserRouter>
  );
}