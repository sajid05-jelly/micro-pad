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
          main: '#050505',
          secondary: '#0B0B0D',
          card: '#111114',
          elevated: '#16161A',
          hover: '#1C1C22',
          active: '#22222A',
        },
        border: {
          subtle: '#16161A',
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
          inverse: '#050505',
          accent: '#3478F6',
        },
        accent: {
          blue: '#3478F6',
          'blue-hover': '#2563EB',
          'blue-light': '#60A5FA',
          'blue-subtle': 'rgba(52, 120, 246, 0.12)',
        },
        ambient: {
          blue: '#092B59',
          teal: '#123B43',
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
        'blue-glow': '0 0 20px rgba(52, 120, 246, 0.3)',
        'ambient-glow': '0 0 40px rgba(9, 43, 89, 0.45)',
      },
      animation: {
        'pulse-subtle': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
