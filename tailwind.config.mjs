import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Indirected through custom properties (defaults in globals.css) so a
      // stream's chosen typefaces can override them at runtime from an
      // injected <style> — the families aren't known at build time.
      fontFamily: {
        display: 'var(--font-display)',
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
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
  plugins: [tailwindcssAnimate],
};
