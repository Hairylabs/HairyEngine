// PerfMonitor — tracks frame time + memory + error/crash counts and exposes
// a rolling summary the Perf tab can read. Slow frames (dt > SLOW_MS) are
// logged as warnings; very slow frames (dt > STALL_MS) are logged as errors
// with the current scene size as context so the user can find what choked.

const SLOW_MS = 50;   // < 20 fps
const STALL_MS = 200; // < 5 fps — almost certainly a hitch
const SAMPLE_WINDOW = 300; // last 5 seconds at 60fps

type Sample = { t: number; dt: number };

export type PerfSnapshot = {
  fpsAvg: number;
  fpsMin: number;
  frameMsAvg: number;
  frameMsP95: number;
  slowFrameCount: number;
  stallCount: number;
  errorCount: number;
  uptimeMs: number;
  jsHeapMb?: number;
};

class PerfMonitorImpl {
  private samples: Sample[] = [];
  private slowFrameCount = 0;
  private stallCount = 0;
  private errorCount = 0;
  private startedAt = performance.now();
  private installed = false;

  install() {
    if (this.installed) return;
    this.installed = true;
    window.addEventListener('error', () => {
      this.errorCount++;
    });
    window.addEventListener('unhandledrejection', () => {
      this.errorCount++;
    });
  }

  recordFrame(dtSeconds: number) {
    const dtMs = dtSeconds * 1000;
    const now = performance.now();
    this.samples.push({ t: now, dt: dtMs });
    if (this.samples.length > SAMPLE_WINDOW) this.samples.shift();
    if (dtMs > STALL_MS) {
      this.stallCount++;
      // eslint-disable-next-line no-console
      console.error(`[Perf] stall — frame took ${dtMs.toFixed(0)}ms (${(1000 / dtMs).toFixed(1)} fps). Scene may be too heavy or a script is blocking.`);
    } else if (dtMs > SLOW_MS) {
      this.slowFrameCount++;
      // Only spam the log every ~30 slow frames so a slow scene doesn't flood.
      if (this.slowFrameCount % 30 === 1) {
        // eslint-disable-next-line no-console
        console.warn(`[Perf] slow frame — ${dtMs.toFixed(0)}ms (${(1000 / dtMs).toFixed(1)} fps). Consider fewer dynamic lights / lower poly count / wireframe off.`);
      }
    }
  }

  snapshot(): PerfSnapshot {
    if (this.samples.length === 0) {
      return {
        fpsAvg: 0, fpsMin: 0, frameMsAvg: 0, frameMsP95: 0,
        slowFrameCount: 0, stallCount: 0, errorCount: this.errorCount,
        uptimeMs: performance.now() - this.startedAt,
      };
    }
    let sumMs = 0;
    let maxMs = 0;
    const sorted: number[] = [];
    for (const s of this.samples) {
      sumMs += s.dt;
      if (s.dt > maxMs) maxMs = s.dt;
      sorted.push(s.dt);
    }
    sorted.sort((a, b) => a - b);
    const avgMs = sumMs / this.samples.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? maxMs;
    const fpsAvg = 1000 / avgMs;
    const fpsMin = 1000 / maxMs;
    // jsHeapSize is a non-standard Chromium API.
    type PerfMem = { usedJSHeapSize?: number };
    const mem = (performance as unknown as { memory?: PerfMem }).memory;
    const jsHeapMb = mem?.usedJSHeapSize ? mem.usedJSHeapSize / 1024 / 1024 : undefined;
    return {
      fpsAvg,
      fpsMin,
      frameMsAvg: avgMs,
      frameMsP95: p95,
      slowFrameCount: this.slowFrameCount,
      stallCount: this.stallCount,
      errorCount: this.errorCount,
      uptimeMs: performance.now() - this.startedAt,
      jsHeapMb,
    };
  }

  reset() {
    this.samples = [];
    this.slowFrameCount = 0;
    this.stallCount = 0;
    this.errorCount = 0;
    this.startedAt = performance.now();
  }
}

export const perf = new PerfMonitorImpl();
