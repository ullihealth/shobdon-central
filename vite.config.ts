import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { frontmanPlugin } from '@frontman-ai/vite';

export default defineConfig({
  plugins: [
    frontmanPlugin({ host: 'api.frontman.sh' }),react()],
  build: {
    target: 'es2022'
  }
})
