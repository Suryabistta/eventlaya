/** @type {import('tailwindcss').Config} */

// Laliguras (rhododendron) — primary brand
const brand = {
  50: '#FDF2F6',
  100: '#FCE7EF',
  200: '#F9CFDF',
  300: '#F4A6C3',
  400: '#EC6F9C',
  500: '#DE3F78',
  600: '#C2215A',
  700: '#A3184A',
  800: '#87173F',
  900: '#711838',
  950: '#42071C',
}

// Sayapatri (marigold) — highlights & warnings
const marigold = {
  50: '#FFF8E6',
  100: '#FEEFC3',
  200: '#FDDC85',
  300: '#FBC443',
  400: '#F5AB16',
  500: '#E39400',
  600: '#BF7300',
  700: '#985600',
  800: '#7A4507',
  900: '#66390B',
  950: '#3B1E02',
}

// Plum-tinted neutrals (ink & paper)
const ink = {
  50: '#FAF8FB',
  100: '#F3F0F5',
  200: '#E7E2EB',
  300: '#D3CCD9',
  400: '#7B7186',
  500: '#635A6E',
  600: '#4E4659',
  700: '#3D3547',
  800: '#2A2333',
  900: '#1C1724',
  950: '#110D17',
}

// White-label sites swap brand + marigold at runtime (src/lib/tenant.tsx), so they read CSS variables.
// Defaults live in src/index.css and match the hex values above.
const themed = (name, palette) =>
  Object.fromEntries(Object.keys(palette).map((k) => [k, `rgb(var(--${name}-${k}) / <alpha-value>)`]))
const brandVars = themed('brand', brand)
const marigoldVars = themed('marigold', marigold)

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: brandVars,
        marigold: marigoldVars,
        ink,
        // Legacy palettes mapped onto the brand system so older pages stay on-brand
        indigo: brandVars,
        violet: brandVars,
        purple: brandVars,
        amber: marigoldVars,
        slate: ink,
        gray: ink,
      },
      fontFamily: {
        sans: ['Poppins', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Bricolage Grotesque"', 'Poppins', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        '2xs': '0 1px 0 0 rgb(28 23 36 / 0.04)',
        xs: '0 1px 2px 0 rgb(28 23 36 / 0.06)',
        pop: '0 12px 32px -8px rgb(28 23 36 / 0.18), 0 2px 6px -2px rgb(28 23 36 / 0.08)',
      },
      backdropBlur: {
        xs: '2px',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Landing hero: pass arrives, scan line sweeps, stamp lands
        'pass-arrive': {
          from: { opacity: '0', transform: 'translateY(24px) rotate(-4deg)' },
          to: { opacity: '1', transform: 'translateY(0) rotate(-2deg)' },
        },
        'scan-sweep': {
          '0%': { top: '0%', opacity: '0' },
          '10%': { opacity: '1' },
          '90%': { opacity: '1' },
          '100%': { top: '100%', opacity: '0' },
        },
        'stamp-land': {
          '0%': { opacity: '0', transform: 'scale(1.8) rotate(-14deg)' },
          '60%': { opacity: '1', transform: 'scale(0.94) rotate(-9deg)' },
          '100%': { opacity: '1', transform: 'scale(1) rotate(-10deg)' },
        },
        'result-flash': {
          '0%': { transform: 'scale(0.96)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'pop-in': 'pop-in 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2)',
        'sheet-up': 'sheet-up 280ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-in-left': 'slide-in-left 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'toast-in': 'toast-in 200ms ease-out',
        'pass-arrive': 'pass-arrive 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'scan-sweep': 'scan-sweep 900ms ease-in-out 800ms both',
        'stamp-land': 'stamp-land 380ms cubic-bezier(0.3, 1.4, 0.5, 1) 1750ms both',
        'result-flash': 'result-flash 200ms ease-out',
      },
    },
  },
  plugins: [],
}
