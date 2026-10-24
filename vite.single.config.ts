import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  publicDir: false,
  define: { 'import.meta.env.SINGLE_FILE': 'true' },
  build: { outDir: 'dist-single', emptyOutDir: true, rollupOptions: { input: 'index.single.html' } },
});
