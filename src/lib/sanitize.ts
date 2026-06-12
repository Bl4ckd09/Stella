/** Bound untrusted input so it can't inflate LLM prompt (and token cost). */
export function clampStr(v: unknown, max: number): string {
  return String(v ?? "").slice(0, max);
}

export function clampArr<T>(v: unknown, maxItems: number): T[] {
  return Array.isArray(v) ? (v.slice(0, maxItems) as T[]) : [];
}
