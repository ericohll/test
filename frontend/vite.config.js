import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' so the built assets resolve correctly when served from any path
// under the CloudFront/S3 origin (index.html sits at the bucket root).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
