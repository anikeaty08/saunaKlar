import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://127.0.0.1:8787';
// changeOrigin false: the API resolves the tenant from the Host header, so the
// proxy must forward `alpha-spa.localhost:5173` untouched.
const proxied = ['/api', '/assets', '/media', '/branding', '/favicon.ico', '/dev'];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const mock = env.VITE_MOCK_API === '1';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      strictPort: true,
      allowedHosts: ['.localhost'],
      // With the mock API the browser never talks to the backend.
      proxy: mock ? {} : Object.fromEntries(proxied.map(p => [p, { target: API, changeOrigin: false, ws: false }])),
    },
    preview: { port: 4173, host: true, allowedHosts: ['.localhost'] },
    build: {
      target: 'es2022',
      // /assets/* is the signed-cookie path for protected 3D files in CloudFront;
      // the app's own bundles must live elsewhere.
      assetsDir: 'static',
      sourcemap: true,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](three|three-stdlib|@react-three|three-mesh-bvh|troika-[^\\/]+|camera-controls|maath|meshline|stats-gl|@monogrid|detect-gpu|hls\.js)[\\/]/.test(id)) return 'three';
            if (/[\\/]node_modules[\\/](gsap|@gsap)[\\/]/.test(id)) return 'gsap';
            if (/[\\/]node_modules[\\/]@google[\\/]model-viewer[\\/]/.test(id)) return 'model-viewer';
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(id)) return 'react';
            if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return 'query';
            return undefined;
          },
        },
      },
    },
  };
});
