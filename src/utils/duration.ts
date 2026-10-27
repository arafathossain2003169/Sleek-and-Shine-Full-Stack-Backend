/** Parses simple durations like "30d", "12h", "15m", "45s" into milliseconds. */
export function parseDurationMs(input: string, fallbackMs: number): number {
  const match = /^(\d+)([smhd])$/.exec(input.trim());
  if (!match) return fallbackMs;
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return Number(match[1]) * multipliers[match[2]];
}
