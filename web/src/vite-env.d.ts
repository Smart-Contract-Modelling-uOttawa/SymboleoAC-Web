/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LSP_URL?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.symboleo?raw' {
  const src: string;
  export default src;
}
