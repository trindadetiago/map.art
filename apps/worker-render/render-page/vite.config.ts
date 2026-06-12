import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Used in middleware mode by apps/worker-render/worker.ts. Server config is
// irrelevant in that mode (the parent http server provides the port).
export default defineConfig({
  plugins: [react()],
});
