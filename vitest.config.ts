import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['src/main/**/*.test.ts'],
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
