/** Timing-only diagnostics. Labels are code-defined, never request-derived.
 * No extra fetch, storage access or await is introduced by this observer. */
export type RouteTimingOperation = "capabilities" | "decide" | "route" | "result" | "other";
export type RouteTimingStage = "request" | "parse" | "validate_start" | "budget" | "policy" |
  "learning_schema" | "learning_rows" | "route" | "usage" | "persist" |
  "validate_result" | "result_lookup" | "result_snapshot" | "result_evaluate" |
  "retry_policy" | "retry_learning" | "retry_route" | "result_persist" |
  "learning_record" | "capabilities_probe";

type TimingRecord = { event: "private_route_latency"; operation: RouteTimingOperation;
  total_ms: number; stages: Partial<Record<RouteTimingStage, number>> };
const MAX_MS = 86_400_000;
const elapsed = (start: number, end: number) => Math.min(MAX_MS, Math.max(0, Math.round(end - start)));

export class RouteStageTiming {
  private readonly started: number;
  private previous: number;
  private name: RouteTimingStage = "request";
  private readonly durations: Partial<Record<RouteTimingStage, number>> = {};
  private finished?: TimingRecord;

  constructor(public operation: RouteTimingOperation, private readonly clock: () => number = Date.now) {
    this.started = this.previous = clock();
  }

  get current(): RouteTimingStage { return this.name; }
  set current(next: RouteTimingStage) {
    if (this.finished) return;
    const now = this.clock();
    this.record(now);
    this.name = next;
    this.previous = now;
  }

  private record(now: number): void {
    this.durations[this.name] = Math.min(MAX_MS, (this.durations[this.name] ?? 0) + elapsed(this.previous, now));
  }

  finish(): TimingRecord {
    if (!this.finished) {
      const now = this.clock();
      this.record(now);
      this.finished = { event: "private_route_latency", operation: this.operation,
        total_ms: elapsed(this.started, now), stages: { ...this.durations } };
    }
    return { ...this.finished, stages: { ...this.finished.stages } };
  }
}
