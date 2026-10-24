import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serves three's Draco decoder from /static/draco/ (dev) and emits it into the
 * build, so GLB decoding never depends on a third-party CDN and never sits
 * under the signed /assets/ path.
 */
function dracoDecoder(): Plugin {
  const require = createRequire(import.meta.url);
  const dir = join(dirname(require.resolve('three/package.json')), 'examples/jsm/libs/draco/gltf');
  const files = readdirSync(dir).filter(f => /^draco_(decoder\.(js|wasm)|wasm_wrapper\.js)$/.test(f));
  return {
    name: 'saunaklar-draco',
    configureServer(server) {
      server.middlewares.use('/static/draco', (req, res, next) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0] ?? '';
        if (!files.includes(name)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.end(readFileSync(join(dir, name)));
      });
    },
    generateBundle() {
      for (const f of files) this.emitFile({ type: 'asset', fileName: `static/draco/${f}`, source: readFileSync(join(dir, f)) });
    },
  };
}

const API = 'http://127.0.0.1:8787';
// changeOrigin false: the API resolves the tenant from the Host header, so the
// proxy must forward `alpha-spa.localhost:5173` untouched.
const proxied = ['/api', '/assets', '/media', '/branding', '/favicon.ico', '/dev'];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const mock = env.VITE_MOCK_API === '1';
  return {
    plugins: [react(), dracoDecoder()],
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
