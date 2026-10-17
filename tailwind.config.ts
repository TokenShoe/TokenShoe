import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        canvas: '#F7F6F3',
        surface: '#FFFFFF',
        border: '#EAEAEA',
        ink: '#111111',
        muted: '#787774',
        accent: {
          DEFAULT: '#1A1A2E',
          hover: '#2D2D4E',
        },
        green: { DEFAULT: '#22C55E', light: '#DCFCE7', text: '#15803D' },
        red: { DEFAULT: '#EF4444', light: '#FEE2E2', text: '#B91C1C' },
        blue: { DEFAULT: '#3B82F6', light: '#EFF6FF', text: '#1D4ED8' },
        yellow: { light: '#FBF3DB', text: '#956400' },
      },
      borderRadius: {
        card: '12px',
        btn: '6px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)',
        hover: '0 2px 8px rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
}

export default config
