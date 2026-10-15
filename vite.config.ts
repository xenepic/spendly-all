/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 本番ビルドでは外部への通信を CSP で遮断する（取引データを外部送信しないため）
const csp = (): Plugin => ({
  name: 'spendly-all-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
      },
      injectTo: 'head-prepend',
    },
  ],
})

export default defineConfig({
  plugins: [react(), tailwindcss(), csp()],
  // PayPay版（Spendly、5173）と同時に起動できるようポートを分ける
  server: { port: 5174 },
  preview: { port: 4174 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
