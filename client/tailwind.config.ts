import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0d1117',
        fg: '#e6edf3',
        panel: '#161b22',
        border: '#30363d',
        accent: '#58a6ff',
        err: '#f85149',
        ok: '#3fb950',
        warn: '#d29922',
      },
    },
  },
  plugins: [],
};

export default config;