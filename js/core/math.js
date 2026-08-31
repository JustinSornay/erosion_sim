function idx(x, y) {
  return y * N + x;
}

// ---------- bruit (Perlin classique, seedé) ----------
let seed = 918273645;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const perm = new Uint8Array(512);
function reseedPerm() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerp(a, b, t) {
  return a + t * (b - a);
}
function grad(h, x, y) {
  const g = h & 7,
    uu = g < 4 ? x : y,
    ww = g < 4 ? y : x;
  return (g & 1 ? -uu : uu) + (g & 2 ? -2 * ww : 2 * ww);
}
function perlin(x, y) {
  const X = Math.floor(x) & 255,
    Y = Math.floor(y) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  const uu = fade(x),
    vv = fade(y);
  const Aa = perm[X] + Y,
    Bb = perm[X + 1] + Y;
  return lerp(
    lerp(grad(perm[Aa], x, y), grad(perm[Bb], x - 1, y), uu),
    lerp(grad(perm[Aa + 1], x, y - 1), grad(perm[Bb + 1], x - 1, y - 1), uu),
    vv,
  );
}
function fbm(x, y) {
  let amp = 1,
    freq = 1,
    sum = 0,
    norm = 0;
  for (let i = 0; i < 5; i++) {
    sum += perlin(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return sum / norm;
}
function bilerp(arr, fx, fy) {
  fx = Math.min(N - 1.001, Math.max(0, fx));
  fy = Math.min(N - 1.001, Math.max(0, fy));
  const x0 = fx | 0,
    y0 = fy | 0,
    x1 = Math.min(x0 + 1, N - 1),
    y1 = Math.min(y0 + 1, N - 1),
    tx = fx - x0,
    ty = fy - y0;
  const v00 = arr[idx(x0, y0)],
    v10 = arr[idx(x1, y0)],
    v01 = arr[idx(x0, y1)],
    v11 = arr[idx(x1, y1)];
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
}
