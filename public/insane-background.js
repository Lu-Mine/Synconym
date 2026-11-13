// 狂意页面的流体背景；不支持 WebGL 时保留 CSS 背景。
export const INSANE_PALETTES = Object.freeze({
  default: {
    violet: [0.30, 0.16, 0.52],
    teal: [0.10, 0.45, 0.52],
    rose: [0.82, 0.27, 0.44],
    blue: [0.10, 0.30, 0.66],
    ink: [0.02, 0.04, 0.13],
    highlightA: [0.55, 0.68, 1.00],
    highlightB: [1.00, 0.68, 0.78],
    burst: [0.85, 0.30, 0.55]
  },
  livonym: {
    violet: [0.24, 0.30, 0.68],
    teal: [0.24, 0.74, 0.68],
    rose: [0.48, 0.55, 0.94],
    blue: [0.07, 0.42, 0.44],
    ink: [0.02, 0.08, 0.09],
    highlightA: [0.55, 0.90, 0.84],
    highlightB: [0.63, 0.66, 1.00],
    burst: [0.38, 0.88, 0.76]
  },
  shiritori: {
    violet: [0.46, 0.28, 0.78],
    teal: [0.30, 0.20, 0.60],
    rose: [0.84, 0.54, 0.84],
    blue: [0.24, 0.16, 0.46],
    ink: [0.07, 0.04, 0.12],
    highlightA: [0.76, 0.64, 0.98],
    highlightB: [0.95, 0.78, 0.92],
    burst: [0.84, 0.62, 0.96]
  },
  impostor: {
    violet: [0.44, 0.14, 0.46],
    teal: [0.60, 0.18, 0.32],
    rose: [0.90, 0.30, 0.46],
    blue: [0.26, 0.14, 0.42],
    ink: [0.09, 0.03, 0.08],
    highlightA: [0.94, 0.63, 0.69],
    highlightB: [0.74, 0.61, 1.00],
    burst: [0.98, 0.33, 0.45]
  },
  blitz: {
    violet: [0.66, 0.36, 0.18],
    teal: [0.72, 0.50, 0.18],
    rose: [0.96, 0.52, 0.34],
    blue: [0.42, 0.24, 0.14],
    ink: [0.09, 0.06, 0.03],
    highlightA: [0.98, 0.83, 0.51],
    highlightB: [1.00, 0.62, 0.55],
    burst: [1.00, 0.84, 0.40]
  },
  bridge: {
    violet: [0.32, 0.24, 0.68],
    teal: [0.22, 0.52, 0.78],
    rose: [0.62, 0.50, 0.94],
    blue: [0.12, 0.30, 0.58],
    ink: [0.03, 0.06, 0.13],
    highlightA: [0.57, 0.81, 0.95],
    highlightB: [0.78, 0.66, 1.00],
    burst: [0.57, 0.81, 0.95]
  }
});

const PALETTE_KEYS = ['violet', 'teal', 'rose', 'blue', 'ink', 'highlightA', 'highlightB', 'burst'];

function clonePalette(palette) {
  const result = {};
  for (const key of PALETTE_KEYS) result[key] = [...palette[key]];
  return result;
}

export function createInsaneBackground() {
  const canvas = document.createElement('canvas');
  canvas.className = 'insane-background';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
  if (!gl) return { setActive() {}, setMode() {}, setGlitch() {} };

  const vertex = `attribute vec2 position; void main() { gl_Position = vec4(position, 0., 1.); }`;
  const fragment = `#ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform vec2 resolution;
    uniform float time;
    uniform float uGlitch;
    uniform vec3 uViolet;
    uniform vec3 uTeal;
    uniform vec3 uRose;
    uniform vec3 uBlue;
    uniform vec3 uInk;
    uniform vec3 uHighlightA;
    uniform vec3 uHighlightB;
    uniform vec3 uBurst;
    float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
    vec3 vortex(vec2 frag) {
      float scale = length(resolution);
      vec2 uv = (frag - .5 * resolution) / scale - vec2(.036, -.013);
      float len = length(uv);
      float angle = atan(uv.y, uv.x) + 302.2 + time * .11 - 20.0 * (.9 * len + .1);
      vec2 mid = resolution / scale * .5;
      uv = vec2(len * cos(angle) + mid.x, len * sin(angle) + mid.y) - mid;
      uv *= 30.0;
      float speed = time * 1.1;
      vec2 uv2 = vec2(uv.x + uv.y);
      for (int i = 0; i < 5; i++) {
        uv2 += sin(max(uv.x, uv.y)) + uv;
        uv += .5 * vec2(cos(5.1123314 + .353 * uv2.y + speed * .131121), sin(uv2.x - .113 * speed));
        uv -= cos(uv.x + uv.y) - sin(uv.x * .711 - uv.y);
      }
      float contrast = 1.55;
      float paint = min(2.0, max(0.0, length(uv) * .035 * contrast));
      float c1 = max(0.0, 1.0 - contrast * abs(1.0 - paint));
      float c2 = max(0.0, 1.0 - contrast * abs(paint));
      float c3 = 1.0 - min(1.0, c1 + c2);
      float shift = .5 + .5 * sin(uv.x * .22 - uv.y * .17 + time * .2);
      vec3 warm = mix(uViolet, uRose, shift);
      vec3 cool = mix(uBlue, uTeal, shift);
      float light = .22 * max(c1 * 5.0 - 4.0, 0.0) + .34 * max(c2 * 5.0 - 4.0, 0.0);
      vec3 shade = cool * c1 + warm * c2 * 1.25 + uInk * c3;
      return shade + mix(uHighlightA, uHighlightB, shift) * light;
    }
    void main() {
      float scale = length(resolution);
      float cycle = floor(time / 3.6);
      float phase = fract(time / 3.6) * 3.6;
      float burst = uGlitch * step(.55, hash(cycle + 3.0)) * ((step(.04, phase) - step(.12, phase)) + (step(.18, phase) - step(.26, phase)));
      float row = floor(gl_FragCoord.y / (resolution.y / 28.0));
      float slice = (hash(row + cycle * 17.0) - .5) * step(.62, hash(row * 3.1 + cycle)) * burst;
      vec2 frag = gl_FragCoord.xy + vec2(slice * resolution.x * .08, 0.);
      vec3 color = vortex(frag);
      if (burst > 0.) {
        float split = burst * resolution.x * .006;
        color.r = vortex(frag - vec2(split, 0.)).r;
        color.b = vortex(frag + vec2(split, 0.)).b;
      }
      vec2 q = (gl_FragCoord.xy - .5 * resolution) / scale;
      float block = step(.94, hash(floor(gl_FragCoord.x / 46.0) * 7.0 + floor(gl_FragCoord.y / 18.0) * 13.0 + cycle * 5.0)) * burst;
      color = mix(color, uBurst, block * .45);
      color *= 1.0 - .34 * smoothstep(.25, .95, length(q));
      gl_FragColor = vec4(color, 1.0);
    }`;
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; }
    return shader;
  }
  const vs = compile(gl.VERTEX_SHADER, vertex);
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return { setActive() {}, setMode() {}, setGlitch() {} };
  const program = gl.createProgram();
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return { setActive() {}, setMode() {}, setGlitch() {} }; }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const resolution = gl.getUniformLocation(program, 'resolution');
  const time = gl.getUniformLocation(program, 'time');
  const glitch = gl.getUniformLocation(program, 'uGlitch');
  const paletteUniforms = {
    violet: gl.getUniformLocation(program, 'uViolet'),
    teal: gl.getUniformLocation(program, 'uTeal'),
    rose: gl.getUniformLocation(program, 'uRose'),
    blue: gl.getUniformLocation(program, 'uBlue'),
    ink: gl.getUniformLocation(program, 'uInk'),
    highlightA: gl.getUniformLocation(program, 'uHighlightA'),
    highlightB: gl.getUniformLocation(program, 'uHighlightB'),
    burst: gl.getUniformLocation(program, 'uBurst')
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let active = false;
  let contextLost = false;
  let glitchEnabled = false;
  let frame = 0;
  let start = 0;
  let elapsed = 0;
  let currentPalette = clonePalette(INSANE_PALETTES.default);
  let targetPalette = INSANE_PALETTES.default;
  let paletteAnimating = false;
  let lastDrawAt = 0;
  // 上下文丢失后画布是一片空白：这时把画面交回 CSS 渐变，而不是让白底盖住深色主题。
  function fallBackToCss() {
    contextLost = true;
    document.body.classList.remove('has-insane-gl');
    cancelAnimationFrame(frame); frame = 0;
  }
  function stepPalette(dt) {
    const step = dt / 0.38;
    let remaining = false;
    for (const key of PALETTE_KEYS) {
      const cur = currentPalette[key];
      const tgt = targetPalette[key];
      for (let i = 0; i < 3; i += 1) {
        const diff = tgt[i] - cur[i];
        if (Math.abs(diff) <= step) {
          cur[i] = tgt[i];
        } else {
          cur[i] += Math.sign(diff) * step;
          remaining = true;
        }
      }
    }
    paletteAnimating = remaining;
  }
  function draw(now) {
    frame = 0;
    if (!active || contextLost || document.hidden) return;
    if (!start) start = now;
    if (lastDrawAt && paletteAnimating) {
      const dt = Math.min(0.1, Math.max(0, (now - lastDrawAt) / 1000));
      stepPalette(dt);
    }
    lastDrawAt = now;
    const scale = Math.min(devicePixelRatio || 1, 1);
    const width = Math.max(1, Math.round(innerWidth * scale));
    const height = Math.max(1, Math.round(innerHeight * scale));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.uniform2f(resolution, width, height);
    gl.uniform1f(time, window.__INSANE_TIME ?? (reduced.matches ? 0 : (elapsed + now - start) / 1000));
    gl.uniform1f(glitch, glitchEnabled && !reduced.matches ? 1 : 0);
    for (const key of PALETTE_KEYS) {
      const [r, g, b] = currentPalette[key];
      gl.uniform3f(paletteUniforms[key], r, g, b);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!reduced.matches || paletteAnimating) frame = requestAnimationFrame(draw);
  }
  function update() {
    cancelAnimationFrame(frame); frame = 0;
    if (start) { elapsed += performance.now() - start; start = 0; }
    lastDrawAt = 0;
    if (active && !document.hidden) frame = requestAnimationFrame(draw);
  }
  reduced.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
  window.addEventListener('resize', update);
  canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); fallBackToCss(); });
  return {
    setActive(value) {
      if (active === value) return;
      active = value;
      document.body.classList.toggle('has-insane-gl', active && !contextLost);
      if (active) document.body.prepend(canvas); else canvas.remove();
      update();
    },
    setMode(mode, { immediate = false } = {}) {
      const nextPalette = INSANE_PALETTES[mode] || INSANE_PALETTES.default;
      targetPalette = nextPalette;
      if (immediate || reduced.matches || !active) {
        currentPalette = clonePalette(nextPalette);
        paletteAnimating = false;
      } else {
        paletteAnimating = true;
      }
      if (active && reduced.matches) update();
    },
    setGlitch(value) {
      const next = Boolean(value);
      if (glitchEnabled === next) return;
      glitchEnabled = next;
      if (active) update();
    }
  };
}
