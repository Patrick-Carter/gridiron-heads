import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './screens/Home.js';
import Create from './screens/Create.js';
import Join from './screens/Join.js';
import SessionRouter from './screens/SessionRouter.js';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<Create />} />
        <Route path="/join" element={<Join />} />
        <Route path="/join/:sessionId" element={<Join />} />
        <Route path="/session/:id" element={<SessionRouter />} />
      </Routes>
    </BrowserRouter>
  );
}