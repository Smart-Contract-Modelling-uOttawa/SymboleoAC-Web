import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Some @codingame/monaco-vscode-* service-override packages contain imports like
//   import ... from '@codingame/monaco-vscode-api/vscode/vs/base/browser/cssValue';
// Per @codingame/monaco-vscode-api's package.json exports map, "./vscode/*" should
// resolve to "./vscode/src/*.js". esbuild handles this glob correctly in dev, but
// Rollup's package-exports resolver in `vite build` does not, so we patch it here.
// Without this plugin, `npm run build` fails with "Rollup failed to resolve import".
const codingameSubpathResolver = (): Plugin => {
  const PREFIX = '@codingame/monaco-vscode-api/vscode/';
  const BASE = pathResolve(HERE, 'node_modules/@codingame/monaco-vscode-api/vscode/src');
  return {
    name: 'codingame-monaco-vscode-api-subpath',
    enforce: 'pre',
    resolveId(id) {
      if (!id.startsWith(PREFIX)) return null;
      const rest = id.slice(PREFIX.length);
      // The exports map's "./vscode/*" globs to "./vscode/src/*.js" — and a tiny
      // number of imports already include ".js". Try both shapes.
      const candidates = rest.endsWith('.js') ? [rest] : [`${rest}.js`, rest];
      for (const c of candidates) {
        const full = pathResolve(BASE, c);
        if (existsSync(full)) return full;
      }
      return null;
    },
  };
};

// `base` defaults to '/', but when serving from a Pages subpath
// (https://user.github.io/repo/), the workflow sets VITE_BASE_PATH=/repo/.
const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react(), codingameSubpathResolver()],
  // monaco-editor-wrapper and @codingame/monaco-vscode-api ship .css that vite needs to handle.
  // Defaults are fine; this block exists so future contributors see the intent.
  server: {
    port: 5173,
  },
  optimizeDeps: {
    // Pre-bundling monaco's many submodules speeds up cold dev start.
    include: ['monaco-editor'],
  },
  worker: {
    format: 'es',
  },
});
