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
      }
    }
  },
  plugins: []
}
