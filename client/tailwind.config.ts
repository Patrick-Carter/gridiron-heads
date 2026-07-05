import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Early-2000s Flash palette — kept as Tailwind colors so existing
        // component classes (e.g. `bg-panel`, `text-accent`) can fall back
        // to the old look during the migration, but new components use the
        // dedicated `.panel-flash` / `.btn-flash` utility classes.
        bg: '#1d0a3d',       // page backdrop
        fg: '#fff8dc',       // primary text (cream)
        panel: '#fff8dc',    // cream panel (was dark)
        border: '#0a0a18',   // heavy ink outline
        accent: '#ffd400',   // highlighter yellow (was blue)
        err: '#c8102e',      // maroon (was red)
        ok: '#c8ff00',       // hi-vis green (was green)
        warn: '#ff8b00',     // orange alert
        // Extra direct names
        sky: '#00bfff',
        lime: '#c8ff00',
        sun: '#ffd400',
        maroon: '#c8102e',
        grape: '#5b2a86',
        grape2: '#7e3fb1',
        cream: '#fff8dc',
        ink: '#0a0a18',
        board: '#1d0a3d',
      },
      fontFamily: {
        flash: ['"Comic Sans MS"', '"Comic Sans"', '"Chalkboard SE"', '"Marker Felt"', 'system-ui', 'sans-serif'],
        chunk: ['"Trebuchet MS"', '"Arial Black"', 'system-ui', 'sans-serif'],
        pixel: ['"Press Start 2P"', '"Lucida Console"', 'monospace'],
      },
      boxShadow: {
        chunk: '4px 4px 0 0 #0a0a18',
        chunkSm: '3px 3px 0 0 #0a0a18',
        chunkLg: '6px 6px 0 0 #0a0a18',
      },
      keyframes: {
        starBlink: {
          '0%, 100%': { opacity: '0.85' },
          '50%': { opacity: '0.25' },
        },
        wobble: {
          '0%, 100%': { transform: 'rotate(-2deg)' },
          '50%': { transform: 'rotate(2deg)' },
        },
        shout: {
          '0%': { transform: 'scale(0.85) rotate(-4deg)' },
          '60%': { transform: 'scale(1.15) rotate(2deg)' },
          '100%': { transform: 'scale(1) rotate(-2deg)' },
        },
      },
      animation: {
        'star-blink': 'starBlink 2.5s ease-in-out infinite',
        wobble: 'wobble 1.8s ease-in-out infinite',
        shout: 'shout 0.6s ease-out 1',
      },
    },
  },
  plugins: [],
};

export default config;
