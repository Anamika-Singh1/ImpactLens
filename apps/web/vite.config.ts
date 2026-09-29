import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_API_BASE_URL;
  if (
    !base ||
    !(
      (base.startsWith('/') && !base.startsWith('//')) ||
      /^https?:\/\//.test(base)
    )
  )
    throw new Error(
      'Invalid environment configuration: VITE_API_BASE_URL must be an API path or HTTP(S) URL',
    );
  const target = env.API_PROXY_TARGET;
  if (!target || !/^https?:\/\//.test(target))
    throw new Error(
      'Invalid environment configuration: API_PROXY_TARGET must be an HTTP(S) URL',
    );
  return {
    plugins: [react(), tailwindcss()],
    optimizeDeps: { include: ['@impactlens/shared'] },
    build: {
      commonjsOptions: {
        include: [/node_modules/, /packages[\\/]shared[\\/]dist/],
      },
    },
    server: { port: 5173, strictPort: true, proxy: { '/api': { target } } },
  };
});
