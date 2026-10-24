/**
 * 실제 경과 시간 기반 시계.
 * - performance.now()로 측정하고 일시정지 구간을 제외한다.
 * - 백그라운드에서 performance.now()가 멈추는 브라우저를 대비해 Date.now()와 비교해 보정한다.
 */
export class LiveClock {
  private accumulated = 0;
  private resumedPerf = 0;
  private resumedWall = 0;
  running = false;

  constructor(startMs = 0) {
    this.accumulated = startMs;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resumedPerf = performance.now();
    this.resumedWall = Date.now();
  }

  pause() {
    if (!this.running) return;
    this.accumulated = this.now();
    this.running = false;
  }

  now(): number {
    if (!this.running) return this.accumulated;
    const perf = performance.now() - this.resumedPerf;
    const wall = Date.now() - this.resumedWall;
    // 벽시계가 1초 이상 더 흘렀다면(기기 절전 등) 벽시계를 신뢰. 시스템 시간 변경(음수/과대)은 무시
    const elapsed = wall - perf > 1000 && wall - perf < 6 * 3600_000 ? wall : perf;
    return this.accumulated + elapsed;
  }

  set(ms: number) {
    const wasRunning = this.running;
    this.running = false;
    this.accumulated = ms;
    if (wasRunning) this.start();
  }
}
