'use client';

/**
 * MarketingAtmosphere
 *
 * Fixed full-viewport fragment shader for price / download / changelog.
 * Math-driven “ordered chaos”: domain-warped FBM, caustic ridges, soft depth
 * bands. Follows site light/dark (`html.dark`) with the same deep/shallow water
 * split as the landing WebGL backdrop (no three.js).
 *
 * Cost: one full-screen triangle, dpr ≤ 1.5, low-power preference; pauses when
 * the tab is hidden; reduced-motion freezes time. CSS gradient fallback if
 * WebGL is unavailable.
 */

import { useLocation } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

const VERT = /* glsl */ `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// uTheme: 0 = dark abyss, 1 = light shallow (landing BG_FRAG palette).
const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uMotion;
uniform float uTheme;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

// NOTE: the ridge highlights in main() need a finite difference of this whole
// function. Holding the warp fixed and stepping inside warped space is ~5x cheaper
// per tap but destroys the filigree — the warp's own gradient over e is larger than
// e itself, so it carries most of the line structure. Do not "optimise" that away.
float warped(vec2 p, float t) {
  vec2 q = vec2(
    fbm(p + vec2(1.4, 0.6) + vec2(0.0, t * 0.12)),
    fbm(p + vec2(4.1, 2.8) - vec2(t * 0.09, 0.0))
  );
  vec2 r = vec2(
    fbm(p + 3.4 * q + vec2(2.4, 7.1) + t * 0.055),
    fbm(p + 3.4 * q + vec2(6.8, 1.9) - t * 0.04)
  );
  return fbm(p + 3.0 * r);
}

float causticNet(vec2 p, float t) {
  vec2 w = p + 0.35 * vec2(
    fbm(p * 0.9 + vec2(t * 0.05, 0.0)),
    fbm(p * 0.9 + vec2(3.1, t * 0.04))
  );
  float c = 0.0;
  c += sin(w.x * 7.5 + t * 0.35) * sin(w.y * 6.2 - t * 0.28);
  c += 0.65 * sin((w.x + w.y) * 5.4 - t * 0.22);
  c += 0.4 * sin((w.x - w.y) * 8.1 + t * 0.18);
  return c * 0.5 + 0.5;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float y = uv.y;
  float t = uTime;
  float light = clamp(uTheme, 0.0, 1.0);

  // --- Dark base (landing abyss) ------------------------------------------
  vec3 dTop = vec3(0.028, 0.095, 0.168);
  vec3 dMid = vec3(0.055, 0.175, 0.285);
  vec3 dBot = vec3(0.022, 0.068, 0.138);
  vec3 darkBase = y > 0.5
    ? mix(dMid, dTop, (y - 0.5) * 2.0)
    : mix(dBot, dMid, y * 2.0);

  // --- Light base (shallow water — richer mid blue so structure has room) ---
  // Not pure white: more saturation/depth so caustics don't wash out.
  vec3 lTop  = vec3(0.88, 0.93, 0.98);
  vec3 lMid  = vec3(0.62, 0.78, 0.92);
  vec3 lBot  = vec3(0.48, 0.66, 0.84);
  vec3 lightBase = y > 0.5
    ? mix(lMid, lTop, (y - 0.5) * 2.0)
    : mix(lBot, lMid, y * 2.0);

  vec3 base = mix(darkBase, lightBase, light);

  // Accents: bright caustics on dark; deeper teal veins on light (higher contrast).
  vec3 dAqua = vec3(0.14, 0.66, 0.82);
  vec3 dIce  = vec3(0.58, 0.80, 0.93);
  vec3 lAqua = vec3(0.12, 0.42, 0.62);
  vec3 lInk  = vec3(0.06, 0.22, 0.38);
  vec3 aqua = mix(dAqua, lAqua, light);
  vec3 ice  = mix(dIce, vec3(0.95, 0.98, 1.0), light);
  vec3 deep = mix(vec3(0.03, 0.10, 0.19), lBot, light);

  vec2 pField = p * 0.95 + vec2(0.18, -0.12);
  float n = warped(pField + vec2(0.0, -t * 0.024), t * 0.075);
  float n2 = warped(pField * 1.7 + vec2(t * 0.016, 0.08), t * 0.05 + 1.9);

  float body = smoothstep(0.35, 0.72, n);
  // Light: stronger body modulation so the field isn't a flat wash.
  vec3 col = mix(base, deep, mix(0.22, 0.28, light) * (1.0 - body));
  col = mix(col, mix(dMid * 1.15, lMid * 0.92, light), body * mix(0.28, 0.38, light));
  col = mix(col, aqua * mix(0.14, 0.16, light) + base, body * mix(0.18, 0.22, light));

  float e = 0.016;
  float nx = warped(pField + vec2(e, 0.0) + vec2(0.0, -t * 0.024), t * 0.075) - n;
  float ny = warped(pField + vec2(0.0, e) + vec2(0.0, -t * 0.024), t * 0.075) - n;
  float ridge = 1.0 - smoothstep(0.0, 0.065, abs(nx) + abs(ny));
  ridge *= smoothstep(0.2, 0.58, n) * (0.4 + 0.6 * n2);
  float heightMask = smoothstep(0.0, 0.72, y) * 0.75 + 0.25;

  // Dark: additive aqua light. Light: ink veins — boosted so they read clearly.
  float ridgeAmt = mix(0.2, 0.28, light);
  col += mix(aqua, lInk, light) * ridge * ridgeAmt * heightMask;
  col += ice * ridge * ridge * mix(0.07, 0.09, light) * heightMask;

  float net = causticNet(pField * 1.15 + vec2(0.0, -t * 0.03), t);
  // Light: wider/soft threshold + higher weight so the net isn't lost.
  net = smoothstep(mix(0.42, 0.32, light), mix(0.78, 0.72, light), net);
  net *= heightMask * (0.55 + 0.45 * n);
  col += mix(aqua, lInk, light) * net * mix(0.11, 0.2, light);
  col += ice * net * net * mix(0.035, 0.06, light);

  float veins = smoothstep(0.46, 0.58, n2) - smoothstep(0.58, 0.72, n2);
  veins = max(veins, 0.0);
  col += mix(aqua, lInk, light) * veins * mix(0.07, 0.12, light) * heightMask;

  float shaft = pow(max(0.0, 1.0 - length((uv - vec2(0.42, 1.1)) * vec2(1.15, 1.65))), 2.0);
  // Light: cooler top wash that still leaves mid-field free for structure.
  col += mix(mix(aqua, ice, 0.35) * 0.11, ice * 0.12, light) * shaft;

  float bands = sin((n * 3.8 + y * 2.0 - t * 0.05) * 3.14159);
  bands = bands * bands;
  col += mix(aqua, lInk, light) * bands * mix(0.015, 0.028, light) * heightMask;

  // Vignette: darken edges on dark; cool rim on light (helps structure pop).
  float vigAmt = mix(0.24, 0.2, light);
  float vig = 1.0 - vigAmt * smoothstep(0.25, 1.15, length((uv - 0.5) * vec2(1.12, 1.0)));
  col *= vig;
  // Light only: slight blue push in the rim so edges aren't flat grey.
  col = mix(col, col * vec3(0.92, 0.96, 1.02), light * (1.0 - vig) * 0.85);

  col = pow(max(col, 0.0), vec3(mix(0.9, 0.94, light)));
  col *= mix(1.05, 1.02, light);

  gl_FragColor = vec4(col, 1.0);
}
`;

/** Curated phase so first paint is mid-cycle (not the harsh t=0 warp). */
const TIME_ORIGIN = 23.6;

/**
 * The field drifts slowly (its fastest time term is 0.12/s), so 30fps is visually
 * identical to vsync while halving GPU work on a 60Hz panel and quartering it on a
 * 120Hz one. `uTime` is wall-clock derived, so capping does not slow the motion.
 */
const TARGET_FPS = 30;
const MIN_FRAME_MS = 1000 / TARGET_FPS;

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark');
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[marketing-atmosphere] shader compile', gl.getShaderInfoLog(shader));
    }
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(
  gl: WebGLRenderingContext,
  vert: WebGLShader,
  frag: WebGLShader
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[marketing-atmosphere] program link', gl.getProgramInfoLog(program));
    }
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * Marketing routes that share this atmosphere. Hosted once at the app root so
 * price ↔ download ↔ changelog navigation never recompiles WebGL.
 */
export function isMarketingAtmospherePath(pathname: string): boolean {
  const path = pathname.replace(/\/$/u, '') || '/';
  const bare = path.startsWith('/zh/') ? path.slice(3) : path === '/zh' ? '/' : path;
  return (
    bare === '/price' ||
    bare === '/download' ||
    bare === '/changelog' ||
    bare.startsWith('/changelog/')
  );
}

export function MarketingAtmosphere({
  className,
  /** When false, hide + pause the loop but keep the GL context warm. */
  active = true,
}: {
  className?: string;
  active?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const gl =
      canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        powerPreference: 'low-power',
        preserveDrawingBuffer: false,
      }) ||
      (canvas.getContext('experimental-webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
      }) as WebGLRenderingContext | null);

    if (!gl) {
      canvas.dataset.fallback = 'true';
      return undefined;
    }

    const vert = compile(gl, gl.VERTEX_SHADER, VERT);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vert || !frag) {
      canvas.dataset.fallback = 'true';
      return undefined;
    }
    const program = link(gl, vert, frag);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    if (!program) {
      canvas.dataset.fallback = 'true';
      return undefined;
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(program, 'aPos');
    const uRes = gl.getUniformLocation(program, 'uRes');
    const uTime = gl.getUniformLocation(program, 'uTime');
    const uMotion = gl.getUniformLocation(program, 'uMotion');
    const uTheme = gl.getUniformLocation(program, 'uTheme');

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let motion = motionMq.matches ? 0 : 1;
    let theme = isDarkTheme() ? 0 : 1; // 0 dark, 1 light
    let themeTarget = theme;
    let tabVisible = document.visibilityState === 'visible';
    let raf = 0;
    let running = true;
    // Timestamp of the last GL draw; drives both the frame cap and the theme ease.
    let lastPaintAt = -1;
    const start = performance.now();
    const maxDpr = 1.5;

    const pageActive = () => activeRef.current;

    const syncThemeClass = () => {
      document.documentElement.classList.toggle('marketing-atmosphere-light', themeTarget > 0.5);
    };

    const syncActiveClass = () => {
      const on = pageActive();
      document.documentElement.classList.toggle('marketing-atmosphere-active', on);
      canvas.dataset.pageActive = on ? 'true' : 'false';
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const w = Math.max(1, Math.floor(window.innerWidth * dpr));
      const h = Math.max(1, Math.floor(window.innerHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const paint = (now: number) => {
      if (!pageActive()) return;
      resize();
      // Ease theme so toggle doesn't hard-cut the field. Framed against elapsed
      // time, not frame count, so the capped loop settles over the same wall clock
      // the uncapped 60fps loop used to.
      const frames = lastPaintAt < 0 ? 1 : Math.min(8, (now - lastPaintAt) / (1000 / 60));
      theme += (themeTarget - theme) * (1 - Math.pow(1 - 0.12, frames));
      if (Math.abs(themeTarget - theme) < 0.002) theme = themeTarget;
      lastPaintAt = now;

      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      const elapsed = motion > 0 ? (now - start) * 0.001 : 0;
      gl.uniform1f(uTime, TIME_ORIGIN + elapsed);
      gl.uniform1f(uMotion, motion);
      gl.uniform1f(uTheme, theme);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const shouldLoop = () => {
      if (!pageActive() || !tabVisible) return false;
      const themeSettling = Math.abs(themeTarget - theme) > 0.002;
      return motion > 0 || themeSettling;
    };

    const loop = (now: number) => {
      if (!running) return;
      // Skip draws that would land inside the frame budget. The rAF callback itself
      // is negligible; the full-screen fragment pass is what we are rationing.
      if (now - lastPaintAt >= MIN_FRAME_MS - 1) paint(now);
      if (shouldLoop()) {
        raf = window.requestAnimationFrame(loop);
      } else {
        raf = 0;
      }
    };

    const kick = () => {
      if (!running) return;
      if (raf) window.cancelAnimationFrame(raf);
      syncActiveClass();
      if (!pageActive()) {
        raf = 0;
        return;
      }
      if (shouldLoop()) {
        raf = window.requestAnimationFrame(loop);
      } else {
        paint(performance.now());
        raf = 0;
      }
    };

    const onMotion = () => {
      motion = motionMq.matches ? 0 : 1;
      kick();
    };
    const onVisibility = () => {
      tabVisible = document.visibilityState === 'visible';
      kick();
    };
    const onResize = () => {
      if (pageActive() && !raf) paint(performance.now());
    };
    const onTheme = () => {
      themeTarget = isDarkTheme() ? 0 : 1;
      syncThemeClass();
      kick();
    };

    const themeObserver = new MutationObserver(onTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    // Poll activeRef via rAF-friendly custom event from the host (or effect below).
    const onActiveChange = () => kick();
    window.addEventListener('marketing-atmosphere-active', onActiveChange);

    motionMq.addEventListener('change', onMotion);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize, { passive: true });

    syncThemeClass();
    syncActiveClass();
    canvas.dataset.ready = 'true';
    kick();

    return () => {
      running = false;
      if (raf) window.cancelAnimationFrame(raf);
      themeObserver.disconnect();
      window.removeEventListener('marketing-atmosphere-active', onActiveChange);
      motionMq.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      document.documentElement.classList.remove('marketing-atmosphere-active');
      document.documentElement.classList.remove('marketing-atmosphere-light');
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
      // Deliberately NOT calling WEBGL_lose_context.loseContext() here. A canvas
      // hands the same context object back to every getContext() call, and a lost
      // one is never revived implicitly (restoreContext() is async). React
      // re-invokes effects in dev, so losing the context on cleanup left the
      // remount holding a dead context: every compile failed with a null info log
      // and the field silently fell back to the CSS gradient for the whole dev
      // session. The GL objects above are freed explicitly; the context itself
      // goes with the canvas. This host is designed to keep one context warm for
      // the session anyway, so there is nothing to reclaim early.
    };
  }, []);

  // Notify the GL effect when the host toggles `active` without remounting.
  useEffect(() => {
    window.dispatchEvent(new Event('marketing-atmosphere-active'));
  }, [active]);

  return (
    <div
      className={['marketing-atmosphere', className].filter(Boolean).join(' ')}
      data-page-active={active ? 'true' : 'false'}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="marketing-atmosphere__canvas" />
    </div>
  );
}

/**
 * Single app-root host: first marketing visit compiles WebGL once; subsequent
 * marketing routes reuse the same instance. Leaving marketing pauses the loop
 * and hides the canvas without tearing down GL (warm resume).
 */
export function MarketingAtmosphereHost() {
  const { pathname } = useLocation();
  const onMarketing = isMarketingAtmospherePath(pathname);
  const [warm, setWarm] = useState(false);

  useEffect(() => {
    if (onMarketing) setWarm(true);
  }, [onMarketing]);

  if (!warm) return null;

  return <MarketingAtmosphere active={onMarketing} />;
}

export default MarketingAtmosphere;
