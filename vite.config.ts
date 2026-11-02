import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dataDir } from './server/dataDir.ts'

// Dev only: the server injects the token into index.html in production.
const devToken = (): Plugin => ({
  name: 'slingsh0t-dev-token',
  apply: 'serve',
  transformIndexHtml() {
    try {
      const token = readFileSync(join(dataDir(), 'install-token'), 'utf8').trim()
      return [{ tag: 'meta', attrs: { name: 'slingsh0t-token', content: token }, injectTo: 'head' }]
    } catch {
      return []
    }
  },
})

export default defineConfig({
  root: 'web',
  plugins: [react(), devToken()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: false } },
    cors: false,
    // Patterns with a slash match absolute paths, so the data dir is spelled out in full.
    fs: { deny: ['.env', '.env.*', '**/.git/**', `${resolve(dataDir()).replaceAll('\\', '/')}/**`, '*.{crt,pem}'] },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    // Editor (CodeMirror, Lezer) and other libraries in their own cacheable chunks; each stays under the 500 kB warning.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'lezer', test: /\/node_modules\/@lezer\// },
            { name: 'codemirror', test: /\/node_modules\/(@codemirror\/|codemirror\/|style-mod\/|w3c-keyname\/|crelt\/)/ },
            { name: 'vendor', test: /\/node_modules\// },
          ],
        },
      },
    },
  },
})
