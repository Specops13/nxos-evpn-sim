import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

const productionCsp = [
  "default-src 'self'",
  "connect-src 'self' https://api.github.com",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    {
      name: 'production-csp',
      transformIndexHtml: {
        order: 'pre',
        handler(_html, ctx) {
          if (ctx.server) return [];
          return [{
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: productionCsp },
            injectTo: 'head',
          }];
        },
      },
    },
  ],
  server: { port: 1420, strictPort: true },
  preview: { port: 1420, strictPort: true },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
