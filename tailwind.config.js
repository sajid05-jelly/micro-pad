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
          main: '#0C090B',
          secondary: '#171016',
          elevated: '#21131B',
          card: '#21131B',
          hover: '#2B111C',
          active: '#381625',
        },
        burgundy: {
          deep: '#2B111C',
          glow: '#4A1425',
          panel: '#21131B',
          subtle: '#1C0D16',
        },
        gold: {
          DEFAULT: '#D6B36A',
          light: '#E8C98D',
          dark: '#B08E44',
          muted: '#8A7347',
        },
        border: {
          subtle: '#1C0D16',
          DEFAULT: '#2B111C',
          focus: '#D6B36A',
          bright: '#E8C98D',
          gold: '#D6B36A',
          burgundy: '#4A1425',
        },
        text: {
          primary: '#F8F5F2',
          secondary: '#B9A7AA',
          muted: '#786B72',
          inverse: '#0C090B',
          gold: '#D6B36A',
        },
      },
      fontFamily: {
        heading: ['"Space Grotesk"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'inset-sm': 'inset 0 1px 2px rgba(0, 0, 0, 0.8)',
        'panel': '0 2px 4px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(214, 179, 106, 0.05)',
        'gold-glow': '0 0 15px rgba(214, 179, 106, 0.25)',
        'burgundy-glow': '0 0 30px rgba(74, 20, 37, 0.4)',
      },
      animation: {
        'pulse-subtle': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
