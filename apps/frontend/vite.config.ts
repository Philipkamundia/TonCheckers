import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Telegram Mini Apps are served inside an iframe — base must be '/'
  base: '/',
  build: {
    outDir: 'dist',
    // Keep chunks reasonable for mobile
    chunkSizeWarningLimit: 500,
  },
  server: {
    port: 5173,
    // Allow Telegram WebView to connect
    allowedHosts: ['*'],
  },
});
