import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // For a custom domain or root hosting:
  base: './',   // or just '/' – './' also works if you ever host in a subfolder
});
