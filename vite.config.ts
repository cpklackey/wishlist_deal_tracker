import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: [
          '**/*_cache.json',
          '**/gfn_catalog.json',
          '**/amazon_luna_catalog.json',
          '**/ps_plus_catalog.json',
          '**/deal_alerts_output.json',
          '**/deal_sync.log'
        ]
      },
      allowedHosts: true, // Allow ngrok and other external tunnels
    },
  };
});
