module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        'page-from': 'var(--color-page-from)',
        'page-via': 'var(--color-page-via)',
        'page-to': 'var(--color-page-to)',
        'header-from': 'var(--color-header-from)',
        'header-via': 'var(--color-header-via)',
        'header-to': 'var(--color-header-to)',
        panel: 'var(--color-panel-bg)',
        card: 'var(--color-card-bg)',
        border: { DEFAULT: 'var(--color-border)' },
        primary: 'var(--color-text-primary)',
        muted: {
          300: 'var(--color-text-muted-300)',
          400: 'var(--color-text-muted-400)',
          500: 'var(--color-text-muted-500)',
        },
        'accent-sky': {
          400: 'var(--color-accent-sky-400)',
          500: 'var(--color-accent-sky-500)',
        },
        'status-good': 'var(--color-status-good-text)',
        'status-warn': 'var(--color-status-warn-text)',
        'status-bad': 'var(--color-status-bad-text)',
        'compass-disc-bg': 'var(--color-compass-disc-bg)',
      },
      // Café Template's footer ticker (CafeTicker.tsx) - a continuous,
      // seamless loop, not the discrete dwell-per-slide pattern used
      // elsewhere in this codebase. Fixed default speed for this pass -
      // speed customization is a deliberate later follow-up, not missing
      // by accident. The component renders its content track twice
      // back-to-back and translates exactly -50%, so this animation
      // never needs to know the actual content width.
      keyframes: {
        'cafe-ticker': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'cafe-ticker': 'cafe-ticker 30s linear infinite',
      },
    }
  },
  plugins: []
}
