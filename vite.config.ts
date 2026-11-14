import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig(() => {
  return {
    envPrefix: ['VITE_API_URL'],
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
        '/uploads': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            pdf: ['pdf-lib'],
            vendor: ['react', 'react-dom'],
          },
        },
      },
    },
    test: {
      testTimeout: 20000,
      coverage: {
        provider: 'v8' as const,
        include: ['src/**/*.{ts,tsx}', 'server.ts'],
        exclude: ['src/**/*.test.*', 'src/**/__tests__/**'],
        reporter: ['text-summary', 'json-summary', 'lcov'],
        reportsDirectory: 'coverage',
        // Suelo anti-regresión sobre la cobertura medida el 2026-11-14; subir cuando aumente.
        thresholds: {
          lines: 33.5,
          statements: 32,
          functions: 25,
          branches: 28,
          'src/server/**/*.ts': {
            lines: 74,
            statements: 71.5,
            functions: 76,
            branches: 65.5,
          },
        },
      },
    },
  };
});
