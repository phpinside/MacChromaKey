import { resolve } from 'path'
import { randomBytes } from 'node:crypto'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ command }) => {
  const nonce = randomBytes(16).toString('base64')
  return {
    main: {},
    preload: {},
    renderer: {
      ...(command === 'serve' && { html: { cspNonce: nonce } }),
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src')
        }
      },
      plugins: [
        react(),
        tailwindcss(),
        {
          name: 'dev-csp-nonce',
          apply: 'serve',
          transformIndexHtml: {
            order: 'pre',
            handler: (html) =>
              html
                .replace(
                  "connect-src 'self' localfile:",
                  "connect-src 'self' localfile: ws://localhost:* ws://127.0.0.1:*"
                )
                .replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`)
          }
        }
      ]
    }
  }
})
