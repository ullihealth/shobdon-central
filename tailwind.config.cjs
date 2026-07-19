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
      // Café Template's footer ticker (CafeTicker.tsx) scroll-speed
      // control (Phase 2) made the animation duration a runtime,
      // tenant-configurable value - moved to a plain, always-present
      // @keyframes rule in index.css instead of this theme.extend
      // block, since Tailwind's JIT only emits config-based keyframes
      // when a matching animate-* utility class is found in scanned
      // source, and no such static class exists anymore now that
      // duration is set via inline style. See index.css's own comment.
    }
  },
  plugins: []
}
