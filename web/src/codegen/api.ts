import { API_BASE } from '../config.js';

export type Issue = {
  severity: 'ERROR' | 'WARNING' | 'INFO' | 'IGNORE' | string;
  line: number | null;
  column: number | null;
  offset: number | null;
  length: number | null;
  message: string;
  code: string | null;
};

export type GenerateResult = {
  files: Record<string, string>;
  issues: Issue[];
  summary: { errors: number; warnings: number; generatedFiles: number };
};

export type GenerateResponse =
  | { ok: true; status: number; data: GenerateResult }
  | { ok: false; status: number; error: string; data?: Partial<GenerateResult> };

export async function generate(source: string): Promise<GenerateResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ source }),
    });
  } catch (e) {
    return { ok: false, status: 0, error: `network: ${(e as Error).message}` };
  }
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, error: `non-JSON response: ${text.slice(0, 200)}` };
  }
  // 200 = generated; 422 = validation errors (parsed.files empty); both still
  // give a usable shape with `issues`.
  if (res.status === 200) {
    return { ok: true, status: 200, data: parsed as GenerateResult };
  }
  if (res.status === 422) {
    return { ok: false, status: 422, error: 'validation errors prevented code generation', data: parsed as GenerateResult };
  }
  return { ok: false, status: res.status, error: parsed.error ?? `HTTP ${res.status}` };
}
