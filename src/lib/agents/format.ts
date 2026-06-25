/** Shared formatting — keep £ rendering identical to the engine/UI everywhere. */

/** £ with thousands separators, rounded — matches the engine's fmt0 + the UI. */
export function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

/** Deterministic id helper (no Math.random in core state transitions). */
export function seqId(prefix: string, n: number): string {
  return `${prefix}-${n}`;
}
