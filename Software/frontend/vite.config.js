import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In sviluppo (npm run dev, porta 5173) le chiamate al server vanno al backend sulla 3001.
// In produzione il backend serve direttamente la cartella dist/ (npm run build).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
    fs: { allow: ['..'] },   // il frontend importa engine/npy.js, engine/geo.js, engine/grid.js
  },
});
