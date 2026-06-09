// Open/save SymboleoAC files from disk. Uses the File System Access API
// (Chrome/Edge) for true open-and-save-in-place; falls back to a hidden
// <input type=file> for open and a download for save on browsers without it
// (Firefox/Safari).

export type OpenedFile = {
  name: string;
  text: string;
  // Present only when opened via the File System Access API; lets Save write
  // back to the same file without a second picker.
  handle?: FileSystemFileHandle;
};

const SYMBOLEO_TYPES = [{
  description: 'SymboleoAC contract',
  accept: { 'text/plain': ['.symboleo'] as string[] },
}];

const hasFsAccess = (): boolean =>
  typeof (window as any).showOpenFilePicker === 'function';

export async function openFile(): Promise<OpenedFile | null> {
  if (hasFsAccess()) {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: SYMBOLEO_TYPES,
        multiple: false,
      });
      const file = await handle.getFile();
      return { name: file.name, text: await file.text(), handle };
    } catch (e) {
      // AbortError = user cancelled the picker.
      if ((e as DOMException)?.name === 'AbortError') return null;
      throw e;
    }
  }
  // Fallback: hidden file input.
  return new Promise<OpenedFile | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.symboleo';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      resolve({ name: file.name, text: await file.text() });
    };
    // If the dialog is dismissed there's no reliable event; that just leaves
    // the promise pending, which is harmless (no state change).
    input.click();
  });
}

export type SaveResult = { handle: FileSystemFileHandle | null; name: string };

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Save an arbitrary blob (e.g. an exported SVG diagram or a CSV) to disk.
 * Uses the FS Access picker when available; otherwise triggers a download.
 * `accept` is a {mime: [".ext"]} map for the picker's type filter.
 */
export async function saveBlobAs(
  name: string,
  blob: Blob,
  accept: Record<string, string[]>,
): Promise<boolean> {
  if (hasFsAccess()) {
    try {
      const h: FileSystemFileHandle = await (window as any).showSaveFilePicker({
        suggestedName: name,
        types: [{ accept }],
      });
      const writable = await (h as any).createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return false;
      throw e;
    }
  }
  downloadBlob(name, blob);
  return true;
}

/**
 * Save `text` to `handle` in place when given (file opened via FS Access API);
 * otherwise behaves like Save As. Returns the handle/name actually used.
 */
export async function saveFile(
  name: string,
  text: string,
  handle?: FileSystemFileHandle,
): Promise<SaveResult | null> {
  if (handle && hasFsAccess()) {
    try {
      const writable = await (handle as any).createWritable();
      await writable.write(text);
      await writable.close();
      return { handle, name: handle.name };
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      throw e;
    }
  }
  return saveFileAs(name, text);
}

/**
 * Always prompt for a destination (FS Access picker, or a browser download as
 * fallback). Returns the new handle/name, or null if the user cancelled.
 */
export async function saveFileAs(name: string, text: string): Promise<SaveResult | null> {
  if (hasFsAccess()) {
    try {
      const h: FileSystemFileHandle = await (window as any).showSaveFilePicker({
        suggestedName: name,
        types: SYMBOLEO_TYPES,
      });
      const writable = await (h as any).createWritable();
      await writable.write(text);
      await writable.close();
      return { handle: h, name: h.name };
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      throw e;
    }
  }
  download(name, text);
  return { handle: null, name };
}
