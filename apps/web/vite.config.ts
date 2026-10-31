import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.BOOKVERSE_API_URL ?? 'http://localhost:4000';

// На Vercel у сервера нет постоянного процесса, поэтому сокеты там выключены.
if (process.env.VERCEL) process.env.VITE_REALTIME_URL ??= 'off';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/socket.io': { target: api, ws: true, changeOrigin: false },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/socket.io': { target: api, ws: true, changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules[\\/](three|@react-three)/.test(id)) return 'three';
          return undefined;
        },
      },
    },
  },
});
