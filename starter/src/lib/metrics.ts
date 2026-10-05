type Observation = { count: number; totalMs: number; maxMs: number };
const observations: Record<string, Observation> = {};

export function observe(name: string, durationMs: number): void {
  const item = observations[name] ??= { count: 0, totalMs: 0, maxMs: 0 };
  item.count += 1;
  item.totalMs += durationMs;
  item.maxMs = Math.max(item.maxMs, durationMs);
}

// In-process diagnostics; request percentiles are measured by the load driver.
// Never store query text, bind values, credentials or unbounded metric labels.
export function metricsSnapshot(): Record<string, Observation> {
  return JSON.parse(JSON.stringify(observations)) as Record<string, Observation>;
}
