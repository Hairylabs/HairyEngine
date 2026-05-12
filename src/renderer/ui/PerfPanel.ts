import { perf, PerfSnapshot } from '../engine/PerfMonitor';
import { Scene } from '../engine/Scene';

/** Probe GPU info via WEBGL_debug_renderer_info on a one-shot WebGL context.
 *  Returns "Unknown" if the extension is unavailable (some browsers / Linux
 *  drivers block it for fingerprinting reasons). */
function detectGPU(): { vendor: string; renderer: string } {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return { vendor: 'no WebGL', renderer: 'no WebGL' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return { vendor: 'unknown', renderer: 'unknown (driver blocked debug info)' };
    return {
      vendor: String(gl.getParameter((ext as { UNMASKED_VENDOR_WEBGL: number }).UNMASKED_VENDOR_WEBGL)),
      renderer: String(gl.getParameter((ext as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL)),
    };
  } catch {
    return { vendor: 'error', renderer: 'error' };
  }
}
const GPU_INFO = detectGPU();

// Performance tab in the bottom panel. Auto-refreshes every 500ms with the
// current PerfMonitor snapshot. Shows live FPS, frame time p95, slow-frame
// count, error count, scene mesh/triangle count, and JS heap usage.

export class PerfPanel {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private root: HTMLElement, private scene: Scene) {
    this.render(perf.snapshot());
    this.timer = setInterval(() => this.render(perf.snapshot()), 500);
  }

  dispose() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private render(s: PerfSnapshot) {
    const sceneStats = countScene(this.scene);
    const fmtMs = (ms: number) => ms < 1 ? '<1' : ms.toFixed(1);
    const heap = s.jsHeapMb ? `${s.jsHeapMb.toFixed(0)} MB` : '?';
    const uptimeS = (s.uptimeMs / 1000);
    const uptime = uptimeS < 60 ? `${uptimeS.toFixed(0)}s` : `${(uptimeS / 60).toFixed(1)}m`;

    const fpsClass = s.fpsAvg >= 50 ? '' : s.fpsAvg >= 25 ? 'warn' : 'error';
    const minFpsClass = s.fpsMin >= 30 ? '' : s.fpsMin >= 15 ? 'warn' : 'error';

    this.root.innerHTML = `
      <div class="perf-header">
        <div class="perf-counter">
          <span style="color: var(${fpsClass === 'error' ? '--accent' : fpsClass === 'warn' ? '--accent' : '--accent-2'});">${s.fpsAvg.toFixed(0)}</span>
          <span class="perf-counter-label">avg fps</span>
        </div>
        <div class="perf-counter">
          <span style="color: var(${minFpsClass === 'error' ? '--accent' : minFpsClass === 'warn' ? '--accent' : '--accent-2'});">${s.fpsMin.toFixed(0)}</span>
          <span class="perf-counter-label">min fps</span>
        </div>
        <div class="perf-counter">
          <span>${fmtMs(s.frameMsAvg)}ms</span>
          <span class="perf-counter-label">avg frame</span>
        </div>
        <div class="perf-counter">
          <span>${fmtMs(s.frameMsP95)}ms</span>
          <span class="perf-counter-label">p95 frame</span>
        </div>
        <div class="perf-counter">
          <span style="color: ${s.slowFrameCount > 50 ? '#ffd166' : 'var(--text)'};">${s.slowFrameCount}</span>
          <span class="perf-counter-label">slow frames</span>
        </div>
        <div class="perf-counter">
          <span style="color: ${s.stallCount > 0 ? '#ff7878' : 'var(--text)'};">${s.stallCount}</span>
          <span class="perf-counter-label">stalls</span>
        </div>
        <div class="perf-counter">
          <span style="color: ${s.errorCount > 0 ? '#ff7878' : 'var(--text)'};">${s.errorCount}</span>
          <span class="perf-counter-label">errors</span>
        </div>
        <div class="perf-counter" style="border: 0;">
          <span>${uptime}</span>
          <span class="perf-counter-label">uptime</span>
        </div>
      </div>
      <div style="padding: 10px 12px; font-size: 11px; font-family: ui-monospace, monospace; color: var(--muted);">
        Scene: ${sceneStats.objects} actors · ${sceneStats.meshes} meshes · ${sceneStats.triangles.toLocaleString()} triangles · ${sceneStats.lights} lights<br>
        GPU: <span style="color: var(--accent-2);">${escapeHtml(GPU_INFO.renderer)}</span> · vendor: ${escapeHtml(GPU_INFO.vendor)}<br>
        JS heap: ${heap}<br><br>
        <strong style="color: var(--text);">Warning thresholds:</strong>
        <br>· Slow frame: > 50 ms (< 20 fps) — logged once per 30 events
        <br>· Stall: > 200 ms (< 5 fps) — logged every time
        <br>· Errors include uncaught exceptions + unhandled promise rejections.
        <br><br>
        <button class="claude-btn" id="perf-reset">Reset counters</button>
        <button class="claude-btn" id="perf-log">Dump snapshot to console</button>
      </div>
    `;
    this.root.querySelector('#perf-reset')?.addEventListener('click', () => {
      perf.reset();
      this.render(perf.snapshot());
    });
    this.root.querySelector('#perf-log')?.addEventListener('click', () => {
      console.info('[Perf] snapshot:', perf.snapshot());
    });
  }
}

function countScene(scene: Scene): { objects: number; meshes: number; triangles: number; lights: number } {
  let objects = 0, meshes = 0, triangles = 0, lights = 0;
  scene.editable.traverse((o) => {
    objects++;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      meshes++;
      const idx = m.geometry.index;
      const pos = m.geometry.attributes.position;
      if (idx) triangles += idx.count / 3;
      else if (pos) triangles += pos.count / 3;
    }
    if ((o as THREE.Light).isLight) lights++;
  });
  return { objects, meshes, triangles, lights };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

// Re-import THREE just to satisfy isMesh / isLight type checks above.
import * as THREE from 'three';
void THREE;
