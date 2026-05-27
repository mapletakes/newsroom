/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Fraunces"', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        rust: 'rgb(var(--rust) / <alpha-value>)',
        ochre: 'rgb(var(--ochre) / <alpha-value>)',
        moss: 'rgb(var(--moss) / <alpha-value>)',
        slate: 'rgb(var(--slate) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
