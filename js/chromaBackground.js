// ============================================================
// chromaBackground.js (Original WebGL - Fast & Lightweight)
// ============================================================

const VERTEX_SRC = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SRC = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
varying vec2 v_texCoord;

float noise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float smoothNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = noise(i);
  float b = noise(i + vec2(1.0, 0.0));
  float c = noise(i + vec2(0.0, 1.0));
  float d = noise(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = v_texCoord;
  float t = u_time * 0.15;

  vec3 col1 = vec3(0.847, 0.725, 1.0);   // Violet (primary)
  vec3 col2 = vec3(0.263, 0.925, 0.859); // Teal (secondary)
  vec3 col3 = vec3(1.0, 0.729, 0.125);   // Amber (tertiary)
  vec3 col4 = vec3(1.0, 0.31, 0.52);     // Rose (accent)

  float n1 = smoothNoise(uv * 2.0 + t);
  float n2 = smoothNoise(uv * 1.5 - t * 0.8 + 10.0);
  float n3 = smoothNoise(uv * 3.0 + t * 1.2 + 20.0);

  vec3 bg = mix(col1, col2, n1);
  bg = mix(bg, col3, n2);
  bg = mix(bg, col4, n3);

  gl_FragColor = vec4(bg * 0.14, 1.0);
}`;

function compileShader(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  return shader;
}

export function initChromaBackground(opts = {}) {
  if (document.getElementById("chromaBackgroundCanvas")) return; 

  const prefersReducedMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  const wrap = document.createElement("div");
  wrap.id = "chromaBackgroundWrap";
  wrap.setAttribute("aria-hidden", "true");
  Object.assign(wrap.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: "-1",
    pointerEvents: "none",
    opacity: String(opts.opacity ?? 0.5),
  });

  const canvas = document.createElement("canvas");
  canvas.id = "chromaBackgroundCanvas";
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  wrap.appendChild(canvas);

  const target = (opts.targetId && document.getElementById(opts.targetId)) || document.body;
  target.insertBefore(wrap, target.firstChild);

  if (prefersReducedMotion) return; 

  function syncSize() {
    const w = canvas.clientWidth || 1280;
    const h = canvas.clientHeight || 720;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(syncSize).observe(canvas);
  }
  syncSize();

  const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  if (!gl) return; 

  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC));
  gl.linkProgram(program);
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(program, "u_time");
  const uRes = gl.getUniformLocation(program, "u_resolution");

  function render(t) {
    if (typeof ResizeObserver === "undefined") syncSize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (uTime) gl.uniform1f(uTime, t * 0.001);
    if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}