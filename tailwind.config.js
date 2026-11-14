/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans Variable', 'DM Sans', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        outfit: ['DM Sans Variable', 'DM Sans', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Cascadia Code', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        state: {
          urgency: '#f59e0b',
          'urgency-strong': '#b45309',
          'urgency-tint': 'rgba(245, 158, 11, 0.14)',
          'urgency-ink': '#1f2937',
          action: 'var(--brand-solid)',
          'action-soft': 'var(--brand-soft)',
        },
        cyber: {
          dark: '#050811',
          card: '#070c18',
        },
        yard: {
          bg: 'var(--yard-bg)',
          surface: 'var(--yard-surface)',
          raised: 'var(--yard-raised)',
          sunken: 'var(--yard-sunken)',
          line: 'var(--yard-line)',
          'line-strong': 'var(--yard-line-strong)',
          ink: 'var(--yard-ink)',
          'ink-soft': 'var(--yard-ink-soft)',
          muted: 'var(--yard-muted)',
          faint: 'var(--yard-faint)',
          accent: 'var(--yard-accent)',
          'accent-strong': 'var(--yard-accent-strong)',
          'accent-soft': 'var(--yard-accent-soft)',
          'accent-ink': 'var(--yard-accent-ink)',
          success: 'var(--yard-success)',
          'success-strong': 'var(--yard-success-strong)',
          'success-soft': 'var(--yard-success-soft)',
          danger: 'var(--yard-danger)',
          'danger-strong': 'var(--yard-danger-strong)',
          'danger-soft': 'var(--yard-danger-soft)',
          info: 'var(--yard-info)',
          'info-strong': 'var(--yard-info-strong)',
          'info-soft': 'var(--yard-info-soft)',
        },
      },
    },
  },
  plugins: [],
};
