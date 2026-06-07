/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#151719',
        fog: '#f4f5f0',
        steel: '#637381',
        moss: '#5f7355',
        coral: '#c85f4a',
        gold: '#c59b43',
        cyan: '#3d8c95',
      },
      boxShadow: {
        panel: '0 1px 3px rgba(21, 23, 25, 0.08)',
      },
    },
  },
  plugins: [],
}
