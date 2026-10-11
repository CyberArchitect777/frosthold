/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'ice-blue': '#a8d8ea',
        'frost': '#e8f4f8',
        'deep-navy': '#0a1628',
        'mid-navy': '#1e3a5f',
        'snow-white': '#f0f8ff',
        'danger': '#c0392b',
        'safe': '#27ae60',
      },
      fontFamily: {
        mono: ['Courier New', 'monospace'],
      }
    },
  },
  plugins: [],
}
