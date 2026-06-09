// Share-by-URL: encode the current contract into the URL hash so a link
// reproduces it. Uses the browser's gzip CompressionStream when available
// (compact links) and falls back to raw UTF-8 base64url otherwise.
//
//   #c=<gzip+base64url>   compressed
//   #r=<base64url>        raw (fallback)

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof (globalThis as any).CompressionStream !== 'function') return null;
  const cs = new (globalThis as any).CompressionStream('gzip');
  const blob = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).blob();
  return new Uint8Array(await blob.arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new (globalThis as any).DecompressionStream('gzip');
  const blob = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).blob();
  return new Uint8Array(await blob.arrayBuffer());
}

/** Build a shareable URL (current origin+path) with the contract in the hash. */
export async function buildShareUrl(source: string): Promise<string> {
  const data = new TextEncoder().encode(source);
  const gz = await gzip(data);
  const hash = gz ? `c=${bytesToBase64Url(gz)}` : `r=${bytesToBase64Url(data)}`;
  const base = `${location.origin}${location.pathname}`;
  return `${base}#${hash}`;
}

/** If the current URL hash carries a shared contract, decode it (else null). */
export async function readSharedFromHash(): Promise<string | null> {
  const h = location.hash.replace(/^#/, '');
  if (!h) return null;
  try {
    if (h.startsWith('c=')) {
      return new TextDecoder().decode(await gunzip(base64UrlToBytes(h.slice(2))));
    }
    if (h.startsWith('r=')) {
      return new TextDecoder().decode(base64UrlToBytes(h.slice(2)));
    }
  } catch {
    return null;
  }
  return null;
}

/** Remove the shared payload from the URL bar without reloading. */
export function clearShareHash(): void {
  history.replaceState(null, '', `${location.origin}${location.pathname}${location.search}`);
}
