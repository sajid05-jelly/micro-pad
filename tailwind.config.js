/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          main: '#05080f',
          secondary: '#0B0F19',
          card: '#101524',
          elevated: '#161C30',
          hover: '#1B223B',
          active: '#222B48',
        },
        border: {
          subtle: '#161C30',
          DEFAULT: '#202024',
          card: '#202024',
          hover: '#2E2E36',
          accent: '#3478F6',
          focus: '#3478F6',
        },
        text: {
          primary: '#F5F5F5',
          secondary: '#A1A1AA',
          muted: '#686873',
          inverse: '#05080f',
          accent: '#3478F6',
        },
        accent: {
          blue: '#3478F6',
          'blue-hover': '#2563EB',
          'blue-light': '#60A5FA',
          'blue-subtle': 'rgba(52, 120, 246, 0.12)',
        },
        ambient: {
          cyan: '#0ea5e9',
          blue: '#216ccf',
          violet: '#4b2d7a',
        },
      },
      fontFamily: {
        heading: ['Inter', '"Space Grotesk"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'inset-sm': 'inset 0 1px 2px rgba(0, 0, 0, 0.8)',
        'card': '0 4px 20px rgba(0, 0, 0, 0.5)',
        'blue-glow': '0 0 25px rgba(52, 120, 246, 0.35)',
        'live-glow': '0 0 45px rgba(14, 165, 233, 0.4)',
      },
      animation: {
        'pulse-subtle': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
