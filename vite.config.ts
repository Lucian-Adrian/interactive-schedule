import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'interactive-schedule'
const ghPagesBase = `/${repoName}/`

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? (process.env.GITHUB_ACTIONS === 'true' ? ghPagesBase : '/'),
  envPrefix: ['VITE_', 'PUBLIC_'],
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
  },
})
