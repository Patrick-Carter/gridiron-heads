import { Link } from 'react-router-dom';
import FlashHeader from '../components/FlashHeader.js';

export default function Home() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-4 md:p-8 relative">
      <FlashHeader title="BROWSER BOWL!" kicker="Beta v1" star="⭐" />

      <div className="panel-flash max-w-md w-full mt-2 space-y-4">
        <div className="panel-titlebar">
          <span>The Football Showdown</span>
          <span className="text-xs">2-Player</span>
        </div>

        <p className="text-base md:text-lg leading-snug">
          Draft <span className="font-bold">6 position groups</span>, pick
          plays <em>simultaneously</em>, then <strong>AUDIBLE</strong> at the
          line. First to <span className="chip">3</span> with a
          {' '}<span className="chip">2-point lead</span> wins!
        </p>

        <ul className="text-sm space-y-1 pl-1">
          <li>🏈 Run, Pass, Punt, or FG every down</li>
          <li>🔁 Sub-calls flip on the audibles</li>
          <li>🌟 FG = <strong>0.5</strong> pts · TD = <strong>1</strong> pt</li>
          <li>🤖 New: solo play vs the <strong>CPU Bot</strong></li>
        </ul>

        <div className="space-y-3 pt-2">
          <Link
            to="/create"
            className="btn-flash btn-xtra btn-primary w-full text-center"
          >
            Create Game →
          </Link>
          <Link
            to="/join"
            className="btn-flash btn-xtra btn-cool w-full text-center"
          >
            Join Game →
          </Link>
          <Link
            to="/lobby"
            className="btn-flash btn-xtra btn-go w-full text-center"
          >
            📡 Public Lobby
          </Link>
          <Link
            to="/tutorial"
            className="btn-flash btn-grape w-full text-center"
          >
            📖 How to Play
          </Link>
        </div>

        <div className="text-center text-xs text-ink/70 pt-1">
          <span className="sticker">FREE!</span>
          <span className="ml-2">No download — play in your browser</span>
        </div>
      </div>

      <footer className="mt-8 text-xs text-cream/70 text-center">
        Browser Bowl · an over-9000-Clifford football simulator
      </footer>
    </div>
  );
}