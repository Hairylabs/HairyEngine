import { perf, PerfSnapshot } from '../engine/PerfMonitor';
import { Scene } from '../engine/Scene';
import type { Viewport } from '../engine/Viewport';

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

  constructor(
    private root: HTMLElement,
    private scene: Scene,
    private viewport?: Viewport,
  ) {
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
    const vram = this.estimateVramMb();
    const fmtMs = (ms: number) => ms < 1 ? '<1' : ms.toFixed(1);
    const heap = s.jsHeapMb ? `${s.jsHeapMb.toFixed(0)} MB` : '?';
    const heapLimit = s.jsHeapLimitMb ? `${s.jsHeapLimitMb.toFixed(0)} MB` : 'unknown';
    const heapPct = (s.jsHeapMb && s.jsHeapLimitMb)
      ? Math.round((s.jsHeapMb / s.jsHeapLimitMb) * 100)
      : 0;
    const heapColor = heapPct >= 80 ? '#ff7878' : heapPct >= 60 ? '#ffd166' : 'var(--accent-2)';
    const vramColor = vram.totalMb >= 1024 ? '#ff7878' : vram.totalMb >= 512 ? '#ffd166' : 'var(--accent-2)';
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
        <br>
        <strong style="color: var(--text); font-size: 12px;">Memory (browser-game budget)</strong><br>
        JS heap: <span style="color: ${heapColor}; font-weight: 700;">${heap}</span> / ${heapLimit} <span style="color: ${heapColor};">(${heapPct}%)</span><br>
        VRAM (estimate): <span style="color: ${vramColor}; font-weight: 700;">${vram.totalMb.toFixed(0)} MB</span>
          — textures ${vram.textureMb.toFixed(0)} MB (${vram.textureCount}),
          geometries ${vram.geometryMb.toFixed(0)} MB (${vram.geometryCount}),
          programs ${vram.programs}<br>
        ${browserBudgetNote(s.jsHeapMb ?? 0, vram.totalMb)}<br><br>
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

  /** Walk the live scene + Three.js renderer.info to estimate VRAM use.
   *  Textures: width*height*4 bytes for the base level + 33% mip overhead.
   *  Geometries: each attribute's byteLength summed. Indexed buffers count.
   *  Three's renderer.info.programs lists shader programs (small but tallied). */
  private estimateVramMb(): {
    totalMb: number;
    textureMb: number;
    geometryMb: number;
    textureCount: number;
    geometryCount: number;
    programs: number;
  } {
    let textureBytes = 0;
    let geometryBytes = 0;
    const countedTextures = new Set<number>();
    const countedGeometries = new Set<number>();

    this.scene.three.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        // Materials may hold maps + normalMaps + emissiveMaps + …
        const mats = Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []);
        for (const mat of mats) {
          const matRec = mat as unknown as Record<string, unknown>;
          for (const key of TEXTURE_KEYS) {
            const tex = matRec[key] as THREE.Texture | undefined;
            if (tex && tex.id && !countedTextures.has(tex.id)) {
              countedTextures.add(tex.id);
              textureBytes += estimateTextureBytes(tex);
            }
          }
        }
        if (m.geometry && !countedGeometries.has(m.geometry.id)) {
          countedGeometries.add(m.geometry.id);
          geometryBytes += estimateGeometryBytes(m.geometry);
        }
      }
    });

    let programs = 0;
    const rendererInfo = (this.viewport as unknown as { renderer?: { info?: { programs?: unknown[] } } })?.renderer?.info;
    if (rendererInfo?.programs) {
      programs = rendererInfo.programs.length;
    }

    const textureMb = textureBytes / 1024 / 1024;
    const geometryMb = geometryBytes / 1024 / 1024;
    return {
      totalMb: textureMb + geometryMb,
      textureMb,
      geometryMb,
      textureCount: countedTextures.size,
      geometryCount: countedGeometries.size,
      programs,
    };
  }
}

const TEXTURE_KEYS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap',
  'aoMap', 'displacementMap', 'envMap', 'lightMap', 'alphaMap',
  'bumpMap', 'specularMap',
] as const;

function estimateTextureBytes(tex: THREE.Texture): number {
  const img = tex.image as { width?: number; height?: number } | undefined;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!w || !h) return 0;
  // 4 bytes per pixel (RGBA8). Mips add ~33% over the base.
  return Math.round(w * h * 4 * 1.33);
}

function estimateGeometryBytes(geom: THREE.BufferGeometry): number {
  let total = 0;
  for (const key in geom.attributes) {
    const attr = geom.attributes[key];
    total += (attr as THREE.BufferAttribute).array.byteLength ?? 0;
  }
  if (geom.index) total += geom.index.array.byteLength ?? 0;
  return total;
}

function browserBudgetNote(heapMb: number, vramMb: number): string {
  // Chrome's per-tab effective budget on 64-bit is ~4 GB total addressable;
  // realistically a browser game starts dropping textures or oom'ing well
  // before that. We warn at ~2 GB combined (heap + textures).
  const combined = heapMb + vramMb;
  if (combined < 800) return `<span style="color: var(--accent-2);">✔ Combined ~${combined.toFixed(0)} MB — fine for a browser tab.</span>`;
  if (combined < 1500) return `<span style="color: #ffd166;">⚠ Combined ~${combined.toFixed(0)} MB — getting heavy for mobile browsers (1.5 GB cap is common).</span>`;
  return `<span style="color: #ff7878;">✘ Combined ~${combined.toFixed(0)} MB — likely to OOM on iOS Safari (≈1 GB) and risk crashes on mid-range Android. Consider Decimate or smaller textures.</span>`;
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
