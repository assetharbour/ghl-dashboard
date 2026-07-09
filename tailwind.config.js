/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          green: '#6DA544',
          navy: '#2E3A48',
          pink: '#E91E63',
          'green-light': '#94C973',
          'green-pale': '#C7DDB5',
          'blue-grey': '#5B7B94',
          'grey-blue': '#8896A6',
        },
        page: '#F7F9FB',
        card: '#FFFFFF',
        line: '#E5EAF0',
        ink: '#1F2937',
        muted: '#6B7280',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
