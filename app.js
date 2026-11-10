// Bảo tàng số Lịch sử Đảng – không gian 3D, người que, nhiều người cùng tham quan.
(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const DATA = window.MUSEUM;
const Net = window.Net;

/* ================= renderer, scene, camera ================= */
const canvas = $("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.outputEncoding = THREE.sRGBEncoding;
const scene = new THREE.Scene();
const SKY = 0xbcd6ea;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 70, 180);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
camera.rotation.order = "YXZ";
const EYE = 1.65;
const player = { x: 0, z: 37, yaw: 0, pitch: 0.04, moving: false, phase: 0, jy: 0, vy: 0, base: 0 };
function jump() { if (started && !infoOpen && player.jy <= 0.001) player.vy = 5.6; }
let thirdPerson = false;

/* ================= small helpers ================= */
const UI_FONT = '"Be Vietnam Pro", system-ui, sans-serif';
const SERIF = '"Noto Serif", Georgia, serif';
const GOLD_TXT = "#e2c98a";
function canvasTex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function wrapLines(ctx, text, maxW) {
  const out = []; let line = "";
  for (const w of String(text).split(" ")) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
  }
  if (line) out.push(line); return out;
}
// blocks: [{text, size, weight, font, color, gap, align}]  (size in px at the given ppm)
// records text that does not fit its board (shown in window.__textIssues for checking)
const TEXT_ISSUES = []; window.__textIssues = TEXT_ISSUES;
function textIssue(kind, text) { TEXT_ISSUES.push(kind + ": " + String(text).slice(0, 90)); }
function textCanvas(blocks, w, h, o = {}) {
  const ppm = o.ppm || 300;
  const cw = Math.round(ppm * w), ch = Math.round(ppm * h);
  const c = document.createElement("canvas"); c.width = cw; c.height = ch;
  const g = c.getContext("2d");
  g.fillStyle = o.bg || "#1c1511"; g.fillRect(0, 0, cw, ch);
  if (o.border !== false) { g.strokeStyle = o.borderColor || "rgba(201,162,74,0.85)"; g.lineWidth = Math.max(3, ppm / 90); g.strokeRect(ppm * 0.03, ppm * 0.03, cw - ppm * 0.06, ch - ppm * 0.06); }
  const pad = cw * (o.pad || 0.08);
  const top0 = o.top != null ? o.top * ch : 0;
  const room = ch - top0 - Math.max(ppm * 0.07, ch * 0.08); // keep clear of the border
  // lay the text out; if it does not fit, shrink every block a little and try again
  let k = 1, laid, total, wide;
  for (;;) {
    laid = []; total = 0; wide = false;
    for (const b of blocks) {
      const size = Math.round(b.size * k), gapB = (b.gap || 0) * k;
      g.font = `${b.weight || 500} ${size}px ${b.font || SERIF}`;
      const lines = wrapLines(g, b.text, cw - pad * 2);
      for (const l of lines) if (g.measureText(l).width > cw - pad * 2 + 1) wide = true;
      lines.forEach((l, i) => { laid.push({ b, size, l, gap: i === lines.length - 1 ? gapB : 0 }); total += size * 1.3; });
      total += gapB;
    }
    if ((total <= room && !wide) || k < 0.45) break;
    k *= 0.93;
  }
  if (total > room || wide) textIssue(wide ? "chữ dài quá khung" : "chữ tràn trên/dưới", blocks.map((b) => b.text).join(" | "));
  let y = o.top != null ? top0 : (ch - total) / 2;
  g.textBaseline = "top";
  for (const { b, size, l, gap } of laid) {
    g.font = `${b.weight || 500} ${size}px ${b.font || SERIF}`;
    g.fillStyle = b.color || "#f3ead8";
    const align = b.align || o.align || "center";
    g.textAlign = align;
    g.fillText(l, align === "left" ? pad : cw / 2, y + size * 0.1);
    y += size * 1.3 + gap;
  }
  return c;
}
function textPlane(blocks, w, h, o) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: canvasTex(textCanvas(blocks, w, h, o)) }));
}
function placeAt(obj, x, y, z, ry) { obj.position.set(x, y, z); obj.rotation.y = ry || 0; scene.add(obj); return obj; }
// put an object flat on a wall: wall = {x, z, ry}; offset runs left->right as seen by the viewer facing the wall
function onWall(obj, wall, offset, y, out = 0.03) {
  const cx = Math.cos(wall.ry), sx = Math.sin(wall.ry);
  return placeAt(obj, wall.x + cx * offset + sx * out, y, wall.z - sx * offset + cx * out, wall.ry);
}
function prismGeo(w, h, d) { // triangle (base w, height h) in x-y, extruded along +z by d
  const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
  return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
}
let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/* ================= procedural textures ================= */
function grassCanvas() {
  const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
  g.fillStyle = "#6f8f45"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2200; i++) { g.fillStyle = ["#7c9c4f", "#65843e", "#86a659", "#5d7a39"][i % 4]; g.fillRect(rand() * 256, rand() * 256, 2, 3); }
  return c;
}
function stoneCanvas(a, b) {
  const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
  g.fillStyle = a; g.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
    g.fillStyle = (r + k) % 2 ? a : b; g.fillRect(k * 64 + 2, r * 64 + 2, 60, 60);
  }
  return c;
}
function marbleCanvas() {
  const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? "#e2d7bf" : "#7e3326"; g.fillRect(i * 128, j * 128, 128, 128); }
  g.strokeStyle = "rgba(120,90,40,0.5)"; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  return c;
}
function plankCanvas() {
  const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d");
  const tones = ["#6a4429", "#734a2d", "#62402a", "#7a5132", "#5d3c24"];
  for (let r = 0; r < 8; r++) {
    let x = -((r * 97) % 256);
    while (x < 512) { const len = 180 + ((x * 7 + r * 31) % 140 + 140) % 140; g.fillStyle = tones[(r + Math.abs(x)) % tones.length]; g.fillRect(x, r * 64, len, 64); g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(x, r * 64, 2, 64); x += len; }
    g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, r * 64, 512, 2);
  }
  return c;
}
function flagCanvas() {
  const c = document.createElement("canvas"); c.width = 300; c.height = 200; const g = c.getContext("2d");
  g.fillStyle = "#da251d"; g.fillRect(0, 0, 300, 200);
  starPath(g, 150, 100, 60, 23); g.fillStyle = "#ffcd00"; g.fill();
  return c;
}
function starPath(g, cx, cy, R, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  g.closePath();
}

/* ================= materials ================= */
const lam = (color, map) => new THREE.MeshLambertMaterial({ color, map: map || null });
const M = {
  ochre: lam(0xe3b65c), ochreDark: lam(0xc9963f), white: lam(0xf3ede0), roof: lam(0x7a3b2a),
  cream: new THREE.MeshPhongMaterial({ color: 0xf0e6d0, shininess: 6, specular: 0x111111 }), wood: lam(0x4a2f1d), glass: lam(0x2f4456), ceiling: new THREE.MeshLambertMaterial({ color: 0xf3ead6, emissive: 0x4a3f2c }), dark: lam(0x2a201a),
  trunk: lam(0x5b4030), leaf: lam(0x3f6b35), leaf2: lam(0x4f7f3c), olive: lam(0x56603a), metal: lam(0x3c4038),
  gold: new THREE.MeshPhongMaterial({ color: 0xc9a24a, shininess: 70, specular: 0x6b5a2a }),
  lamp: new THREE.MeshBasicMaterial({ color: 0xfff1c9 }),
  shutter: lam(0x3f6b4f), shutterDark: lam(0x2f5340), door: lam(0x5a3420), doorDark: lam(0x46281a),
  granite: lam(0x9a968e), graniteDark: lam(0x5e5b56), flowerR: lam(0xc8322b), flowerY: lam(0xf2c230), soil: lam(0x5a4130), hedge: lam(0x3e6a34),
};
function tileCanvas() {
  const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
  g.fillStyle = "#6e3426"; g.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 8; r++) for (let k = -1; k < 9; k++) {
    const x = k * 32 + (r % 2) * 16, y = r * 32;
    g.fillStyle = ["#8a4532", "#7d3d2c", "#93503a"][(r + k + 9) % 3];
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 32, y); g.lineTo(x + 32, y + 22); g.quadraticCurveTo(x + 16, y + 34, x, y + 22); g.closePath(); g.fill();
    g.strokeStyle = "rgba(40,15,10,0.45)"; g.lineWidth = 2; g.stroke();
  }
  return c;
}
M.roof = new THREE.MeshLambertMaterial({ map: canvasTex(tileCanvas(), [0.35, 0.35]) });
const roomMats = DATA.rooms.map((r) => new THREE.MeshPhongMaterial({ color: new THREE.Color(r.color).multiplyScalar(0.82), shininess: 4, specular: 0x0a0604 }));

/* ================= construction helpers ================= */
const solids = [];      // walls etc. (block the 3rd-person camera and picking)
const interactive = []; // meshes with userData.ex
function box(w, h, d, x, y, z, mat, solid) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); scene.add(m);
  if (solid) solids.push(m); return m;
}
const T = 0.4;
// wall along x at constant z; matPos faces +z, matNeg faces -z; openings [{c, w, h}]
function wallX(z, xa, xb, h, matPos, matNeg, openings = []) {
  const mats = [matNeg, matNeg, M.dark, M.dark, matPos, matNeg];
  const seg = (a, b, y0, y1) => { if (b - a > 0.01 && y1 - y0 > 0.01) box(b - a, y1 - y0, T, (a + b) / 2, (y0 + y1) / 2, z, mats, true); };
  let cur = xa;
  for (const o of openings) { seg(cur, o.c - o.w / 2, 0, h); seg(o.c - o.w / 2, o.c + o.w / 2, o.h, h); cur = o.c + o.w / 2; }
  seg(cur, xb, 0, h);
}
// wall along z at constant x; matPos faces +x, matNeg faces -x
function wallZ(x, za, zb, h, matPos, matNeg, openings = []) {
  const mats = [matPos, matNeg, M.dark, M.dark, matNeg, matNeg];
  const seg = (a, b, y0, y1) => { if (b - a > 0.01 && y1 - y0 > 0.01) box(T, y1 - y0, b - a, x, (y0 + y1) / 2, (a + b) / 2, mats, true); };
  let cur = za;
  for (const o of openings) { seg(cur, o.c - o.w / 2, 0, h); seg(o.c - o.w / 2, o.c + o.w / 2, o.h, h); cur = o.c + o.w / 2; }
  seg(cur, zb, 0, h);
}
function slab(x0, x1, z0, z1, y, mat, up = true) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
  m.rotation.x = up ? -Math.PI / 2 : Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); scene.add(m); return m;
}
function texMat(canvasEl, rep) { return new THREE.MeshLambertMaterial({ map: canvasTex(canvasEl, rep) }); }

/* ================= collision ================= */
const RECTS = [
  { x0: -29, x1: 29, z0: 0.6, z1: 61 },          // sân (trong lũy tre)
  { x0: -1.6, x1: 1.6, z0: -0.8, z1: 0.8 },      // cửa chính
  { x0: -11.4, x1: 11.4, z0: -23.4, z1: -0.6 },  // sảnh
  { x0: -12.8, x1: -11.2, z0: -6.8, z1: -5.2 }, { x0: -12.8, x1: -11.2, z0: -18.8, z1: -17.2 },
  { x0: 11.2, x1: 12.8, z0: -6.8, z1: -5.2 }, { x0: 11.2, x1: 12.8, z0: -18.8, z1: -17.2 },
  { x0: -0.8, x1: 0.8, z0: -24.8, z1: -23.2 },
  { x0: -21.4, x1: -12.6, z0: -11.4, z1: -0.6 }, { x0: -21.4, x1: -12.6, z0: -23.4, z1: -12.6 },
  { x0: -4.4, x1: 4.4, z0: -33.4, z1: -24.6 },
  { x0: 12.6, x1: 21.4, z0: -23.4, z1: -12.6 }, { x0: 12.6, x1: 21.4, z0: -11.4, z1: -0.6 },
];
const CIRCLES = [];
// second floor (mezzanine along the entrance wall + balcony between the portico columns) and the glass elevator
const UP = 5.0;
const ELEV = { x0: -7.4, x1: -5.6, z0: -5.6, z1: -3.6, y: 0, target: 0, cabin: null };
const RECTS_UP = [
  { x0: -11.4, x1: 11.4, z0: -3.15, z1: -0.6 },   // hành lang tầng 2
  { x0: -7.25, x1: -5.75, z0: -3.8, z1: -3.0 },   // cầu nối ra thang máy
  { x0: -1.0, x1: 1.0, z0: -0.8, z1: 0.8 },       // cửa ra ban công
  { x0: -7.9, x1: 7.9, z0: 0.6, z1: 3.75 },       // ban công
];
const inElev = (x, z, m = 0) => x > ELEV.x0 + m && x < ELEV.x1 - m && z > ELEV.z0 + m && z < ELEV.z1 - m;
const levelOf = () => (player.base > UP / 2 ? 1 : 0);
function free(x, z) {
  const lvl = levelOf();
  if (inElev(player.x, player.z) && ELEV.y !== ELEV.target) return inElev(x, z, 0.2); // stay inside while it moves
  if (inElev(x, z, -0.05)) return Math.abs(ELEV.y - (lvl ? UP : 0)) < 0.05;
  if (lvl) { for (const r of RECTS_UP) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true; return false; }
  for (const c of CIRCLES) if ((x - c[0]) ** 2 + (z - c[1]) ** 2 < c[2] * c[2]) return false;
  for (const r of RECTS) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
  return false;
}

/* ================= rooms geometry ================= */
const PI = Math.PI, H2 = PI / 2;
const ROOM_GEO = [
  { rect: [-21.8, -12.2, -11.8, -0.2], c: [-17, -6], face: H2, walls: [{ x: -17, z: -0.2, ry: PI }, { x: -21.8, z: -6, ry: H2 }, { x: -17, z: -11.8, ry: 0 }], sign: { x: -11.8, z: -6, ry: H2 } },
  { rect: [-21.8, -12.2, -23.8, -12.2], c: [-17, -18], face: H2, walls: [{ x: -17, z: -12.2, ry: PI }, { x: -21.8, z: -18, ry: H2 }, { x: -17, z: -23.8, ry: 0 }], sign: { x: -11.8, z: -18, ry: H2 } },
  { rect: [-4.8, 4.8, -33.8, -24.2], c: [0, -29], face: 0, walls: [{ x: -4.8, z: -29, ry: H2 }, { x: 0, z: -33.8, ry: 0 }, { x: 4.8, z: -29, ry: -H2 }], sign: { x: 0, z: -23.8, ry: 0 } },
  { rect: [12.2, 21.8, -23.8, -12.2], c: [17, -18], face: -H2, walls: [{ x: 17, z: -23.8, ry: 0 }, { x: 21.8, z: -18, ry: -H2 }, { x: 17, z: -12.2, ry: PI }], sign: { x: 11.8, z: -18, ry: -H2 } },
  { rect: [12.2, 21.8, -11.8, -0.2], c: [17, -6], face: -H2, walls: [{ x: 17, z: -11.8, ry: 0 }, { x: 21.8, z: -6, ry: -H2 }, { x: 17, z: -0.2, ry: PI }], sign: { x: 11.8, z: -6, ry: -H2 } },
];
function zoneName(x, z, y = 0) {
  if (y > UP / 2 && !inElev(x, z)) return z > 0.2 ? "Ban công tầng 2" : "Tầng 2 · Hành lang";
  if (inElev(x, z)) return "Thang máy";
  if (z > 0.2) return "Sân bảo tàng";
  for (let i = 0; i < 5; i++) { const [x0, x1, z0, z1] = ROOM_GEO[i].rect; if (x > x0 && x < x1 && z > z0 && z < z1) { const r = DATA.rooms[i]; return `Phòng ${r.num} · ${r.period}`; } }
  return DATA.hall.name;
}

/* ================= outdoor ================= */
const flags = [];
const spinners = [];
function buildOutdoor() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), texMat(grassCanvas(), [60, 60]));
  ground.rotation.x = -PI / 2; ground.position.y = -0.02; scene.add(ground);
  slab(-2.5, 2.5, 6, 58.2, 0.012, texMat(stoneCanvas("#b9ad97", "#a89c86"), [1.2, 13]));
  slab(-13, 13, 5.4, 13, 0.006, texMat(stoneCanvas("#c8bca4", "#b6aa92"), [6.5, 2]));
  // portico floor + steps
  box(19, 0.16, 5.4, 0, 0.08, 2.7, M.white);

  // gate
  for (const s of [-1, 1]) { box(1, 3.8, 1, s * 4.4, 1.9, 30, M.ochreDark); box(1.2, 0.3, 1.2, s * 4.4, 3.95, 30, M.gold); CIRCLES.push([s * 4.4, 30, 0.9]); }
  box(9.8, 0.9, 0.8, 0, 4.4, 30, M.ochreDark);
  const gs = textPlane([{ text: "BẢO TÀNG LỊCH SỬ ĐẢNG", size: 64, weight: 700, color: GOLD_TXT }], 8.4, 0.62, { bg: "#7a1f1b", ppm: 160 });
  placeAt(gs, 0, 4.4, 30.41, 0);
  const gs2 = gs.clone(); placeAt(gs2, 0, 4.4, 29.59, PI);

  // flags
  const flagTex = canvasTex(flagCanvas());
  for (const s of [-1, 1]) {
    const x = s * 6.5, z = 15;
    box(0.12, 11, 0.12, x, 5.5, z, M.white); box(0.5, 0.3, 0.5, x, 0.15, z, M.white);
    const geo = new THREE.PlaneGeometry(3, 2, 18, 8);
    const fm = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide }));
    fm.position.set(x + 1.56, 9.8, z); scene.add(fm);
    flags.push({ geo, base: Float32Array.from(geo.attributes.position.array), ph: s });
    CIRCLES.push([x, z, 0.5]);
  }
  // lamps along the path
  for (let z = 18; z <= 54; z += 9) for (const s of [-1, 1]) {
    const x = s * 3.4; box(0.12, 3.4, 0.12, x, 1.7, z, M.dark);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), M.lamp); bulb.position.set(x, 3.5, z); scene.add(bulb);
    CIRCLES.push([x, z, 0.35]);
  }
  buildLandscape();
}

/* ---- walkways, golden bamboo, fish pond ---- */
const fishes = [];
let pondWater = null;
function buildLandscape() {
  const walk = texMat(stoneCanvas("#c3b79f", "#b2a68e"), [1, 1]);
  const stripe = (x0, x1, z0, z1) => { const m = slab(x0, x1, z0, z1, 0.011, walk.clone()); m.material.map = m.material.map.clone(); m.material.map.repeat.set((x1 - x0) / 2.4, (z1 - z0) / 2.4); m.material.map.needsUpdate = true; };
  stripe(-14.2, -11.8, 12.4, 58.2); stripe(11.8, 14.2, 12.4, 58.2);   // side walkways
  stripe(-14.2, -2.5, 12.4, 14.8); stripe(2.5, 14.2, 12.4, 14.8);     // from the plaza to the walkways
  stripe(-14.2, 14.2, 55.8, 58.2);                                    // far cross path
  // spurs from the walkways to every exhibit
  for (const z of EXHIBIT_Z) { stripe(-17.2, -14.2, z - 0.9, z + 0.9); stripe(14.2, 17.2, z - 0.9, z + 0.9); }

  // golden bamboo (tre ngà): instanced culms + leaf clumps
  const spots = [];
  const line = (x0, z0, x1, z1, step) => { const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / step); for (let i = 0; i <= n; i++) spots.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]); };
  line(-30, 3, -30, 61, 2.2); line(30, 3, 30, 61, 2.2); line(-30, 62, 30, 62, 2.2);
  line(-30, 3, -23, 3, 2.2); line(23, 3, 30, 3, 2.2);
  const culmGeo = new THREE.CylinderGeometry(0.05, 0.07, 1, 6); culmGeo.translate(0, 0.5, 0);
  const culmMat = new THREE.MeshLambertMaterial({ color: 0xd9b84a });
  const leafGeo = new THREE.SphereGeometry(1, 8, 6);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x6b9a3c });
  const nC = spots.length * 9, nL = spots.length * 14;
  const culms = new THREE.InstancedMesh(culmGeo, culmMat, nC), leaves = new THREE.InstancedMesh(leafGeo, leafMat, nL);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  let ci = 0, li = 0;
  for (const [cx, cz] of spots) {
    for (let k = 0; k < 9; k++) {
      const h = 6 + rand() * 4, lean = 0.05 + rand() * 0.12, dir = rand() * PI * 2;
      p.set(cx + (rand() - 0.5) * 1.2, 0, cz + (rand() - 0.5) * 1.2);
      e.set(Math.cos(dir) * lean, 0, Math.sin(dir) * lean); q.setFromEuler(e); s.set(1, h, 1);
      culms.setMatrixAt(ci++, m4.compose(p, q, s));
    }
    for (let k = 0; k < 14; k++) {
      const a = rand() * PI * 2, r = 0.4 + rand() * 1.1;
      p.set(cx + Math.cos(a) * r, 3.2 + rand() * 5.8, cz + Math.sin(a) * r);
      s.set(0.45 + rand() * 0.4, 0.16 + rand() * 0.12, 0.45 + rand() * 0.4); e.set(0, rand() * PI, (rand() - 0.5) * 0.6); q.setFromEuler(e);
      leaves.setMatrixAt(li++, m4.compose(p, q, s));
    }
    CIRCLES.push([cx, cz, 1.0]);
  }
  scene.add(culms, leaves);

  // fish pond between the main path and the left walkway
  const px = -6.8, pz = 41.5, rx = 3.6, rz = 6;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 48), M.granite); rim.rotation.x = -H2; rim.scale.set(rx + 0.15, rz + 0.15, 3); rim.position.set(px, 0.12, pz); scene.add(rim);
  const bed = new THREE.Mesh(new THREE.CircleGeometry(1, 48), lam(0x2c4a3e)); bed.rotation.x = -H2; bed.scale.set(rx, rz, 1); bed.position.set(px, -0.25, pz); scene.add(bed);
  const wc = document.createElement("canvas"); wc.width = wc.height = 128;
  { const g = wc.getContext("2d"); g.fillStyle = "#3f7f8f"; g.fillRect(0, 0, 128, 128); g.strokeStyle = "rgba(220,240,240,0.35)"; g.lineWidth = 2;
    for (let i = 0; i < 14; i++) { g.beginPath(); g.ellipse(rand() * 128, rand() * 128, 6 + rand() * 14, 3 + rand() * 5, 0, 0, PI * 2); g.stroke(); } }
  const wtex = canvasTex(wc, [3, 5]);
  pondWater = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshLambertMaterial({ map: wtex, transparent: true, opacity: 0.42 }));
  pondWater.rotation.x = -H2; pondWater.scale.set(rx, rz, 1); pondWater.position.set(px, 0.06, pz); scene.add(pondWater);
  // lotus pads and flowers
  const pad = new THREE.CircleGeometry(0.35, 14, 0.3, PI * 2 - 0.3), padMat = new THREE.MeshLambertMaterial({ color: 0x3f7a35, side: THREE.DoubleSide });
  const petal = new THREE.ConeGeometry(0.16, 0.3, 6), petalMat = lam(0xf29fb8);
  for (let i = 0; i < 9; i++) {
    const a = rand() * PI * 2, r = 0.35 + rand() * 0.5;
    const x = px + Math.cos(a) * rx * r, z = pz + Math.sin(a) * rz * r;
    const m = new THREE.Mesh(pad, padMat); m.rotation.x = -H2; m.rotation.z = rand() * 6; m.position.set(x, 0.08, z); scene.add(m);
    if (i % 3 === 0) { const f = new THREE.Mesh(petal, petalMat); f.position.set(x, 0.24, z); f.rotation.x = PI; scene.add(f); }
  }
  // koi
  const koiMats = [lam(0xf07a2a), lam(0xf4f0e8), lam(0xe6492d), lam(0xf2b33d)];
  for (let i = 0; i < 10; i++) {
    const f = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), koiMats[i % 4]); body.scale.set(0.8, 0.55, 2.6); f.add(body);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 3), koiMats[(i + 1) % 4]); tail.rotation.x = -H2; tail.position.z = -0.32; f.add(tail);
    f.position.y = -0.02; scene.add(f);
    fishes.push({ f, tail, cx: px, cz: pz, ax: rx * (0.35 + rand() * 0.45), az: rz * (0.35 + rand() * 0.45), sp: (0.25 + rand() * 0.35) * (rand() > 0.5 ? 1 : -1), ph: rand() * 6 });
  }
  for (let a = 0; a < 16; a++) { const t = a / 16 * PI * 2; CIRCLES.push([px + Math.cos(t) * (rx - 0.6), pz + Math.sin(t) * (rz - 0.6), 1.2]); }
  CIRCLES.push([px, pz, Math.min(rx, rz)]);
  const sign = textPlane([{ text: "HỒ CÁ", size: 46, weight: 700, color: GOLD_TXT, gap: 4 }, { text: "Ao sen, cá chép", size: 30, font: UI_FONT }], 1.4, 0.55, { ppm: 260 });
  const sg = new THREE.Group(); box(0.06, 0.9, 0.06, px + rx + 0.5, 0.45, pz - 2, M.dark); sg.add(sign); sign.position.y = 1.05; placeAt(sg, px + rx + 0.5, 0, pz - 2, H2);
}
function animatePond(t, dt) {
  if (pondWater) pondWater.material.map.offset.set(t * 0.01, t * 0.006);
  for (const k of fishes) {
    const a = k.ph + t * k.sp, x = k.cx + Math.cos(a) * k.ax, z = k.cz + Math.sin(a) * k.az;
    const dx = -Math.sin(a) * k.ax * k.sp, dz = Math.cos(a) * k.az * k.sp;
    k.f.position.x = x; k.f.position.z = z; k.f.rotation.y = Math.atan2(dx, dz);
    k.tail.rotation.y = Math.sin(t * 9 + k.ph) * 0.5;
  }
}

/* ================= building ================= */
function buildBuilding() {
  const H = 9, HA = 6, r = roomMats;
  const door = (c, w, h) => ({ c, w, h });
  // facade
  wallX(0, -22.2, -12, H, M.ochre, r[0]);
  wallX(0, -12, -1.8, H, M.ochre, M.cream); wallX(0, 1.8, 12, H, M.ochre, M.cream);
  { const fm = [M.cream, M.cream, M.dark, M.dark, M.ochre, M.cream];
    const piece = (a, b, y0, y1) => box(b - a, y1 - y0, T, (a + b) / 2, (y0 + y1) / 2, 0, fm, true);
    piece(-1.8, 1.8, 4.6, 5.0); piece(-1.8, -1.2, 5.0, 7.4); piece(1.2, 1.8, 5.0, 7.4); piece(-1.8, 1.8, 7.4, H); }
  wallX(0, 12, 22.2, H, M.ochre, r[4]);
  // sides
  wallZ(-22, -12, 0, H, r[0], M.ochre); wallZ(-22, -24.2, -12, H, r[1], M.ochre);
  wallZ(22, -12, 0, H, M.ochre, r[4]); wallZ(22, -24.2, -12, H, M.ochre, r[3]);
  // back
  wallX(-24, -22.2, -12, H, r[1], M.ochre);
  wallX(-24, -12, -5, H, M.cream, M.ochre);
  wallX(-24, -5, 5, H, M.cream, r[2], [door(0, 2.4, 3.4)]);
  wallX(-24, 5, 12, H, M.cream, M.ochre);
  wallX(-24, 12, 22.2, H, r[3], M.ochre);
  // annex (room III)
  wallZ(-5, -34.2, -24, HA, r[2], M.ochre); wallZ(5, -34.2, -24, HA, M.ochre, r[2]); wallX(-34, -5.2, 5.2, HA, r[2], M.ochre);
  // hall side walls with room doors + partitions
  wallZ(-12, -12, 0, H, M.cream, r[0], [door(-6, 2.4, 3.4)]);
  wallZ(-12, -24, -12, H, M.cream, r[1], [door(-18, 2.4, 3.4)]);
  wallZ(12, -12, 0, H, r[4], M.cream, [door(-6, 2.4, 3.4)]);
  wallZ(12, -24, -12, H, r[3], M.cream, [door(-18, 2.4, 3.4)]);
  wallX(-12, -22, -12, H, r[0], r[1]);
  wallX(-12, 12, 22, H, r[4], r[3]);

  // roofs
  box(45.2, 0.4, 25.2, 0, H + 0.2, -12, M.white);
  const roof = new THREE.Mesh(prismGeo(25.2, 4.2, 45.2), M.roof); roof.rotation.y = H2; roof.position.set(-22.6, H + 0.4, -12); scene.add(roof);
  box(10.8, 0.4, 10.2, 0, HA + 0.2, -29.3, M.white);
  const roof2 = new THREE.Mesh(prismGeo(10.8, 2.6, 10.2), M.roof); roof2.position.set(0, HA + 0.4, -34.4); scene.add(roof2);

  // facade trim: plinth + cornice + pilasters
  box(44.6, 0.7, 0.3, 0, 0.35, 0.3, M.ochreDark);
  box(44.8, 0.5, 0.6, 0, H - 0.25, 0.3, M.white);
  box(44.6, 0.25, 0.3, 0, 4.9, 0.3, M.white);
  for (const x of [-21.8, -12, 12, 21.8]) box(0.7, H - 0.5, 0.3, x, (H - 0.5) / 2, 0.3, M.white);
  // windows: arched, with shutters, sills and keystones; small balconies upstairs
  const half = new THREE.CircleGeometry(0.65, 20, 0, PI);
  const halfFrame = new THREE.CircleGeometry(0.8, 20, 0, PI);
  for (const x of [-19.5, -16.5, -13.8, -10.6, 10.6, 13.8, 16.5, 19.5]) {
    for (const [y, h, upper] of [[2.3, 2.2, false], [6.4, 1.9, true]]) {
      box(1.6, h + 0.2, 0.12, x, y, 0.26, M.white);
      box(1.3, h, 0.06, x, y, 0.33, M.glass);
      const af = new THREE.Mesh(halfFrame, M.white); af.position.set(x, y + h / 2 + 0.1, 0.27); scene.add(af);
      const ag = new THREE.Mesh(half, M.glass); ag.position.set(x, y + h / 2 + 0.1, 0.34); scene.add(ag);
      box(0.07, h + 0.6, 0.06, x, y + 0.3, 0.37, M.white); box(1.3, 0.07, 0.06, x, y + 0.25, 0.37, M.white);
      for (const s of [-1, 1]) {
        const sh = box(0.62, h + 0.1, 0.08, x + s * 1.15, y, 0.32, M.shutter);
        for (let k = -3; k <= 3; k++) box(0.5, 0.03, 0.04, x + s * 1.15, y + k * h / 8, 0.38, M.shutterDark);
        sh.rotation.y = s * 0.12;
      }
      box(1.9, 0.12, 0.35, x, y - h / 2 - 0.16, 0.4, M.white);
      box(0.28, 0.32, 0.12, x, y + h / 2 + 0.88, 0.32, M.ochreDark);
      if (upper) {
        box(2.1, 0.12, 0.8, x, y - h / 2 - 0.3, 0.7, M.white);
        box(2.1, 0.08, 0.08, x, y - h / 2 + 0.55, 1.06, M.white);
        for (let k = -6; k <= 6; k++) box(0.05, 0.75, 0.05, x + k * 0.16, y - h / 2 + 0.15, 1.06, M.white);
      }
    }
  }
  // dentils under the cornice
  const dent = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.22, 0.2), M.white, 140);
  const dm = new THREE.Matrix4(); let di = 0;
  for (let x = -22; x <= 22 && di < 140; x += 0.32) { dm.makeTranslation(x, H - 0.62, 0.55); dent.setMatrixAt(di++, dm); }
  dent.count = di; scene.add(dent);
  // wooden doors folded open + lanterns
  for (const s of [-1, 1]) {
    box(1.4, 4.3, 0.1, s * 2.9, 2.2, 0.32, M.door);
    for (const y of [1.2, 3.1]) box(1.1, 1.3, 0.04, s * 2.9, y, 0.39, M.doorDark);
    box(0.32, 0.5, 0.32, s * 2.55, 3.4, 0.6, M.gold);
    const lg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.34, 0.24), M.lamp); lg.position.set(s * 2.55, 3.4, 0.6); scene.add(lg);
  }
  // portico balustrade (gap in the middle for the steps)
  for (const [a, b] of [[-9.6, -3.6], [3.6, 9.6]]) {
    box(b - a, 0.12, 0.3, (a + b) / 2, 1.05, 5.25, M.white); box(b - a, 0.12, 0.3, (a + b) / 2, 0.22, 5.25, M.white);
    for (let x = a + 0.15; x < b; x += 0.3) { const bl = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.8, 8), M.white); bl.position.set(x, 0.62, 5.25); scene.add(bl); }
    for (let x = a; x <= b + 0.01; x += 0.5) CIRCLES.push([x, 5.25, 0.35]);
  }
  // steps
  box(7.4, 0.12, 0.6, 0, 0.06, 5.7, M.white); box(8.2, 0.08, 0.6, 0, 0.04, 6.3, M.white);
  // portico
  for (const x of [-8.6, -5.8, -3, 3, 5.8, 8.6]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 7, 16), M.white); col.position.set(x, 3.66, 4.6); scene.add(col);
    box(1, 0.3, 1, x, 7.2, 4.6, M.white); box(1, 0.3, 1, x, 0.31, 4.6, M.white);
    CIRCLES.push([x, 4.6, 0.6]);
  }
  box(19.4, 0.9, 5.4, 0, 7.8, 2.7, M.white);
  const ped = new THREE.Mesh(prismGeo(19.6, 2.6, 5.4), M.white); ped.position.set(0, 8.25, 0); scene.add(ped);
  const sign = textPlane([{ text: "BẢO TÀNG LỊCH SỬ ĐẢNG CỘNG SẢN VIỆT NAM", size: 62, weight: 700, color: GOLD_TXT }], 17, 0.72, { bg: "#7a1f1b", ppm: 110 });
  placeAt(sign, 0, 7.8, 5.42, 0);
  const emblemC = document.createElement("canvas"); emblemC.width = emblemC.height = 256;
  { const g = emblemC.getContext("2d"); g.fillStyle = "#f3ede0"; g.fillRect(0, 0, 256, 256); g.fillStyle = "#c9a24a"; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill(); g.fillStyle = "#da251d"; g.beginPath(); g.arc(128, 128, 112, 0, 7); g.fill(); starPath(g, 128, 132, 80, 31); g.fillStyle = "#ffcd00"; g.fill(); }
  const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.85, 40), new THREE.MeshBasicMaterial({ map: canvasTex(emblemC) }));
  placeAt(emblem, 0, 9.25, 5.43, 0);
  // big entrance door frame
  box(0.3, 4.8, 0.5, -1.95, 2.4, 0.2, M.gold); box(0.3, 4.8, 0.5, 1.95, 2.4, 0.2, M.gold); box(4.2, 0.3, 0.5, 0, 4.75, 0.2, M.gold);
}

/* ================= statue & garden ================= */
const STATUE_EX = {
  date: "19/5/1890 – 2/9/1969", title: "Chủ tịch Hồ Chí Minh",
  text: "Lãnh tụ vĩ đại của dân tộc Việt Nam, người sáng lập Đảng Cộng sản Việt Nam (3/2/1930), khai sinh nước Việt Nam Dân chủ Cộng hòa (2/9/1945).",
  lesson: "Nguyễn Ái Quốc tìm ra con đường cứu nước theo chủ nghĩa Mác – Lênin và trực tiếp chuẩn bị về tư tưởng, chính trị, tổ chức cho sự ra đời của Đảng.",
};
function buildStatue() {
  if (!window.STATUE || window.STATUE.enabled === false) return;
  const sx = 0, sz = 11;
  const tiers = [box(4.4, 0.3, 4.4, sx, 0.15, sz, M.granite), box(3.6, 0.3, 3.6, sx, 0.45, sz, M.granite),
    box(2.4, 2.4, 2.4, sx, 1.8, sz, M.graniteDark), box(2.9, 0.3, 2.9, sx, 3.15, sz, M.granite)];
  const plq = textPlane([
    { text: "CHỦ TỊCH", size: 40, weight: 600, font: UI_FONT, color: GOLD_TXT, gap: 10 },
    { text: "HỒ CHÍ MINH", size: 64, weight: 700, color: GOLD_TXT, gap: 14 },
    { text: "1890 – 1969", size: 38, font: UI_FONT, color: "#e8dcc4" },
  ], 2.2, 1.2, { bg: "#3b3935", borderColor: "#c9a24a", ppm: 260, pad: 0.05 });
  placeAt(plq, sx, 1.85, sz + 1.21, 0);
  [...tiers, plq].forEach((m) => { m.userData.ex = STATUE_EX; interactive.push(m); });
  CIRCLES.push([sx, sz, 2.5]);
  const spot = new THREE.PointLight(0xfff0d0, 0.6, 9, 1.5); spot.position.set(sx, 7.5, sz + 2.5); scene.add(spot);

  const cfg = window.STATUE || {};
  const useImage = () => { if (cfg.image) statueFromImage(cfg, sx, sz); };
  if (!cfg.url || !THREE.GLTFLoader) { useImage(); return; }
  new THREE.GLTFLoader().load(cfg.url, (gltf) => {
    const m = gltf.scene;
    m.rotation.y = cfg.rotationY || 0;
    const b = new THREE.Box3().setFromObject(m), size = b.getSize(new THREE.Vector3());
    m.scale.setScalar((cfg.height || 3.4) / (size.y || 1));
    b.setFromObject(m);
    const c = b.getCenter(new THREE.Vector3());
    m.position.set(m.position.x + sx - c.x, m.position.y + 3.3 - b.min.y, m.position.z + sz - c.z);
    m.traverse((o) => { if (o.isMesh) { o.userData.ex = STATUE_EX; interactive.push(o); } });
    scene.add(m);
  }, undefined, useImage);
}
// Tượng từ ảnh chụp mô hình của nhóm: tách nền (loang từ mép ảnh), cắt bỏ bệ trong ảnh, dựng đứng và luôn quay về người xem.
let statueBoard = null;
// cut the statue out of a render: returns an upscaled canvas with transparent background
function cutout(img, crop, tolerance, fill, keepLargest, trim) {
  {
    const W = img.width, Hh = Math.round(img.height * (crop || 1));
    const c = document.createElement("canvas"); c.width = W; c.height = Hh;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, Hh), p = d.data;
    const bg = new Uint8Array(W * Hh), q = [];
    const tol = tolerance || 6;
    const diff = (a, b) => Math.abs(p[a] - p[b]) + Math.abs(p[a + 1] - p[b + 1]) + Math.abs(p[a + 2] - p[b + 2]);
    for (let x = 0; x < W; x++) { q.push(x, (Hh - 1) * W + x); }
    for (let y = 0; y < Hh; y++) { q.push(y * W, y * W + W - 1); }
    for (const i of q) bg[i] = 1;
    while (q.length) {
      const i = q.pop(), x = i % W, y = (i - x) / W;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= Hh) continue;
        const j = ny * W + nx; if (bg[j]) continue;
        if (diff(i * 4, j * 4) < tol) { bg[j] = 1; q.push(j); }
      }
    }
    // keep only the biggest piece (drops labels such as "36°" printed on the sheet)
    if (keepLargest) {
      const lab = new Int32Array(W * Hh); let best = 0, bestId = 0, id = 0;
      for (let s = 0; s < W * Hh; s++) {
        if (bg[s] || lab[s]) continue;
        id++; let n = 0; const st = [s]; lab[s] = id;
        while (st.length) { const i = st.pop(); n++; const x = i % W, y = (i - x) / W;
          for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < Hh - 1 ? i + W : -1]) if (j >= 0 && !bg[j] && !lab[j]) { lab[j] = id; st.push(j); } }
        if (n > best) { best = n; bestId = id; }
      }
      for (let i = 0; i < W * Hh; i++) if (!bg[i] && lab[i] !== bestId) bg[i] = 1;
    }
    // close small gaps along the outline: grow the statue R px (copying colour from its neighbours), then shrink back
    const R = fill || 4;
    const nb = (i, x, y) => [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < Hh - 1 ? i + W : -1];
    for (let k = 0; k < R; k++) {
      const grow = [];
      for (let i = 0; i < W * Hh; i++) {
        if (!bg[i]) continue;
        const x = i % W, y = (i - x) / W;
        let r = 0, gg = 0, b = 0, n = 0;
        for (const j of nb(i, x, y)) if (j >= 0 && !bg[j]) { r += p[j * 4]; gg += p[j * 4 + 1]; b += p[j * 4 + 2]; n++; }
        if (n) grow.push(i, r / n, gg / n, b / n);
      }
      for (let t = 0; t < grow.length; t += 4) { const i = grow[t]; bg[i] = 0; p[i * 4] = grow[t + 1]; p[i * 4 + 1] = grow[t + 2]; p[i * 4 + 2] = grow[t + 3]; }
    }
    for (let k = 0; k < R + (trim || 0); k++) { // undo the growth (trim > 0 also removes a background fringe)
      const shrink = [];
      for (let i = 0; i < W * Hh; i++) {
        if (bg[i]) continue;
        const x = i % W, y = (i - x) / W;
        if (x === 0 || y === 0 || x === W - 1 || y === Hh - 1 || nb(i, x, y).some((j) => j >= 0 && bg[j])) shrink.push(i);
      }
      for (const i of shrink) bg[i] = 1;
    }
    let minX = W, maxX = 0, minY = Hh, maxY = 0;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      if (bg[y * W + x]) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    // spread statue colours a few px into the background, so smoothing never pulls background colour into the edge
    const known = new Uint8Array(W * Hh); for (let i = 0; i < W * Hh; i++) known[i] = bg[i] ? 0 : 1;
    for (let k = 0; k < 4; k++) {
      const add = [];
      for (let i = 0; i < W * Hh; i++) {
        if (known[i]) continue;
        const x = i % W, y = (i - x) / W; let r = 0, gg = 0, b = 0, n = 0;
        for (const j of nb(i, x, y)) if (j >= 0 && known[j]) { r += p[j * 4]; gg += p[j * 4 + 1]; b += p[j * 4 + 2]; n++; }
        if (n) add.push(i, r / n, gg / n, b / n);
      }
      for (let t = 0; t < add.length; t += 4) { const i = add[t]; known[i] = 1; p[i * 4] = add[t + 1]; p[i * 4 + 1] = add[t + 2]; p[i * 4 + 2] = add[t + 3]; }
    }
    for (let i = 0; i < W * Hh; i++) p[i * 4 + 3] = 255;
    g.putImageData(d, 0, 0);
    // upscale x3 (colour and mask separately), then smooth the mask into a clean anti-aliased outline
    const pad = 4, S = 3, cw = maxX - minX + 1 + pad * 2, chh = maxY - minY + 1 + pad * 2, OW = cw * S, OH = chh * S;
    const out = document.createElement("canvas"); out.width = OW; out.height = OH;
    const og = out.getContext("2d"); og.imageSmoothingEnabled = true; og.imageSmoothingQuality = "high";
    og.drawImage(c, minX - pad, minY - pad, cw, chh, 0, 0, OW, OH);
    const mc = document.createElement("canvas"); mc.width = W; mc.height = Hh;
    const mctx = mc.getContext("2d"), md = mctx.createImageData(W, Hh);
    for (let i = 0; i < W * Hh; i++) { md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = 255; md.data[i * 4 + 3] = bg[i] ? 0 : 255; }
    mctx.putImageData(md, 0, 0);
    const mo = document.createElement("canvas"); mo.width = OW; mo.height = OH;
    const moc = mo.getContext("2d"); moc.imageSmoothingEnabled = true; moc.imageSmoothingQuality = "high";
    moc.drawImage(mc, minX - pad, minY - pad, cw, chh, 0, 0, OW, OH);
    const mdat = moc.getImageData(0, 0, OW, OH).data;
    let A = new Float32Array(OW * OH); for (let i = 0; i < OW * OH; i++) A[i] = mdat[i * 4 + 3] / 255;
    const rad = S * 2;
    for (let pass = 0; pass < 2; pass++) { // separable box blur, horizontal then vertical
      const T = new Float32Array(OW * OH);
      for (let y = 0; y < OH; y++) { let s = 0; const row = y * OW;
        for (let x = -rad; x < OW; x++) { if (x + rad < OW) s += A[row + x + rad]; if (x - rad - 1 >= 0) s -= A[row + x - rad - 1]; if (x >= 0) T[row + x] = s / (2 * rad + 1); } }
      for (let x = 0; x < OW; x++) { let s = 0;
        for (let y = -rad; y < OH; y++) { if (y + rad < OH) s += T[(y + rad) * OW + x]; if (y - rad - 1 >= 0) s -= T[(y - rad - 1) * OW + x]; if (y >= 0) A[y * OW + x] = s / (2 * rad + 1); } }
    }
    const od = og.getImageData(0, 0, OW, OH);
    for (let i = 0; i < OW * OH; i++) { let t = (A[i] - 0.4) / 0.2; t = t < 0 ? 0 : t > 1 ? 1 : t; od.data[i * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255); }
    og.putImageData(od, 0, 0);
    return out;
  }
}
const loadImg = (src) => new Promise((res) => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
// Statue from a turntable sheet (several views around the statue): show the view that matches where the viewer stands.
let statueSprite = null;
async function statueFromSheet(cfg, sx, sz) {
  const sheet = await loadImg(cfg.sheet);
  if (!sheet) return false;
  const h = cfg.height || 3.4, views = [];
  for (const v of cfg.views) {
    const [x, y, w, hh] = v.r, ins = 6;
    const c = document.createElement("canvas"); c.width = w - ins * 2; c.height = hh - ins * 2;
    c.getContext("2d").drawImage(sheet, x + ins, y + ins, c.width, c.height, 0, 0, c.width, c.height);
    const out = cutout(c, v.crop || cfg.sheetCrop || 0.84, cfg.sheetTolerance || 8, 2, true, cfg.sheetTrim == null ? 1 : cfg.sheetTrim);
    views.push({ a: v.a, tex: canvasTex(out), aspect: out.width / out.height });
  }
  const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
  statueSprite = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: views[0].tex, transparent: true, alphaTest: 0.03, side: THREE.DoubleSide }));
  statueSprite.userData.views = views; statueSprite.userData.h = h; statueSprite.userData.cur = -1;
  statueSprite.position.set(sx, 3.3, sz); scene.add(statueSprite);
  statueSprite.userData.ex = STATUE_EX; interactive.push(statueSprite);
  return true;
}
function updateStatueSprite() {
  const s = statueSprite; if (!s) return;
  const face = (window.STATUE && window.STATUE.faceY) || 0;
  const a = Math.atan2(camera.position.x - s.position.x, camera.position.z - s.position.z);
  s.rotation.y = a;
  const dir = (window.STATUE && window.STATUE.turn) || 1;
  const view = ((dir * -(a - face)) * 180 / PI % 360 + 360) % 360; // 0 = front, 90 = statue's right side
  let best = 0, bd = 1e9;
  s.userData.views.forEach((v, i) => { const d = Math.abs(((view - v.a + 540) % 360) - 180); if (d < bd) { bd = d; best = i; } });
  if (best !== s.userData.cur) {
    const v = s.userData.views[best]; s.userData.cur = best;
    s.material.map = v.tex; s.material.needsUpdate = true;
    s.scale.set(s.userData.h * v.aspect, s.userData.h, 1);
  }
}
async function statueFromImage(cfg, sx, sz) {
  if (cfg.sheet && await statueFromSheet(cfg, sx, sz)) return;
  const [fi, bi] = await Promise.all([loadImg(cfg.image), loadImg(cfg.backImage)]);
  if (!fi) return;
  const out = cutout(fi, cfg.cropBottom, cfg.tolerance, cfg.fill);
  // silhouette (same shape, flat silver) for the inner layers
  const sil = document.createElement("canvas"); sil.width = out.width; sil.height = out.height;
  // inner layers keep the metal shading of the front image, toned down a little
  const sg = sil.getContext("2d"); sg.drawImage(out, 0, 0); sg.globalCompositeOperation = "source-atop"; sg.fillStyle = "rgba(110,112,118,0.45)"; sg.fillRect(0, 0, sil.width, sil.height);
  // back: the real back render if given, otherwise a plain silver silhouette
  let back;
  if (bi) back = cutout(bi, cfg.backCropBottom || cfg.cropBottom, cfg.backTolerance || cfg.tolerance, cfg.fill);
  else {
    back = document.createElement("canvas"); back.width = out.width; back.height = out.height;
    const bgc = back.getContext("2d"); bgc.translate(back.width, 0); bgc.scale(-1, 1); bgc.drawImage(out, 0, 0);
    bgc.setTransform(1, 0, 0, 1, 0, 0); bgc.globalCompositeOperation = "source-atop";
    const grad = bgc.createLinearGradient(0, 0, back.width, 0); grad.addColorStop(0, "#7d7f84"); grad.addColorStop(0.5, "#a9abb0"); grad.addColorStop(1, "#7d7f84");
    bgc.fillStyle = grad; bgc.fillRect(0, 0, back.width, back.height);
  }
  // inner layers = only where front and (mirrored) back shapes overlap, so nothing pokes out
  if (bi) {
    const bw = out.height * back.width / back.height;
    sg.globalCompositeOperation = "destination-in";
    sg.save(); sg.translate(out.width / 2 + bw / 2, 0); sg.scale(-1, 1); sg.drawImage(back, 0, 0, bw, out.height); sg.restore();
  }
  const h = cfg.height || 3.4, depth = cfg.depth || 0.3, layers = 40;
  const plane = (c) => { const w = h * c.width / c.height; const g = new THREE.PlaneGeometry(w, h); g.translate(0, h / 2, 0); return g; };
  const mk = (canvasEl, side) => new THREE.MeshBasicMaterial({ map: canvasTex(canvasEl), transparent: true, alphaTest: 0.5, side });
  const geo = plane(out);
  statueBoard = new THREE.Group();
  const front = new THREE.Mesh(geo, mk(out, THREE.FrontSide)); front.position.z = depth / 2;
  const rear = new THREE.Mesh(plane(back), mk(back, THREE.FrontSide)); rear.rotation.y = PI; rear.position.z = -depth / 2;
  statueBoard.add(front, rear);
  const silMat = mk(sil, THREE.DoubleSide);
  // layers close to the front and back are slightly narrower: rounded sides instead of a flat slab
  for (let k = 1; k < layers; k++) {
    const u = (2 * k) / layers - 1;
    const m = new THREE.Mesh(geo, silMat);
    m.position.z = depth / 2 - (depth * k) / layers;
    m.scale.x = 0.93 + 0.07 * Math.sqrt(1 - u * u);
    statueBoard.add(m);
  }
  statueBoard.position.set(sx, 3.3, sz); statueBoard.rotation.y = cfg.faceY || 0; scene.add(statueBoard);
  statueBoard.traverse((o) => { if (o.isMesh) { o.userData.ex = STATUE_EX; interactive.push(o); } });
}
function buildGarden() {
  // flower beds on both sides of the plaza
  // left bed: roses, right bed: tulips (instanced stems, leaves and blossoms, colour per flower)
  const white = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.015, 1, 5); stemGeo.translate(0, 0.5, 0);
  const roseHead = new THREE.DodecahedronGeometry(0.075, 0);
  const rosePetal = new THREE.TorusGeometry(0.068, 0.028, 5, 10); rosePetal.rotateX(H2);
  const roseLeaf = new THREE.SphereGeometry(0.05, 6, 4);
  const tulipProf = [[0.0, 0], [0.05, 0.01], [0.075, 0.05], [0.08, 0.1], [0.07, 0.15], [0.055, 0.17]].map(([x, y]) => new THREE.Vector2(x, y));
  const tulipHead = new THREE.LatheGeometry(tulipProf, 8);
  const tulipLeaf = new THREE.BoxGeometry(0.05, 0.32, 0.008); tulipLeaf.translate(0, 0.16, 0);
  const ROSE = [0xc81d2a, 0xe0475e, 0xa3122a, 0xf07a93, 0xd62839], TULIP = [0xe63946, 0xf6c22b, 0xf28fb3, 0x8e5bd1, 0xf4f1ea, 0xf27b2a];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  for (const s of [-1, 1]) {
    const cx = s * 8.5, cz = 9.2, rose = s < 0;
    box(5, 0.35, 3, cx, 0.175, cz, M.white); box(4.7, 0.36, 2.7, cx, 0.18, cz, M.soil);
    const N = 150;
    const stems = new THREE.InstancedMesh(stemGeo, lam(0x3f7a35), N);
    const headMat = white(); if (!rose) headMat.side = THREE.DoubleSide;
    const heads = new THREE.InstancedMesh(rose ? roseHead : tulipHead, headMat, N);
    const rims = rose ? new THREE.InstancedMesh(rosePetal, white(), N) : null;
    const leaves = new THREE.InstancedMesh(rose ? roseLeaf : tulipLeaf, lam(rose ? 0x2f6a2c : 0x4f8f3e), N * 2);
    let i = 0, li = 0;
    for (let x = -2.15; x <= 2.15; x += 0.24) for (let z = -1.15; z <= 1.15; z += 0.24) {
      if (i >= N) break;
      const fx = cx + x + (rand() - 0.5) * 0.1, fz = cz + z + (rand() - 0.5) * 0.1, h = (rose ? 0.38 : 0.3) + rand() * 0.14, tilt = (rand() - 0.5) * 0.25;
      e.set(tilt, rand() * PI, tilt * 0.5); q.setFromEuler(e);
      stems.setMatrixAt(i, m4.compose(p.set(fx, 0.36, fz), q, sc.set(1, h, 1)));
      const top = new THREE.Vector3(0, h, 0).applyQuaternion(q).add(p.set(fx, 0.36, fz));
      e.set(rand() * 0.4, rand() * PI, rand() * 0.4); q.setFromEuler(e);
      heads.setMatrixAt(i, m4.compose(top, q, sc.set(1, rose ? 0.8 : 1, 1)));
      col.setHex((rose ? ROSE : TULIP)[Math.floor(rand() * (rose ? ROSE.length : TULIP.length))]);
      heads.setColorAt(i, col);
      if (rims) { rims.setMatrixAt(i, m4.compose(top.clone().add(new THREE.Vector3(0, -0.012, 0)), q, sc.set(1, 1, 1))); rims.setColorAt(i, col.clone().multiplyScalar(0.85)); }
      for (let k = 0; k < 2; k++) {
        const ang = rand() * PI * 2;
        if (rose) { e.set(0, ang, 0.9); q.setFromEuler(e); leaves.setMatrixAt(li++, m4.compose(p.set(fx + Math.cos(ang) * 0.04, 0.36 + h * (0.35 + k * 0.25), fz + Math.sin(ang) * 0.04), q, sc.set(1, 0.35, 1.6))); }
        else { e.set((rand() - 0.5) * 0.5, ang, (k ? 1 : -1) * 0.35); q.setFromEuler(e); leaves.setMatrixAt(li++, m4.compose(p.set(fx, 0.36, fz), q, sc.set(1, 0.8 + rand() * 0.4, 1))); }
      }
      i++;
    }
    for (const im of [stems, heads, rims]) if (im) { im.count = i; if (im.instanceColor) im.instanceColor.needsUpdate = true; scene.add(im); }
    leaves.count = li; scene.add(leaves);
    const label = textPlane([{ text: rose ? "Vườn hoa hồng" : "Vườn hoa tulip", size: 40, weight: 700, color: GOLD_TXT }], 1.6, 0.32, { ppm: 240 });
    placeAt(label, cx, 0.2, cz + 1.52, 0);
    for (let x = -2.5; x <= 2.5; x += 0.8) for (const z of [-1.5, 0, 1.5]) CIRCLES.push([cx + x, cz + z, 0.6]);
    // benches facing the path
    for (const bz of [19, 25]) {
      const bx = s * 4.6;
      box(0.6, 0.08, 2, bx, 0.5, bz, M.wood); box(0.08, 0.5, 2, bx + s * 0.28, 0.8, bz, M.wood);
      for (const dz of [-0.8, 0.8]) box(0.5, 0.5, 0.1, bx, 0.25, bz + dz, M.dark);
      CIRCLES.push([bx, bz - 0.6, 0.5], [bx, bz + 0.6, 0.5]);
    }
    // low hedge along the facade
    box(7.6, 0.8, 0.8, s * 16, 0.4, 1.4, M.hedge);
    for (let x = 12.4; x <= 19.8; x += 0.8) CIRCLES.push([s * x, 1.4, 0.6]);
  }
}

/* ================= outdoor exhibits: tank & aircraft ================= */
const TANK_EX = {
  date: "30/4/1975", title: "Xe tăng T-54 (số 390)",
  text: "Trưa 30/4/1975, các xe tăng 843 và 390 của Lữ đoàn xe tăng 203 tiến vào Dinh Độc Lập; xe tăng 390 húc đổ cổng chính. Chính quyền Sài Gòn tuyên bố đầu hàng không điều kiện, miền Nam hoàn toàn giải phóng.",
  lesson: "Thắng lợi của Tổng tiến công và nổi dậy mùa Xuân 1975, kết thúc 21 năm kháng chiến chống Mỹ, cứu nước.",
};
const MIG_EX = {
  date: "12/1972", title: "Máy bay tiêm kích MiG-21",
  text: "Loại máy bay chủ lực của Không quân nhân dân Việt Nam. Trong 12 ngày đêm cuối năm 1972, quân dân miền Bắc đánh bại cuộc tập kích chiến lược bằng B-52 của Mỹ; đêm 27/12/1972, phi công Phạm Tuân lái MiG-21 bắn rơi một chiếc B-52.",
  lesson: "Chiến thắng “Hà Nội – Điện Biên Phủ trên không” buộc Mỹ ký Hiệp định Paris (27/1/1973).",
};
function exhibitBase(x, z, w, d, ex, ry) {
  if (ry && Math.abs(Math.sin(ry)) > 0.7) { const t = w; w = d; d = t; }
  const base = box(w, 0.3, d, x, 0.15, z, M.granite);
  base.userData.ex = ex; interactive.push(base);
  for (let a = -w / 2; a <= w / 2 + 0.01; a += 1) for (const b of [-d / 2, d / 2]) CIRCLES.push([x + a, z + b, 0.7]);
  for (let b = -d / 2; b <= d / 2 + 0.01; b += 1) for (const a of [-w / 2, w / 2]) CIRCLES.push([x + a, z + b, 0.7]);
  CIRCLES.push([x, z, Math.min(w, d) / 2]);
}
function exhibitSign(x, z, ry, ex) {
  box(0.08, 1.1, 0.08, x - 0.6, 0.55, z, M.dark); box(0.08, 1.1, 0.08, x + 0.6, 0.55, z, M.dark);
  const s = textPlane([
    { text: ex.date, size: 34, weight: 600, font: UI_FONT, color: GOLD_TXT, gap: 6 },
    { text: ex.title, size: 46, weight: 700 },
  ], 1.6, 0.6, { ppm: 300 });
  const g = new THREE.Group(); g.add(s); s.position.y = 1.2; placeAt(g, x, 0, z, ry);
  s.userData.ex = ex; interactive.push(s);
}
function tagAll(group, ex) { group.traverse((o) => { if (o.isMesh) { o.userData.ex = ex; interactive.push(o); } }); }

function buildTank(x, z, ry) {
  exhibitBase(x, z, 9, 5.5, TANK_EX, ry);
  const olive = lam(0x4d5a36), oliveDark = lam(0x3b4629), track = lam(0x2b2b28), wheel = lam(0x55603d);
  const g = new THREE.Group();
  const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); g.add(m); return m; };
  // hull with a sloped glacis (side profile extruded across the width)
  const hp = new THREE.Shape();
  hp.moveTo(-3.1, 0); hp.lineTo(2.4, 0); hp.lineTo(3.2, 0.55); hp.lineTo(2.3, 1.05); hp.lineTo(-3.0, 1.05); hp.lineTo(-3.1, 0.7); hp.lineTo(-3.1, 0);
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(hp, { depth: 2.2, bevelEnabled: false }), olive);
  hull.position.set(0, 0.75, -1.1); g.add(hull);
  // tracks, fenders and road wheels
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(6.4, 0.95, 0.6), track, 0, 0.78, s * 1.45);
    add(new THREE.BoxGeometry(6.6, 0.08, 0.75), oliveDark, 0, 1.3, s * 1.45);
    for (let k = 0; k < 5; k++) { const w = add(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 18), wheel, -2.2 + k * 1.05, 0.72, s * 1.78); w.rotation.x = H2; }
    for (const ex of [-2.95, 2.9]) { const w = add(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 14), wheel, ex, 0.95, s * 1.78); w.rotation.x = H2; }
  }
  // turret, cupola, gun
  const tur = add(new THREE.SphereGeometry(1.25, 28, 14, 0, PI * 2, 0, PI / 2), olive, -0.3, 1.78, 0); tur.scale.set(1.05, 0.62, 1);
  add(new THREE.CylinderGeometry(0.3, 0.32, 0.25, 16), oliveDark, -0.8, 2.6, 0.45);
  const mantlet = add(new THREE.SphereGeometry(0.38, 16, 10), oliveDark, 0.85, 2.12, 0); mantlet.scale.set(0.8, 0.7, 1);
  const gun = add(new THREE.CylinderGeometry(0.09, 0.11, 4.2, 14), oliveDark, 3.0, 2.15, 0); gun.rotation.z = -H2 + 0.03;
  const evac = add(new THREE.CylinderGeometry(0.15, 0.15, 0.45, 14), oliveDark, 3.4, 2.16, 0); evac.rotation.z = -H2 + 0.03;
  // number 390 on both sides of the turret
  const nc = textCanvas([{ text: "390", size: 120, weight: 700, font: UI_FONT, color: "#f1ead8" }], 1, 0.5, { bg: "#4d5a36", border: false, ppm: 300 });
  const nt = canvasTex(nc);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshLambertMaterial({ map: nt })); p.position.set(-0.3, 1.98, s * 1.27); p.rotation.y = s > 0 ? 0 : PI; p.rotation.x = -0.25; g.add(p); }
  g.position.set(x, 0.3, z); g.rotation.y = ry; scene.add(g);
  tagAll(g, TANK_EX);
}

function buildMig(x, z, ry) {
  exhibitBase(x, z, 8, 10, MIG_EX, ry);
  const metal = new THREE.MeshPhongMaterial({ color: 0xaeb3b9, shininess: 60, specular: 0x555555 });
  const dark = lam(0x3a3f44), glass = new THREE.MeshPhongMaterial({ color: 0x2c4a63, shininess: 90, transparent: true, opacity: 0.8 });
  const g = new THREE.Group();
  const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); g.add(m); return m; };
  // fuselage along +z (nose at +z)
  const body = add(new THREE.CylinderGeometry(0.62, 0.55, 10, 24), metal, 0, 1.9, 0); body.rotation.x = H2;
  const nose = add(new THREE.CylinderGeometry(0.62, 0.5, 1.2, 24, 1, true), metal, 0, 1.9, 5.6); nose.rotation.x = H2;
  const cone = add(new THREE.ConeGeometry(0.28, 1.1, 18), dark, 0, 1.9, 6.4); cone.rotation.x = H2; // intake shock cone
  const ring = add(new THREE.CircleGeometry(0.5, 24), dark, 0, 1.9, 6.18);
  const nozzle = add(new THREE.CylinderGeometry(0.5, 0.45, 0.6, 20), dark, 0, 1.9, -5.25); nozzle.rotation.x = H2;
  const spine = add(new THREE.BoxGeometry(0.35, 0.45, 5.5), metal, 0, 2.5, 0.8);
  const canopy = add(new THREE.SphereGeometry(0.42, 18, 12), glass, 0, 2.55, 3.4); canopy.scale.set(0.8, 0.75, 2.1);
  // delta wings
  const wing = new THREE.Shape(); wing.moveTo(0, 1.6); wing.lineTo(3.6, -1.6); wing.lineTo(3.6, -2.3); wing.lineTo(0, -2.3); wing.lineTo(0, 1.6);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.ExtrudeGeometry(wing, { depth: 0.08, bevelEnabled: false }), metal);
    w.rotation.x = -H2; w.scale.x = s; w.position.set(0, 1.75, -0.2); g.add(w);
    const st = new THREE.Mesh(new THREE.ExtrudeGeometry(wing, { depth: 0.06, bevelEnabled: false }), metal);
    st.rotation.x = -H2; st.scale.set(s * 0.45, 0.45, 1); st.position.set(0, 1.85, -4.3); g.add(st);
  }
  // tail fin
  const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(-2.6, 0); fin.lineTo(-3.4, 2.4); fin.lineTo(-2.5, 2.4); fin.lineTo(0, 0);
  const fm = new THREE.Mesh(new THREE.ExtrudeGeometry(fin, { depth: 0.1, bevelEnabled: false }), metal);
  fm.rotation.y = -H2; fm.position.set(-0.05, 2.35, -1.6); g.add(fm);
  // star insignia on the fin and wings
  const ic = document.createElement("canvas"); ic.width = ic.height = 128;
  { const c = ic.getContext("2d"); c.fillStyle = "#ffcd00"; c.beginPath(); c.arc(64, 64, 62, 0, 7); c.fill(); c.fillStyle = "#da251d"; c.beginPath(); c.arc(64, 64, 52, 0, 7); c.fill(); starPath(c, 64, 67, 40, 16); c.fillStyle = "#ffcd00"; c.fill(); }
  const im = new THREE.MeshBasicMaterial({ map: canvasTex(ic), transparent: true });
  for (const s of [-1, 1]) {
    const f = add(new THREE.CircleGeometry(0.45, 24), im, s * 0.11, 3.5, -4.4); f.rotation.y = s * H2;
    const w = add(new THREE.CircleGeometry(0.5, 24), im, s * 2.2, 1.84, -1.4); w.rotation.x = -H2;
  }
  // landing gear
  for (const [gx, gz] of [[0, 4.2], [-1.4, -0.9], [1.4, -0.9]]) {
    add(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), dark, gx, 0.9, gz);
    const w = add(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 16), dark, gx, 0.32, gz); w.rotation.z = H2;
  }
  g.position.set(x, 0.3, z); g.rotation.y = ry; scene.add(g);
  tagAll(g, MIG_EX);
}
/* ---- more outdoor exhibits (simple low-poly shapes) ---- */
const OUT_EX = {
  xe_tang_390: TANK_EX, mig21: MIG_EX,
  phao_cao_xa_37: { date: "1954", title: "Pháo cao xạ 37 mm",
    text: "Pháo cao xạ 37 mm lần đầu được bộ đội ta sử dụng trong chiến dịch Điện Biên Phủ, cùng các lực lượng phòng không khống chế bầu trời lòng chảo, hạn chế tiếp tế đường không của địch.",
    lesson: "Sự phát triển của lực lượng vũ trang dưới sự lãnh đạo của Đảng trong kháng chiến chống Pháp." },
  luu_phao_105: { date: "1/1954", title: "Lựu pháo 105 mm",
    text: "Bộ đội ta kéo lựu pháo 105 mm bằng sức người vượt núi cao, vào trận địa trên các sườn núi bao quanh lòng chảo Điện Biên Phủ.",
    lesson: "Phương châm “đánh chắc, tiến chắc” và tinh thần kháng chiến toàn dân." },
  sung_coi_120: { date: "1954", title: "Súng cối 120 mm",
    text: "Súng cối cùng lựu pháo tạo thành hỏa lực pháo binh chế áp các cứ điểm của tập đoàn cứ điểm Điện Biên Phủ.",
    lesson: "Sức mạnh tổng hợp của các binh chủng trong chiến dịch lớn." },
  xe_dap_tho: { date: "1954", title: "Xe đạp thồ",
    text: "Hơn 20.000 xe đạp thồ cùng hàng chục vạn dân công vận chuyển lương thực, đạn dược phục vụ chiến dịch Điện Biên Phủ.",
    lesson: "Đường lối kháng chiến toàn dân, dựa vào sức mình là chính." },
  pt76: { date: "6 – 7/2/1968", title: "Xe tăng PT-76",
    text: "Trận Làng Vây (Quảng Trị) là trận đầu tiên bộ đội xe tăng Việt Nam phối hợp với bộ binh tiến công, tiêu diệt cứ điểm Làng Vây.",
    lesson: "Sự trưởng thành của Quân đội nhân dân trong kháng chiến chống Mỹ." },
  xe_tai_truong_son: { date: "1959 – 1975", title: "Xe vận tải Trường Sơn",
    text: "Hàng vạn lượt xe vận tải chở vũ khí, lương thực trên tuyến đường Trường Sơn, chi viện cho chiến trường miền Nam.",
    lesson: "Miền Bắc là hậu phương lớn, miền Nam là tiền tuyến lớn." },
  sam2: { date: "18 – 29/12/1972", title: "Tên lửa phòng không SAM-2",
    text: "Trong 12 ngày đêm cuối năm 1972, bộ đội tên lửa phòng không dùng tên lửa SAM-2 là vũ khí chủ lực đánh trả cuộc tập kích chiến lược bằng B-52 của Mỹ.",
    lesson: "Chiến thắng “Hà Nội – Điện Biên Phủ trên không”." },
  xac_b52: { date: "27/12/1972", title: "Xác máy bay B-52",
    text: "Một chiếc B-52 bị bắn rơi xuống hồ Hữu Tiệp (Hà Nội) đêm 27/12/1972; phần xác máy bay vẫn còn nằm giữa hồ đến ngày nay.",
    lesson: "Ý chí độc lập, tự chủ và sức mạnh của chiến tranh nhân dân." },
  phao_130: { date: "1972 – 1975", title: "Pháo 130 mm",
    text: "Pháo 130 mm có tầm bắn xa, được sử dụng trong các chiến dịch lớn những năm 1972 – 1975, trong đó có Chiến dịch Hồ Chí Minh.",
    lesson: "Sức mạnh tổng hợp trong cuộc Tổng tiến công và nổi dậy mùa Xuân 1975." },
  f5e: { date: "8/4/1975", title: "Máy bay F-5E",
    text: "Ngày 8/4/1975, phi công Nguyễn Thành Trung lái máy bay F-5E ném bom Dinh Độc Lập, góp phần làm rung chuyển chính quyền Sài Gòn.",
    lesson: "Kết hợp đấu tranh quân sự với binh vận trong Tổng tiến công 1975." },
};
const olive = lam(0x4d5a36), oliveDark = lam(0x3b4629), steel = lam(0x55595c), tyre = lam(0x232323);
function grp(x, z, ry, key, baseW, baseD) {
  exhibitBase(x, z, baseW, baseD, OUT_EX[key], ry);
  const g = new THREE.Group(); g.position.set(x, 0.3, z); g.rotation.y = ry; scene.add(g);
  g.userData.key = key; return g;
}
function part(g, geo, mat, x, y, z, rx, ry, rz) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0); g.add(m); return m; }
const cyl = (r1, r2, h, s) => new THREE.CylinderGeometry(r1, r2, h, s || 14);
const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function wheelPair(g, x, z, r, w, mat) { for (const s of [-1, 1]) part(g, cyl(r, r, w, 18), mat || tyre, x, r, s * z, H2, 0, 0); }

function buildAA37(x, z, ry) {
  const g = grp(x, z, ry, "phao_cao_xa_37", 6, 6);
  for (let k = 0; k < 4; k++) part(g, bx(4.2, 0.15, 0.3), oliveDark, 0, 0.25, 0, 0, k * H2 + PI / 4, 0);
  part(g, cyl(0.8, 0.9, 0.5), olive, 0, 0.55, 0);
  part(g, bx(1.2, 0.9, 1.0), olive, 0, 1.2, 0);
  const b = part(g, cyl(0.07, 0.09, 2.8), steel, 0.9, 2.3, 0, 0, 0, -0.75);
  part(g, cyl(0.13, 0.13, 0.5), steel, 0.25, 1.65, 0, 0, 0, -0.75);
  part(g, bx(0.8, 0.6, 0.1), olive, 0.3, 1.7, 0.55); part(g, bx(0.8, 0.6, 0.1), olive, 0.3, 1.7, -0.55);
  for (const s of [-1, 1]) part(g, bx(0.4, 0.06, 0.4), steel, -0.4, 1.5, s * 0.75);
  return b;
}
function buildFieldGun(x, z, ry, key, barrel, wheelR, shieldH) {
  const g = grp(x, z, ry, key, 3.4 + barrel * 0.9, 4.6);
  wheelPair(g, 0, 0.95, wheelR, 0.3);
  part(g, bx(0.6, 0.4, 1.6), olive, 0, wheelR + 0.1, 0);
  for (const s of [-1, 1]) part(g, bx(3.2, 0.18, 0.18), olive, -1.7, 0.4, s * 0.45, 0, s * 0.25, 0.12);
  part(g, cyl(0.12, 0.16, barrel), oliveDark, barrel / 2 - 0.2, wheelR + 0.55, 0, 0, 0, -H2 + 0.12);
  part(g, cyl(0.22, 0.22, 0.9), oliveDark, 0, wheelR + 0.5, 0, 0, 0, -H2 + 0.12);
  if (shieldH) part(g, bx(0.08, shieldH, 1.9), olive, 0.25, wheelR + 0.6, 0);
}
function buildMortar(x, z, ry) {
  const g = grp(x, z, ry, "sung_coi_120", 4.5, 4.5);
  part(g, cyl(0.55, 0.6, 0.12, 20), steel, -0.6, 0.06, 0);
  part(g, cyl(0.1, 0.1, 1.9), oliveDark, 0.05, 0.9, 0, 0, 0, -0.65);
  for (const s of [-1, 1]) part(g, cyl(0.035, 0.035, 1.25, 8), steel, 0.65, 0.6, s * 0.3, s * 0.35, 0, 0.15);
  wheelPair(g, -1.6, 0.6, 0.4, 0.15, tyre);
}
function buildBicycle(x, z, ry) {
  const g = grp(x, z, ry, "xe_dap_tho", 3.6, 2.6);
  const frame = lam(0x2b3a2f), sack = lam(0xb59a6a);
  for (const wx of [-0.55, 0.55]) part(g, new THREE.TorusGeometry(0.34, 0.03, 8, 24), tyre, wx, 0.36, 0);
  part(g, cyl(0.025, 0.025, 1.1, 8), frame, 0, 0.62, 0, 0, 0, H2);
  part(g, cyl(0.025, 0.025, 0.6, 8), frame, -0.2, 0.5, 0, 0, 0, 0.6);
  part(g, cyl(0.025, 0.025, 0.7, 8), frame, 0.55, 0.65, 0, 0, 0, 0.25);
  part(g, cyl(0.02, 0.02, 0.6, 8), frame, 0.62, 0.98, 0, H2, 0, 0);
  part(g, bx(1.2, 0.04, 0.3), frame, -0.15, 0.75, 0);
  // the long wooden pole used to steer a loaded bicycle
  part(g, cyl(0.025, 0.025, 1.3, 8), lam(0x6b4a2b), -0.9, 1.05, 0.1, 0, 0, -0.9);
  for (const s of [-1, 1]) { const b = part(g, new THREE.SphereGeometry(0.32, 12, 10), sack, -0.05, 0.85, s * 0.3); b.scale.set(1.5, 0.95, 0.75); }
  const top = part(g, new THREE.SphereGeometry(0.3, 12, 10), sack, -0.05, 1.25, 0); top.scale.set(1.6, 0.7, 1);
}
function buildPT76(x, z, ry) {
  const g = grp(x, z, ry, "pt76", 8, 5);
  part(g, bx(6.6, 0.9, 2.8), olive, 0, 0.95, 0);
  part(g, bx(1.2, 0.5, 2.8), olive, 3.4, 0.85, 0, 0, 0, 0.6);
  for (const s of [-1, 1]) {
    part(g, bx(6.4, 0.75, 0.45), tyre, 0, 0.55, s * 1.5);
    for (let k = 0; k < 6; k++) part(g, cyl(0.33, 0.33, 0.2, 16), oliveDark, -2.5 + k * 1.0, 0.5, s * 1.75, H2, 0, 0);
  }
  const t = part(g, cyl(0.85, 1.1, 0.6, 20), olive, 0.4, 1.7, 0);
  part(g, cyl(0.07, 0.08, 3.0), oliveDark, 2.3, 1.75, 0, 0, 0, -H2);
  part(g, cyl(0.18, 0.18, 0.2), oliveDark, 3.8, 1.75, 0, 0, 0, -H2);
}
function buildTruck(x, z, ry) {
  const g = grp(x, z, ry, "xe_tai_truong_son", 9, 4.5);
  const green = lam(0x3f5a3a), canvas = lam(0x5d6b43), leaf = lam(0x2f5a2a);
  part(g, bx(1.6, 1.1, 2.3), green, 2.2, 1.6, 0); // cab
  part(g, bx(1.1, 0.8, 2.0), green, 3.4, 1.35, 0); // hood
  part(g, bx(1.45, 0.6, 2.1), lam(0x223038), 2.15, 1.85, 0); // windows band
  part(g, bx(4.2, 0.5, 2.4), green, -0.9, 1.15, 0); // bed
  const cover = part(g, new THREE.CylinderGeometry(1.2, 1.2, 4.2, 18, 1, false, 0, PI), canvas, -0.9, 1.4, 0, 0, 0, H2); cover.rotation.set(H2, 0, H2);
  part(g, bx(6.6, 0.25, 1.2), tyre, 0.2, 0.75, 0);
  for (const wx of [3.0, -0.6, -1.9]) wheelPair(g, wx, 1.05, 0.55, 0.35);
  for (let k = 0; k < 9; k++) { const l = part(g, new THREE.ConeGeometry(0.35, 0.8, 6), leaf, -2.6 + rand() * 4, 2.55, (rand() - 0.5) * 1.8); l.rotation.z = (rand() - 0.5); }
}
function buildSam2(x, z, ry) {
  const g = grp(x, z, ry, "sam2", 11, 5.5);
  part(g, cyl(1.3, 1.5, 0.5, 20), olive, 0, 0.25, 0);
  for (let k = 0; k < 4; k++) part(g, bx(4.6, 0.2, 0.35), oliveDark, 0, 0.15, 0, 0, k * H2 + PI / 4, 0);
  part(g, bx(1.4, 1.2, 1.0), olive, 0, 1.0, 0);
  const rail = new THREE.Group(); rail.position.set(0, 1.6, 0); rail.rotation.z = 0.55; g.add(rail);
  part(rail, bx(7.5, 0.2, 0.3), oliveDark, 1.2, 0, 0);
  const white = lam(0xdfe1dc), dark = lam(0x55604a);
  part(rail, cyl(0.25, 0.25, 6.4, 18), white, 2.2, 0.55, 0, 0, 0, -H2);
  part(rail, new THREE.ConeGeometry(0.25, 1.2, 18), white, 6.0, 0.55, 0, 0, 0, -H2);
  part(rail, cyl(0.33, 0.33, 2.8, 18), dark, -2.2, 0.55, 0, 0, 0, -H2);
  for (let k = 0; k < 4; k++) {
    const a = k * H2 + PI / 4;
    const f = part(rail, bx(0.9, 0.04, 1.3), dark, -3.0, 0.55 + Math.sin(a) * 0.6, Math.cos(a) * 0.6); f.rotation.x = a;
    const f2 = part(rail, bx(0.6, 0.03, 0.7), white, 3.6, 0.55 + Math.sin(a) * 0.4, Math.cos(a) * 0.4); f2.rotation.x = a;
  }
}
function buildB52Wreck(x, z, ry) {
  const g = grp(x, z, ry, "xac_b52", 8, 8);
  const grey = lam(0x6a6e70), rust = lam(0x5a4636);
  const body = part(g, new THREE.CylinderGeometry(1.2, 1.25, 4.5, 16, 1, true), grey, 0, 1.1, 0, 0, 0, H2 - 0.08);
  body.material = body.material.clone(); body.material.side = THREE.DoubleSide;
  const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(-3.2, 0); fin.lineTo(-4.4, 5.2); fin.lineTo(-2.6, 5.2); fin.lineTo(0, 0);
  part(g, new THREE.ExtrudeGeometry(fin, { depth: 0.18, bevelEnabled: false }), grey, 1.6, 1.8, -0.09, 0, 0, 0.12);
  for (let k = 0; k < 7; k++) part(g, bx(0.6 + rand() * 1.4, 0.1, 0.4 + rand() * 1.2), rand() > 0.5 ? grey : rust, (rand() - 0.5) * 7, 0.08, (rand() - 0.5) * 7, 0, rand() * PI, (rand() - 0.5) * 0.3);
  part(g, bx(3.2, 0.12, 1.4), grey, -2.6, 0.35, 2.2, 0.25, 0.4, 0.1);
}
function buildF5E(x, z, ry) {
  const g = grp(x, z, ry, "f5e", 7, 10);
  const camo = lam(0x6f7559), camo2 = lam(0x8a7a55), dark = lam(0x2f3336), glass = new THREE.MeshPhongMaterial({ color: 0x2c4a63, shininess: 90 });
  part(g, cyl(0.55, 0.5, 8.5, 18), camo, 0, 1.6, 0, H2, 0, 0);
  part(g, new THREE.ConeGeometry(0.55, 2.4, 18), camo2, 0, 1.6, 5.4, H2, 0, 0);
  const can = part(g, new THREE.SphereGeometry(0.38, 14, 10), glass, 0, 2.15, 3.2); can.scale.set(0.8, 0.7, 2);
  for (const s of [-1, 1]) {
    part(g, bx(0.45, 0.6, 1.6), camo, s * 0.65, 1.5, 2.0); // side intakes
    const wing = new THREE.Shape(); wing.moveTo(0, 1.2); wing.lineTo(3.4, -0.6); wing.lineTo(3.4, -1.3); wing.lineTo(0, -1.6); wing.lineTo(0, 1.2);
    const w = new THREE.Mesh(new THREE.ExtrudeGeometry(wing, { depth: 0.07, bevelEnabled: false }), camo2); w.rotation.x = -H2; w.scale.x = s; w.position.set(0, 1.45, -0.6); g.add(w);
    const st = new THREE.Mesh(new THREE.ExtrudeGeometry(wing, { depth: 0.05, bevelEnabled: false }), camo); st.rotation.x = -H2; st.scale.set(s * 0.5, 0.5, 1); st.position.set(0, 1.55, -3.9); g.add(st);
    part(g, cyl(0.25, 0.25, 0.4, 14), dark, s * 0.28, 1.6, -4.4, H2, 0, 0);
  }
  const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(-2.4, 0); fin.lineTo(-3.0, 2.0); fin.lineTo(-2.2, 2.0); fin.lineTo(0, 0);
  const fm = new THREE.Mesh(new THREE.ExtrudeGeometry(fin, { depth: 0.09, bevelEnabled: false }), camo); fm.rotation.y = -H2; fm.position.set(-0.05, 2.0, -1.8); g.add(fm);
  for (const [gx, gz] of [[0, 3.8], [-1.1, -0.9], [1.1, -0.9]]) { part(g, cyl(0.05, 0.05, 1.0, 8), dark, gx, 0.8, gz); part(g, cyl(0.28, 0.28, 0.18, 14), tyre, gx, 0.28, gz, 0, 0, H2); }
}

/* ---- signs with a real photo (photos + verified texts from images/hien_vat/credits.json) ---- */
const photoSigns = [];
function drawSign(sign, img) {
  const ex = sign.ex || OUT_EX[sign.key], c = sign.canvas, g = c.getContext("2d");
  const W = c.width, H = c.height;
  g.fillStyle = "#1c1511"; g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(201,162,74,0.9)"; g.lineWidth = 6; g.strokeRect(8, 8, W - 16, H - 16);
  const ph = H * 0.56, pw = W - 48;
  if (img) {
    const s = Math.max(pw / img.width, ph / img.height), sw = pw / s, sh = ph / s;
    g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 24, 24, pw, ph);
  } else { g.fillStyle = "#2a201a"; g.fillRect(24, 24, pw, ph); g.fillStyle = "#b9ab94"; g.font = `500 26px ${UI_FONT}`; g.textAlign = "center"; g.fillText("Ảnh tư liệu", W / 2, 24 + ph / 2); }
  g.textAlign = "left"; g.textBaseline = "top";
  let y = ph + 44;
  g.fillStyle = GOLD_TXT; g.font = `600 30px ${UI_FONT}`; g.fillText((sign.n ? "Điểm " + sign.n + " · " : "") + ex.date, 28, y); y += 44;
  g.fillStyle = "#f3ead8"; g.font = `700 44px ${SERIF}`;
  for (const l of wrapLines(g, ex.title, W - 56)) { g.fillText(l, 28, y); y += 54; }
  if (ex.credit) { g.fillStyle = "#9c8f7a"; g.font = `400 18px ${UI_FONT}`; for (const l of wrapLines(g, "Ảnh: " + ex.credit, W - 56).slice(0, 2)) { g.fillText(l, 28, H - 58 + (y > H - 60 ? 0 : 0)); break; } }
  if (y > H - 62) textIssue("biển ảnh: tên đè lên dòng nguồn ảnh", ex.title);
  sign.tex.needsUpdate = true;
}
function photoSign(key, x, z, ry, n) {
  const c = document.createElement("canvas"); c.width = 600; c.height = 760;
  const tex = canvasTex(c);
  const g = new THREE.Group(); placeAt(g, x, 0, z, ry);
  for (const s of [-1, 1]) part(g, cyl(0.04, 0.04, 1.2, 8), M.dark, s * 0.6, 0.6, -0.02);
  const board = part(g, new THREE.PlaneGeometry(1.5, 1.9), new THREE.MeshBasicMaterial({ map: tex }), 0, 2.05, 0);
  const backB = part(g, bx(1.56, 1.96, 0.04), M.dark, 0, 2.05, -0.03);
  board.userData.ex = OUT_EX[key]; backB.userData.ex = OUT_EX[key]; interactive.push(board, backB);
  CIRCLES.push([x, z, 0.5]);
  const sign = { key, canvas: c, tex, n }; photoSigns.push(sign); drawSign(sign, null);
}
async function loadExhibitCredits() {
  let list = [];
  try { const r = await fetch("images/hien_vat/credits.json", { cache: "no-store" }); if (r.ok) list = await r.json(); } catch (e) {}
  for (const it of Array.isArray(list) ? list : []) {
    const ex = OUT_EX[it.key]; if (!ex) continue;
    for (const f of ["date", "title", "text", "lesson", "credit"]) if (typeof it[f] === "string" && it[f].trim()) ex[f] = it[f].trim();
    if (it.file) ex.photo = "images/hien_vat/" + it.file;
  }
  for (const s of photoSigns) {
    const ex = OUT_EX[s.key];
    if (!ex.photo) { drawSign(s, null); continue; }
    const im = await loadImg(ex.photo); drawSign(s, im);
  }
}

// Tour order: left walkway goes away from the building (1954 → 1968), the far cross path, then the right walkway comes back (1972 → 30/4/1975).
const EXHIBIT_Z = [15, 23, 31, 39, 47, 55];
function buildVehicles() {
  const L = -22.5, R = 22.5, Z = EXHIBIT_Z;
  const signL = (key, z, n) => photoSign(key, -15.4, z + 2.3, H2, n);
  const signR = (key, z, n) => photoSign(key, 15.4, z - 2.3, -H2, n);
  buildAA37(L, Z[0], 0);                                       signL("phao_cao_xa_37", Z[0], 1);
  buildFieldGun(L, Z[1], 0, "luu_phao_105", 2.6, 0.55, 1.1);   signL("luu_phao_105", Z[1], 2);
  buildMortar(L, Z[2], 0);                                     signL("sung_coi_120", Z[2], 3);
  buildBicycle(L, Z[3], 0);                                    signL("xe_dap_tho", Z[3], 4);
  buildTruck(L, Z[4], 0);                                      signL("xe_tai_truong_son", Z[4], 5);
  buildPT76(L, Z[5], 0);                                       signL("pt76", Z[5], 6);
  buildSam2(R, Z[5], PI);                                      signR("sam2", Z[5], 7);
  buildMig(R, Z[4], -H2);                                      signR("mig21", Z[4], 8);
  buildB52Wreck(R, Z[3], 0.3);                                 signR("xac_b52", Z[3], 9);
  buildF5E(R, Z[2], -H2);                                      signR("f5e", Z[2], 10);
  buildFieldGun(R, Z[1], PI, "phao_130", 5.2, 0.6, 1.2);       signR("phao_130", Z[1], 11);
  buildTank(R, Z[0], PI);                                      signR("xe_tang_390", Z[0], 12);
  loadExhibitCredits();
}

/* ================= interior ================= */
function buildHall() {
  slab(-12, 12, -24, 0, 0.01, new THREE.MeshPhongMaterial({ map: canvasTex(marbleCanvas(), [12, 12]), shininess: 60, specular: 0x2a2418 }));
  slab(-12, 12, -24, 0, 8, M.ceiling, false);
  for (const [x, z] of [[0, -4], [0, -12], [0, -20]]) { const l = new THREE.PointLight(0xffd29a, 0.5, 20, 1.6); l.position.set(x, 6.2, z); scene.add(l); }
  decorateHall();
  // skirting
  box(0.06, 0.2, 24, -11.77, 0.1, -12, M.gold); box(0.06, 0.2, 24, 11.77, 0.1, -12, M.gold); box(24, 0.2, 0.06, 0, 0.1, -23.77, M.gold);

  // centerpiece: gold star on a plinth
  const cp = DATA.hall.centerpiece;
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.35, 1.1, 32), M.wood); plinth.position.set(0, 0.55, -12); scene.add(plinth);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.08, 32), M.gold); rim.position.set(0, 1.12, -12); scene.add(rim);
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = PI / 2 + i * PI / 5, rr = i % 2 ? 0.42 : 1; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  const sg = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 }); sg.center();
  const star = new THREE.Mesh(sg, new THREE.MeshPhongMaterial({ color: 0xf2c230, shininess: 90, specular: 0x886622, emissive: 0x3a2a00 }));
  star.position.set(0, 2.7, -12); scene.add(star); spinners.push({ obj: star, speed: 0.5 });
  const pl = textPlane([{ text: cp.date, size: 40, weight: 600, font: UI_FONT, color: GOLD_TXT, gap: 6 }, { text: cp.title, size: 50, weight: 700 }], 1.9, 0.5, { ppm: 300 });
  placeAt(pl, 0, 0.62, -10.62, 0);
  [plinth, star, pl].forEach((m) => { m.userData.ex = cp; interactive.push(m); });
  CIRCLES.push([0, -12, 1.7]);

  // portrait of President Hồ Chí Minh in the middle of the back wall, facing the entrance, with the two flags
  const back = { x: 0, z: -23.8, ry: 0 };
  buildPortraitWall(back);
  // the big title moves above the entrance (inside), so it greets people on the way out
  onWall(textPlane([
    { text: "LỊCH SỬ ĐẢNG CỘNG SẢN VIỆT NAM", size: 64, weight: 700, color: GOLD_TXT, gap: 10 },
    { text: "1930 – nay", size: 44, font: UI_FONT, color: "#f3ead8" },
  ], 6.6, 1.3, { bg: "#6e1414", ppm: 150, pad: 0.05 }), { x: 0, z: -0.2, ry: PI }, 6.0, 6.3);
  onWall(textPlane([
    { text: "“Không có gì quý hơn độc lập, tự do.”", size: 64, weight: 700, gap: 18 },
    { text: "Hồ Chí Minh, 1966", size: 40, font: UI_FONT, color: GOLD_TXT },
  ], 4.2, 1.8, { ppm: 200 }), back, -7, 2.6);
  onWall(textPlane([
    { text: "“Đảng ta là đạo đức, là văn minh.”", size: 64, weight: 700, gap: 18 },
    { text: "Hồ Chí Minh, 1960", size: 40, font: UI_FONT, color: GOLD_TXT },
  ], 4.2, 1.8, { ppm: 200 }), back, 7, 2.6);

  // map + welcome on the inside of the facade
  const front = { x: 0, z: -0.2, ry: PI };
  const mapLines = [{ text: "SƠ ĐỒ THAM QUAN", size: 40, weight: 600, font: UI_FONT, color: GOLD_TXT, gap: 16 }];
  DATA.rooms.forEach((r, i) => mapLines.push({ text: `Phòng ${r.num} (${["bên trái, phía trước", "bên trái, phía sau", "cuối sảnh", "bên phải, phía sau", "bên phải, phía trước"][i]}): ${r.period}`, size: 30, font: UI_FONT, align: "left", gap: 6 }));
  onWall(textPlane(mapLines, 3.8, 2.4, { ppm: 220 }), front, 7, 2.6);
  onWall(textPlane([
    { text: "Chào mừng đến Bảo tàng số", size: 40, weight: 600, font: UI_FONT, color: GOLD_TXT, gap: 10 },
    { text: "Sảnh chính trưng bày giai đoạn 1930 – 1945: Đảng ra đời và lãnh đạo Cách mạng Tháng Tám. Đi theo chiều kim đồng hồ để xem theo thứ tự thời gian.", size: 34, align: "left" },
  ], 3.8, 2.4, { ppm: 220 }), front, -7, 2.6);

  // 1930–1945 panels on the side walls
  const spots = [[-11.8, -2.4, H2], [-11.8, -12, H2], [-11.8, -21.6, H2], [11.8, -21.6, -H2], [11.8, -12, -H2], [11.8, -2.4, -H2]];
  DATA.hall.panels.forEach((p, i) => {
    const [x, z, ry] = spots[i];
    const m = infoPanel(p, 2.7, 2.1);
    onWall(m, { x, z, ry }, 0, 2.5);
    m.userData.ex = p; interactive.push(m);
  });

  // door signs
  DATA.rooms.forEach((r, i) => {
    const g = ROOM_GEO[i];
    onWall(textPlane([
      { text: `PHÒNG ${r.num} · ${r.period}`, size: 42, weight: 600, font: UI_FONT, color: GOLD_TXT, gap: 8 },
      { text: r.name, size: 54, weight: 700 },
    ], i === 2 ? 3.6 : 4.2, i === 2 ? 0.6 : 1.05, { bg: "#" + r.color.toString(16).padStart(6, "0"), ppm: 200 }), g.sign, 0, i === 2 ? 3.68 : 4.3);
  });
}

const PORTRAIT_EX = {
  date: "19/5/1890 – 2/9/1969", title: "Chủ tịch Hồ Chí Minh",
  text: "Lãnh tụ của cách mạng Việt Nam, người sáng lập Đảng Cộng sản Việt Nam (3/2/1930) và khai sinh nước Việt Nam Dân chủ Cộng hòa (2/9/1945). Ảnh chân dung chụp khoảng năm 1946.",
  lesson: "Nguyễn Ái Quốc – Hồ Chí Minh tìm ra con đường cứu nước theo chủ nghĩa Mác – Lênin và trực tiếp chuẩn bị về tư tưởng, chính trị, tổ chức cho sự ra đời của Đảng.",
  credit: "Không rõ tác giả – Public domain – Wikimedia Commons",
  photo: "images/sanh/bac_ho_1946.jpg",
};
function vnFlagCanvas() {
  const c = document.createElement("canvas"); c.width = 960; c.height = 640; const g = c.getContext("2d");
  g.fillStyle = "#da251d"; g.fillRect(0, 0, 960, 640);
  starPath(g, 480, 330, 192, 74); g.fillStyle = "#ffff00"; g.fill(); // star: 3/5 of the flag height across
  return c;
}
function buildPortraitWall(wall) {
  const cy = 5.88, fw = 3.0, fh = 3.85;
  // gold frame, dark red mat, photo, name band
  onWall(new THREE.Mesh(bx(fw, fh, 0.1), DECO.gold), wall, 0, cy, 0.05);
  onWall(new THREE.Mesh(new THREE.PlaneGeometry(fw - 0.2, fh - 0.2), lam(0x4a0e0e)), wall, 0, cy, 0.105);
  const pw = 2.3, ph = pw / 0.711;
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  onWall(photo, wall, 0, cy + 0.2, 0.11);
  loadImg(PORTRAIT_EX.photo).then((im) => { if (!im) return; const t = new THREE.Texture(im); t.encoding = THREE.sRGBEncoding; t.needsUpdate = true; photo.material.map = t; photo.material.needsUpdate = true; });
  const band = textPlane([{ text: "CHỦ TỊCH HỒ CHÍ MINH", size: 54, weight: 700, color: GOLD_TXT, gap: 4 }, { text: "1890 – 1969", size: 32, font: UI_FONT, color: "#e8dcc4" }], 2.6, 0.38, { bg: "#4a0e0e", border: false, ppm: 260 });
  onWall(band, wall, 0, cy - fh / 2 + 0.3, 0.112);
  // light bar above the frame and a warm spotlight
  onWall(new THREE.Mesh(bx(1.4, 0.08, 0.3), DECO.gold), wall, 0, cy + fh / 2 + 0.22, 0.2);
  onWall(new THREE.Mesh(bx(1.3, 0.03, 0.22), DECO.glow), wall, 0, cy + fh / 2 + 0.17, 0.2);
  const spot = new THREE.PointLight(0xffe2b0, 0.55, 7, 1.6); spot.position.set(wall.x, cy + 0.6, wall.z + 1.6); scene.add(spot);
  [photo, band].forEach((m) => { m.userData.ex = PORTRAIT_EX; interactive.push(m); });
  // the national flag (left) and the Party flag (right), each on a gold rod
  const flagW = 1.95, flagH = 1.3;
  const mk = (c) => new THREE.MeshLambertMaterial({ map: canvasTex(c), side: THREE.DoubleSide });
  const vn = new THREE.Mesh(new THREE.PlaneGeometry(flagW, flagH), mk(vnFlagCanvas()));
  onWall(vn, wall, -3.25, cy + 0.6, 0.09);
  const pf = new THREE.Mesh(new THREE.PlaneGeometry(flagW, flagH), new THREE.MeshLambertMaterial({ color: 0xda251d, side: THREE.DoubleSide }));
  onWall(pf, wall, 3.25, cy + 0.6, 0.09);
  loadImg("images/sanh/co_dang.png").then((im) => { if (!im) return; const t = new THREE.Texture(im); t.encoding = THREE.sRGBEncoding; t.needsUpdate = true; pf.material.map = t; pf.material.color.set(0xffffff); pf.material.needsUpdate = true; });
  for (const x of [-3.25, 3.25]) {
    onWall(new THREE.Mesh(bx(flagW + 0.2, 0.05, 0.05), DECO.gold), wall, x, cy + 0.6 + flagH / 2 + 0.05, 0.1);
    for (const s of [-1, 1]) onWall(new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), DECO.gold), wall, x + s * (flagW / 2 + 0.12), cy + 0.6 + flagH / 2 + 0.05, 0.1);
  }
}

function infoPanel(p, w, h) {
  return textPlane([
    { text: p.date, size: 36, weight: 600, font: UI_FONT, color: GOLD_TXT, gap: 8, align: "left" },
    { text: p.title, size: 50, weight: 700, gap: 14, align: "left" },
    { text: p.text, size: 30, font: UI_FONT, color: "#e8dcc4", align: "left" },
  ], w, h, { ppm: 270, top: 0.08 });
}

function buildRooms() {
  const loader = new THREE.TextureLoader();
  DATA.rooms.forEach((room, i) => {
    const g = ROOM_GEO[i];
    const [x0, x1, z0, z1] = g.rect;
    slab(x0, x1, z0, z1, 0.01, new THREE.MeshPhongMaterial({ map: canvasTex(plankCanvas(), [2.5, 2.5]), shininess: 35, specular: 0x3a2a1a }));
    decorateRoom(g, room);
    slab(x0, x1, z0, z1, 5, M.ceiling, false);
    const light = new THREE.PointLight(0xffd29a, 0.45, 14, 1.6); light.position.set(g.c[0], 4.2, g.c[1]); scene.add(light);

    if (room.items.some((it) => it.img)) {
      // photo room: 3 per wall
      room.items.forEach((it, k) => {
        const wall = g.walls[Math.floor(k / 3)], off = [-3.1, 0, 3.1][k % 3];
        loader.load("images/" + it.img + ".jpeg", (tex) => {
          tex.encoding = THREE.sRGBEncoding;
          const asp = tex.image.width / tex.image.height;
          let h = it.big ? 2.0 : 1.55, w = h * asp; const mw = it.big ? 2.9 : 2.6; if (w > mw) { w = mw; h = w / asp; }
          const grp = new THREE.Group();
          const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.06), M.gold); frame.position.z = 0.03;
          const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex })); pic.position.z = 0.065;
          const plq = textPlane([{ text: it.date, size: 34, weight: 600, font: UI_FONT, color: GOLD_TXT, gap: 4 }, { text: it.title, size: 46, weight: 700 }], 1.8, 0.42, { ppm: 300 });
          plq.position.set(0, -h / 2 - 0.4, 0.02);
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.22), M.gold); lamp.position.set(0, h / 2 + 0.3, 0.12);
          grp.add(frame, pic, plq, lamp);
          onWall(grp, wall, off, 2.5, 0.06);
          [frame, pic, plq].forEach((m) => { m.userData.ex = it; interactive.push(m); });
        });
      });
      if (room.walls) room.walls.forEach((t, k) => onWall(textPlane([{ text: t, size: 44, weight: 700, color: GOLD_TXT }], 6.4, 0.42, { bg: "#3a1512", border: false, ppm: 160, pad: 0.03 }), g.walls[k], 0, 4.3));
    } else {
      // text room: 2 + title + 2 + 2
      const slots = [[0, -2.35], [0, 2.35], [1, -3.45], [1, 3.45], [2, -2.35], [2, 2.35]];
      room.items.forEach((it, k) => {
        const [wi, off] = slots[k];
        const m = infoPanel(it, 2.3, 2.1);
        onWall(m, g.walls[wi], off, 2.2);
        m.userData.ex = it; interactive.push(m);
      });
      onWall(textPlane([
        { text: `PHÒNG ${room.num}`, size: 46, weight: 600, font: UI_FONT, color: GOLD_TXT, gap: 8 },
        { text: room.period, size: 70, weight: 700, gap: 14 },
        { text: room.name, size: 46, weight: 500, color: "#e8dcc4" },
      ], 2.4, 1.9, { ppm: 240 }), g.walls[1], 0, 3.15);
    }
  });
}

function buildPedestal(ex, g) {
  const [cx, cz] = g.c;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 1, 28), M.wood); base.position.set(cx, 0.5, cz); scene.add(base);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.06, 28), M.gold); rim.position.set(cx, 1.0, cz); scene.add(rim);
  const obj = new THREE.Group(); obj.position.set(cx, 1.03, cz); obj.rotation.y = g.face; scene.add(obj);
  const parts = [];
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); obj.add(m); parts.push(m); return m; };
  if (ex.kind === "jar") {
    const prof = [[0, 0], [0.26, 0], [0.34, 0.12], [0.38, 0.32], [0.34, 0.52], [0.22, 0.66], [0.2, 0.74], [0.25, 0.78]].map(([x, y]) => new THREE.Vector2(x, y));
    const jarMat = new THREE.MeshLambertMaterial({ color: 0x8a5634, side: THREE.DoubleSide });
    add(new THREE.LatheGeometry(prof, 32), jarMat, 0, 0, 0);
    const rice = add(new THREE.CircleGeometry(0.2, 20), lam(0xf1ead8), 0, 0.72, 0); rice.rotation.x = -H2;
  } else if (ex.kind === "cannon") {
    const barrel = add(new THREE.CylinderGeometry(0.07, 0.1, 1.3, 14), M.olive, 0, 0.42, 0.15); barrel.rotation.x = -1.2;
    add(new THREE.BoxGeometry(0.34, 0.16, 0.7), M.olive, 0, 0.22, 0.05);
    for (const s of [-1, 1]) { const w = add(new THREE.CylinderGeometry(0.26, 0.26, 0.07, 18), M.metal, s * 0.24, 0.26, 0); w.rotation.z = H2; }
  } else if (ex.kind === "helmet") {
    add(new THREE.SphereGeometry(0.3, 20, 10, 0, PI * 2, 0, PI / 2), M.olive, 0, 0.12, 0);
    const brim = add(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 24), M.olive, 0, 0.12, 0);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.13, 0.03, 0.32), M.dark, s * 0.32, 0.02, 0.32);
    brim.scale.z = 1.1;
  } else if (ex.kind === "ration") {
    const tc = textCanvas([{ text: "TEM PHIẾU", size: 46, weight: 700, color: "#7a1f1b", gap: 6 }, { text: "GẠO · 1 kg", size: 36, font: UI_FONT, color: "#3a2a1a" }], 0.6, 0.4, { bg: "#efe2bf", borderColor: "#7a1f1b", ppm: 400 });
    const tm = [lam(0xefe2bf), lam(0xefe2bf), new THREE.MeshLambertMaterial({ map: canvasTex(tc) }), lam(0xefe2bf), lam(0xefe2bf), lam(0xefe2bf)];
    for (let k = 0; k < 3; k++) { const b = add(new THREE.BoxGeometry(0.6, 0.03, 0.4), tm, (k - 1) * 0.06, 0.02 + k * 0.035, (k - 1) * 0.04); b.rotation.y = (k - 1) * 0.25; }
    add(new THREE.BoxGeometry(0.34, 0.05, 0.46), lam(0x4b5d3a), 0.05, 0.14, 0.02);
  } else if (ex.kind === "globe") {
    const sph = add(new THREE.SphereGeometry(0.42, 24, 16), lam(0x3f6f8f), 0, 0.62, 0);
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(0.425, 12, 8)), new THREE.LineBasicMaterial({ color: 0xc9a24a }));
    sph.add(wire); spinners.push({ obj: sph, speed: 0.4 });
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), M.gold, 0, 0.12, 0);
    add(new THREE.CylinderGeometry(0.2, 0.24, 0.05, 20), M.gold, 0, 0.02, 0);
  }
  const plq = textPlane([{ text: "HIỆN VẬT", size: 30, weight: 600, font: UI_FONT, color: GOLD_TXT, gap: 6 }, { text: ex.title, size: 52, weight: 700 }], 1.1, 0.42, { ppm: 300 });
  const nx = Math.sin(g.face), nz = Math.cos(g.face);
  plq.position.set(cx + nx * 0.64, 0.62, cz + nz * 0.64); plq.rotation.y = g.face; scene.add(plq);
  [base, plq, ...parts].forEach((m) => { m.userData.ex = ex; interactive.push(m); });
  CIRCLES.push([cx, cz, 1.05]);
}

/* ================= interior decor: wainscot, mouldings, cove lights, chandeliers, carpet ================= */
const DECO = {
  wainscot: new THREE.MeshPhongMaterial({ color: 0x3b2618, shininess: 40, specular: 0x2a1c10 }),
  gold: new THREE.MeshPhongMaterial({ color: 0xd4ae55, shininess: 90, specular: 0x8a6a2a, emissive: 0x1a1200 }),
  glow: new THREE.MeshBasicMaterial({ color: 0xffe2a6 }),
  bulb: new THREE.MeshBasicMaterial({ color: 0xfff3d6 }),
  carpet: new THREE.MeshLambertMaterial({ color: 0x6e1212 }),
  velvet: new THREE.MeshPhongMaterial({ color: 0x5a1218, shininess: 10 }),
  caseWood: new THREE.MeshPhongMaterial({ color: 0x2e1d12, shininess: 60, specular: 0x3a2a1a }),
  glass: new THREE.MeshPhongMaterial({ color: 0xd8eefa, transparent: true, opacity: 0.24, shininess: 140, specular: 0xffffff, depthWrite: false }),
};
function wallLen(w, rect) { return Math.abs(Math.sin(w.ry)) > 0.5 ? rect[3] - rect[2] : rect[1] - rect[0]; }
function trimWall(w, len, ceil) {
  onWall(new THREE.Mesh(bx(len, 1.0, 0.05), DECO.wainscot), w, 0, 0.5, 0.045);
  onWall(new THREE.Mesh(bx(len, 0.06, 0.07), DECO.gold), w, 0, 1.03, 0.035);
  onWall(new THREE.Mesh(bx(len, 0.14, 0.12), DECO.gold), w, 0, ceil - 0.08, 0.06);
  onWall(new THREE.Mesh(bx(len, 0.04, 0.03), DECO.glow), w, 0, ceil - 0.2, 0.12);
}
function chandelier(x, y, z, r) {
  const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
  part(g, cyl(0.02, 0.02, 1.2, 6), DECO.gold, 0, 0.6, 0);
  part(g, new THREE.TorusGeometry(r, 0.04, 8, 32), DECO.gold, 0, 0, 0, H2, 0, 0);
  part(g, new THREE.TorusGeometry(r * 0.55, 0.03, 8, 24), DECO.gold, 0, -0.25, 0, H2, 0, 0);
  for (let k = 0; k < 10; k++) { const a = k / 10 * PI * 2; part(g, new THREE.SphereGeometry(0.07, 10, 8), DECO.bulb, Math.cos(a) * r, 0.06, Math.sin(a) * r); }
  for (let k = 0; k < 6; k++) { const a = k / 6 * PI * 2 + 0.3; part(g, new THREE.SphereGeometry(0.055, 10, 8), DECO.bulb, Math.cos(a) * r * 0.55, -0.2, Math.sin(a) * r * 0.55); }
  part(g, new THREE.SphereGeometry(0.12, 12, 10), DECO.bulb, 0, -0.45, 0);
}
function decorateHall() {
  // red carpet from the entrance to room III, with gold borders
  slab(-1.3, 1.3, -23.6, -0.4, 0.02, DECO.carpet);
  slab(-1.3, -1.18, -23.6, -0.4, 0.025, DECO.gold); slab(1.18, 1.3, -23.6, -0.4, 0.025, DECO.gold);
  // wainscot + mouldings on the four hall walls (skipping the door openings)
  // wainscot stops at the doors; the ceiling moulding and cove light run the full length of each wall
  const segs = (wallX, ry, list) => list.forEach(([a, b]) => trimWallPart({ x: wallX, z: (a + b) / 2, ry }, b - a, 8, true, false));
  segs(-11.8, H2, [[-4.8, -0.2], [-16.8, -7.2], [-23.8, -19.2]]);
  segs(11.8, -H2, [[-4.8, -0.2], [-16.8, -7.2], [-23.8, -19.2]]);
  for (const [a, b] of [[-11.8, -1.2], [1.2, 11.8]]) trimWallPart({ x: (a + b) / 2, z: -23.8, ry: 0 }, b - a, 8, true, false);
  for (const [a, b] of [[-11.8, -1.8], [1.8, 11.8]]) trimWallPart({ x: (a + b) / 2, z: -0.2, ry: PI }, b - a, 8, true, false);
  for (const w of [{ x: -11.8, z: -12, ry: H2 }, { x: 11.8, z: -12, ry: -H2 }, { x: 0, z: -23.8, ry: 0 }, { x: 0, z: -0.2, ry: PI }]) trimWallPart(w, 23.6, 8, false, true);
  // pilasters between panels and doors
  for (const sx of [-1, 1]) for (const z of [-9, -15]) {
    const w = { x: sx * 11.8, z, ry: -sx * H2 };
    onWall(new THREE.Mesh(bx(0.55, 7.7, 0.22), M.cream), w, 0, 3.85, 0.11);
    onWall(new THREE.Mesh(bx(0.75, 0.3, 0.3), DECO.gold), w, 0, 7.55, 0.15);
    onWall(new THREE.Mesh(bx(0.75, 0.25, 0.3), DECO.gold), w, 0, 0.12, 0.15);
    CIRCLES.push([sx * 11.4, z, 0.35]);
  }
  chandelier(0, 6.6, -6, 0.95); chandelier(0, 6.6, -18, 0.95);
}
function trimWallPart(w, len, ceil, low = true, high = true) {
  if (low) {
    onWall(new THREE.Mesh(bx(len, 1.0, 0.05), DECO.wainscot), w, 0, 0.5, 0.045);
    onWall(new THREE.Mesh(bx(len, 0.06, 0.07), DECO.gold), w, 0, 1.03, 0.035);
  }
  if (high) {
    onWall(new THREE.Mesh(bx(len, 0.16, 0.14), DECO.gold), w, 0, ceil - 0.09, 0.07);
    onWall(new THREE.Mesh(bx(len, 0.04, 0.03), DECO.glow), w, 0, ceil - 0.24, 0.14);
  }
}
function decorateRoom(g, room) {
  for (const w of g.walls) trimWall(w, wallLen(w, g.rect), 5);
  // round ceiling light with a glowing ring
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), DECO.glow); disc.rotation.x = H2; disc.position.set(g.c[0], 4.97, g.c[1]); scene.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 8, 32), DECO.gold); ring.rotation.x = H2; ring.position.set(g.c[0], 4.95, g.c[1]); scene.add(ring);
}

/* ================= second floor: mezzanine, balcony, glass elevator ================= */
let elevAction = null;
function buildUpperFloor() {
  const woodTop = new THREE.MeshPhongMaterial({ color: 0x5a3a24, shininess: 40, specular: 0x2a1c10 });
  // mezzanine along the entrance wall (z -3.4 … -0.2), and a little bridge to the elevator
  box(23.6, 0.3, 3.2, 0, UP - 0.15, -1.8, [M.cream, M.cream, woodTop, M.ceiling, M.cream, M.cream], true);
  box(1.8, 0.3, 0.45, -6.5, UP - 0.15, -3.62, [M.cream, M.cream, woodTop, M.ceiling, M.cream, M.cream], true);
  // glass railing with a gold handrail (gap where the elevator opens)
  for (const [a, b] of [[-11.8, -7.4], [-5.6, 11.8]]) {
    const g = box(b - a, 0.95, 0.04, (a + b) / 2, UP + 0.48, -3.38, DECO.glass); g.renderOrder = 2;
    box(b - a, 0.06, 0.08, (a + b) / 2, UP + 0.98, -3.38, DECO.gold);
    for (let x = a; x <= b + 0.01; x += 1.6) box(0.05, 0.95, 0.05, x, UP + 0.48, -3.38, DECO.gold);
  }
  for (const x of [-7.4, -5.6]) { const g = box(0.04, 0.95, 0.4, x, UP + 0.48, -3.6, DECO.glass); g.renderOrder = 2; box(0.08, 0.06, 0.45, x, UP + 0.98, -3.6, DECO.gold); }
  // glow strip under the mezzanine edge
  box(23.4, 0.04, 0.06, 0, UP - 0.32, -3.36, DECO.glow);
  // balcony between the portico columns, with a white balustrade
  box(16.6, 0.3, 3.85, 0, UP - 0.15, 2.12, [M.white, M.white, new THREE.MeshPhongMaterial({ color: 0xe9e1cf, shininess: 30 }), M.white, M.white, M.white], true);
  const rail = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const top = box(0.14, 0.1, len, mx, UP + 1.0, mz, M.white); top.rotation.y = ang;
    const bot = box(0.14, 0.08, len, mx, UP + 0.06, mz, M.white); bot.rotation.y = ang;
    const n = Math.round(len / 0.3);
    for (let i = 0; i <= n; i++) { const b = new THREE.Mesh(cyl(0.045, 0.065, 0.9, 8), M.white); b.position.set(x0 + (x1 - x0) * i / n, UP + 0.5, z0 + (z1 - z0) * i / n); scene.add(b); }
  };
  rail(-8.25, 4.02, 8.25, 4.02); rail(-8.25, 0.25, -8.25, 4.02); rail(8.25, 0.25, 8.25, 4.02);
  // gold frame around the balcony door
  box(0.2, 2.5, 0.5, -1.3, UP + 1.2, 0.05, M.gold); box(0.2, 2.5, 0.5, 1.3, UP + 1.2, 0.05, M.gold); box(2.8, 0.2, 0.5, 0, UP + 2.45, 0.05, M.gold);
  // signs
  onWall(textPlane([{ text: "BAN CÔNG NGẮM CẢNH", size: 52, weight: 700, color: GOLD_TXT, gap: 6 }, { text: "Đi qua cửa giữa để ra ban công", size: 32, font: UI_FONT }], 4.2, 0.9, { ppm: 200 }), { x: 0, z: -0.2, ry: PI }, -5.6, 6.3);

  // glass elevator shaft: three glass sides, open towards +z at both floors
  const top = UP + 2.7, cx = (ELEV.x0 + ELEV.x1) / 2, cz = (ELEV.z0 + ELEV.z1) / 2, w = ELEV.x1 - ELEV.x0, d = ELEV.z1 - ELEV.z0;
  for (const [gx, gz, gw, gd] of [[cx, ELEV.z0, w, 0.04], [ELEV.x0, cz, 0.04, d], [ELEV.x1, cz, 0.04, d]]) { const g = box(gw, top, gd, gx, top / 2, gz, DECO.glass); g.renderOrder = 2; }
  for (const x of [ELEV.x0, ELEV.x1]) for (const z of [ELEV.z0, ELEV.z1]) box(0.08, top, 0.08, x, top / 2, z, DECO.gold);
  box(w + 0.3, 0.2, d + 0.3, cx, top + 0.1, cz, DECO.gold);
  CIRCLES.push([ELEV.x0, ELEV.z0, 0.12], [ELEV.x1, ELEV.z0, 0.12]);
  // the cabin (moves up and down)
  const cab = new THREE.Group(); cab.position.set(cx, 0, cz); scene.add(cab); ELEV.cabin = cab;
  part(cab, bx(w - 0.08, 0.12, d - 0.08), woodTop, 0, 0.06, 0);
  part(cab, bx(w - 0.08, 0.08, d - 0.08), DECO.caseWood, 0, 2.5, 0);
  part(cab, new THREE.PlaneGeometry(w - 0.4, d - 0.4), DECO.glow, 0, 2.45, 0, H2);
  for (const [px, pz, pw, pd] of [[0, -d / 2 + 0.06, w - 0.1, 0.05], [-w / 2 + 0.06, 0, 0.05, d - 0.1], [w / 2 - 0.06, 0, 0.05, d - 0.1]]) part(cab, bx(pw, 0.06, pd), DECO.gold, px, 1.0, pz);
  const pnl = part(cab, bx(0.04, 0.5, 0.3), DECO.caseWood, w / 2 - 0.1, 1.3, -0.3);
  for (const [by, col] of [[1.42, 0xffe2a6], [1.2, 0xffe2a6]]) part(cab, cyl(0.04, 0.04, 0.02, 12), new THREE.MeshBasicMaterial({ color: col }), w / 2 - 0.13, by, -0.3, 0, 0, H2);
  const lab = textPlane([{ text: "THANG MÁY", size: 46, weight: 700, color: GOLD_TXT, gap: 4 }, { text: "Tầng 1 ⇅ Tầng 2 · Ban công", size: 30, font: UI_FONT }], 1.7, 0.4, { ppm: 260 });
  placeAt(lab, cx, 2.95, ELEV.z1 + 0.03, 0);
  const lab2 = lab.clone(); placeAt(lab2, cx, UP + 2.95 - 0.35, ELEV.z1 + 0.03, 0);
}
function updateElevator(dt) {
  if (!ELEV.cabin) return;
  const inside = inElev(player.x, player.z);
  if (ELEV.y !== ELEV.target) {
    const dy = ELEV.target - ELEV.y, step = Math.sign(dy) * Math.min(Math.abs(dy), 1.8 * dt);
    ELEV.y += step; if (Math.abs(ELEV.target - ELEV.y) < 1e-3) ELEV.y = ELEV.target;
  }
  ELEV.cabin.position.y = ELEV.y;
  if (inside) player.base = ELEV.y;
  else player.base = player.base > UP / 2 ? UP : 0;
}
function elevatorPrompt() {
  if (!ELEV.cabin || ELEV.y !== ELEV.target) return null;
  const lvlY = levelOf() ? UP : 0;
  if (inElev(player.x, player.z)) {
    const up = ELEV.y < UP / 2;
    const act = () => { ELEV.target = up ? UP : 0; };
    act.label = up ? "Lên tầng 2 · Ban công" : "Xuống tầng 1";
    return act;
  }
  const cx = (ELEV.x0 + ELEV.x1) / 2, cz = ELEV.z1 + 0.6;
  if (Math.hypot(player.x - cx, player.z - cz) < 1.6 && Math.abs(ELEV.y - lvlY) > 0.05) {
    const act = () => { ELEV.target = lvlY; };
    act.label = "Gọi thang máy";
    return act;
  }
  return null;
}

/* ================= glass display cases with real artifacts ================= */
function paperTex(bg, ink, title, lines, w, h) {
  const c = document.createElement("canvas"); c.width = Math.round(256 * w); c.height = Math.round(256 * h);
  const g = c.getContext("2d"); g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = ink; let y = 14;
  if (title) { g.font = `700 ${Math.round(c.width / 10)}px ${SERIF}`; g.textAlign = "center"; g.textBaseline = "top"; g.fillText(title, c.width / 2, y, c.width - 16); y += c.width / 8 + 6; g.fillRect(10, y, c.width - 20, 2); y += 8; }
  g.globalAlpha = 0.55;
  for (let i = 0; i < lines; i++) { const lw = (c.width - 24) * (0.6 + 0.4 * rand()); g.fillRect(12, y, lw, 3); y += 9; if (y > c.height - 10) break; }
  g.globalAlpha = 1;
  return new THREE.MeshLambertMaterial({ map: canvasTex(c), side: THREE.DoubleSide });
}
// simple low-poly model for each kind of object (fits in about 0.8 x 0.5 x 0.55, standing on y = 0)
function artifactModel(kind, ex) {
  const g = new THREE.Group();
  const P = (geo, mat, x, y, z, rx, ry, rz) => part(g, geo, mat, x, y, z, rx, ry, rz);
  const L = (c) => lam(c);
  const paper = 0xefe4c6, olive = 0x4f5a37, bamboo = 0xc9a65a, straw = 0xd8bf7a;
  const stand = () => P(bx(0.5, 0.03, 0.25), L(0x2a1c12), 0, 0.12, -0.05, -0.9, 0, 0);
  switch (kind) {
    case "book": P(bx(0.34, 0.07, 0.46), L(0x7a1f1b), 0, 0.035, 0); P(bx(0.32, 0.06, 0.44), L(paper), 0.01, 0.035, 0); break;
    case "diary": { const a = P(bx(0.22, 0.02, 0.3), L(paper), -0.11, 0.06, 0, 0, 0, 0.12); const b = P(bx(0.22, 0.02, 0.3), L(paper), 0.11, 0.06, 0, 0, 0, -0.12); P(bx(0.48, 0.03, 0.32), L(0x5a3a22), 0, 0.03, 0); a.material = paperTex("#efe4c6", "#3a3a6a", null, 18, 1, 1.3); b.material = a.material; break; }
    case "newspaper": case "document": case "ballot": {
      const t = kind === "newspaper" ? (ex.title.split(" ").slice(0, 3).join(" ").toUpperCase()) : null;
      const m = P(new THREE.PlaneGeometry(0.46, 0.6), paperTex(kind === "ballot" ? "#f6f1e3" : "#e9dcb8", "#2a2a2a", t, 40, 1, 1.3), 0, 0.3, 0, -0.35, 0, 0);
      stand(); break; }
    case "flag": {
      P(cyl(0.012, 0.012, 0.75, 6), DECO.gold, -0.3, 0.375, 0);
      const c = document.createElement("canvas"); c.width = 192; c.height = 128; const cg = c.getContext("2d"); cg.fillStyle = "#c8201a"; cg.fillRect(0, 0, 192, 128); starPath(cg, 96, 66, 40, 15); cg.fillStyle = "#f6c51c"; cg.fill();
      P(new THREE.PlaneGeometry(0.5, 0.33, 8, 2), new THREE.MeshLambertMaterial({ map: canvasTex(c), side: THREE.DoubleSide }), -0.04, 0.58, 0);
      P(bx(0.2, 0.03, 0.2), DECO.gold, -0.3, 0.015, 0); break; }
    case "typewriter":
      P(bx(0.46, 0.1, 0.36), L(0x2a2a2c), 0, 0.05, 0); P(bx(0.42, 0.08, 0.16), L(0x333336), 0, 0.12, -0.08, 0.3, 0, 0);
      P(cyl(0.035, 0.035, 0.5, 12), L(0x111111), 0, 0.18, -0.15, 0, 0, H2);
      for (let r = 0; r < 3; r++) for (let k = 0; k < 9; k++) P(cyl(0.012, 0.012, 0.012, 8), L(0xe8e2d0), -0.17 + k * 0.042 + r * 0.01, 0.105 + r * 0.012, 0.06 + r * 0.035);
      break;
    case "radio": { P(bx(0.46, 0.3, 0.2), L(0x6b4423), 0, 0.15, 0); const gr = P(new THREE.CircleGeometry(0.09, 20), L(0x2a1c12), -0.1, 0.16, 0.101); P(bx(0.14, 0.06, 0.01), L(paper), 0.12, 0.2, 0.101); P(cyl(0.02, 0.02, 0.02, 10), L(0xd4ae55), 0.09, 0.09, 0.105, H2, 0, 0); P(cyl(0.02, 0.02, 0.02, 10), L(0xd4ae55), 0.16, 0.09, 0.105, H2, 0, 0); break; }
    case "hat_conical": P(new THREE.ConeGeometry(0.3, 0.2, 24, 1, true), new THREE.MeshLambertMaterial({ color: straw, side: THREE.DoubleSide }), 0, 0.12, 0); break;
    case "hat_bush": P(cyl(0.12, 0.13, 0.1, 18), L(olive), 0, 0.1, 0); P(cyl(0.25, 0.25, 0.015, 24), L(olive), 0, 0.05, 0); break;
    case "helmet": P(new THREE.SphereGeometry(0.18, 18, 10, 0, PI * 2, 0, PI / 2), L(kind === "helmet" ? bamboo : olive), 0, 0.05, 0); P(cyl(0.25, 0.25, 0.02, 24), L(bamboo), 0, 0.05, 0); break;
    case "sandals": for (const s of [-1, 1]) { P(bx(0.12, 0.025, 0.3), L(0x1d1d1d), s * 0.09, 0.0125, 0, 0, s * 0.1, 0); P(new THREE.TorusGeometry(0.05, 0.012, 6, 12, PI), L(0x1d1d1d), s * 0.09, 0.025, 0.06, 0, H2, 0); P(new THREE.TorusGeometry(0.05, 0.012, 6, 12, PI), L(0x1d1d1d), s * 0.09, 0.025, -0.07, 0, H2, 0); } break;
    case "basket": { const prof = [[0.12, 0], [0.16, 0.1], [0.2, 0.3], [0.22, 0.45], [0.2, 0.47]].map(([x, y]) => new THREE.Vector2(x, y)); P(new THREE.LatheGeometry(prof, 18), new THREE.MeshLambertMaterial({ color: bamboo, side: THREE.DoubleSide }), 0, 0, 0); for (const s of [-1, 1]) P(new THREE.TorusGeometry(0.12, 0.012, 6, 14, PI), L(0x5a3a22), s * 0.09, 0.3, -0.19, 0, 0, H2); break; }
    case "coins": for (let k = 0; k < 7; k++) P(cyl(0.05, 0.05, 0.012, 18), L(k % 2 ? 0xb87333 : 0xc9a24a), (rand() - 0.5) * 0.4, 0.006 + (k % 3) * 0.012, (rand() - 0.5) * 0.3); break;
    case "banknotes": case "coupons":
      for (let k = 0; k < 4; k++) P(new THREE.PlaneGeometry(kind === "coupons" ? 0.2 : 0.34, kind === "coupons" ? 0.14 : 0.16), paperTex(kind === "coupons" ? "#e9e0c2" : ["#c9d6b0", "#d9c3a0", "#b9c7d6", "#d6b9b0"][k], "#3a3a3a", null, 6, 1, 0.5), (k - 1.5) * 0.1, 0.005 + k * 0.004, (k % 2) * 0.08, -H2, 0, (k - 1.5) * 0.15);
      break;
    case "lamp": { const prof = [[0.1, 0], [0.11, 0.03], [0.08, 0.1], [0.04, 0.13], [0.05, 0.18], [0.07, 0.25], [0.04, 0.34]].map(([x, y]) => new THREE.Vector2(x, y)); P(new THREE.LatheGeometry(prof, 18), new THREE.MeshPhongMaterial({ color: 0xd8e8e8, transparent: true, opacity: 0.6, shininess: 100, side: THREE.DoubleSide }), 0, 0, 0); P(cyl(0.1, 0.11, 0.06, 18), L(0x6a5a3a), 0, 0.03, 0); P(new THREE.SphereGeometry(0.02, 8, 6), DECO.bulb, 0, 0.17, 0); break; }
    case "stove": P(new THREE.SphereGeometry(0.25, 14, 8, 0, PI * 2, 0, PI / 2), L(0x7a5a3a), 0, 0, 0); P(bx(0.5, 0.04, 0.1), L(0x5a4030), 0.3, 0.02, 0); P(bx(0.1, 0.05, 0.1), L(0x2a1c12), -0.18, 0.06, 0.18); break;
    case "canteen": { const c2 = P(cyl(0.12, 0.12, 0.08, 20), L(olive), 0, 0.14, 0, H2, 0, 0); c2.scale.set(1, 1, 1.6); P(cyl(0.025, 0.025, 0.05, 10), L(0x222222), 0, 0.28, 0); break; }
    case "bag": P(bx(0.4, 0.28, 0.14), L(olive), 0, 0.14, 0); P(bx(0.4, 0.14, 0.15), L(0x434d2e), 0, 0.22, 0.01, 0.15, 0, 0); break;
    case "camera": P(bx(0.24, 0.14, 0.1), L(0x1d1d1d), 0, 0.07, 0); P(cyl(0.045, 0.05, 0.08, 16), L(0x2a2a2a), 0, 0.07, 0.08, H2, 0, 0); break;
    case "pen": P(cyl(0.012, 0.012, 0.3, 10), L(0x1d1d1d), 0, 0.012, 0, 0, 0, H2); stand(); break;
    case "medal": { P(bx(0.06, 0.12, 0.01), L(0xc8201a), 0, 0.3, 0); const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = PI / 2 + i * PI / 5, rr = i % 2 ? 0.04 : 0.09; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } P(new THREE.ExtrudeGeometry(s, { depth: 0.015, bevelEnabled: false }), DECO.gold, 0, 0.17, 0); stand(); break; }
    case "bowl": { const prof = [[0.05, 0], [0.12, 0.02], [0.16, 0.08], [0.17, 0.1]].map(([x, y]) => new THREE.Vector2(x, y)); P(new THREE.LatheGeometry(prof, 20), new THREE.MeshLambertMaterial({ color: 0xe8e2d4, side: THREE.DoubleSide }), 0, 0, 0); break; }
    default: P(bx(0.3, 0.2, 0.3), L(0x8a7a5a), 0, 0.1, 0);
  }
  return g;
}
function buildCase(x, z, ry, ex) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  const P = (geo, mat, px, py, pz, rx) => part(g, geo, mat, px, py, pz, rx);
  P(bx(1.1, 0.95, 0.8), DECO.caseWood, 0, 0.475, 0);
  P(bx(1.14, 0.05, 0.84), DECO.gold, 0, 0.95, 0);
  P(bx(1.0, 0.02, 0.7), DECO.velvet, 0, 0.965, 0);
  const glass = P(bx(1.0, 0.75, 0.7), DECO.glass, 0, 1.35, 0); glass.renderOrder = 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(bx(0.03, 0.75, 0.03), DECO.gold, sx * 0.5, 1.35, sz * 0.35);
  for (const sz of [-1, 1]) P(bx(1.03, 0.03, 0.03), DECO.gold, 0, 1.725, sz * 0.35);
  for (const sx of [-1, 1]) P(bx(0.03, 0.03, 0.73), DECO.gold, sx * 0.5, 1.725, 0);
  P(bx(1.1, 0.07, 0.8), DECO.caseWood, 0, 1.76, 0);
  P(new THREE.PlaneGeometry(0.96, 0.66), DECO.glow, 0, 1.72, 0, H2);
  // label with the real photo on the front of the cabinet: photo left, name + source right
  const lc = document.createElement("canvas"); lc.width = 900; lc.height = 620;
  const ltex = canvasTex(lc);
  const lbl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.69), new THREE.MeshBasicMaterial({ map: ltex }));
  lbl.position.set(0, 0.5, 0.402); g.add(lbl);
  const drawLabel = (img) => {
    const c = lc.getContext("2d"), W = lc.width, H = lc.height;
    c.fillStyle = "#1c1511"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(212,174,85,0.95)"; c.lineWidth = 6; c.strokeRect(10, 10, W - 20, H - 20);
    const px = 30, py = 30, pw = 420, ph = H - 60;
    if (img) { const sc = Math.min(pw / img.width, ph / img.height), dw = img.width * sc, dh = img.height * sc; c.fillStyle = "#0d0a08"; c.fillRect(px, py, pw, ph); c.drawImage(img, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh); }
    else { c.fillStyle = "#2a201a"; c.fillRect(px, py, pw, ph); }
    const tx = px + pw + 28, tw = W - tx - 30; let y = 44;
    c.textAlign = "left"; c.textBaseline = "top";
    c.fillStyle = GOLD_TXT; c.font = `600 30px ${UI_FONT}`; for (const l of wrapLines(c, ex.date || "", tw)) { c.fillText(l, tx, y); y += 38; } y += 8;
    let ts = 46; c.font = `700 ${ts}px ${SERIF}`; let tl = wrapLines(c, ex.title, tw);
    while (tl.length > 4 && ts > 30) { ts -= 4; c.font = `700 ${ts}px ${SERIF}`; tl = wrapLines(c, ex.title, tw); }
    c.fillStyle = "#f3ead8"; for (const l of tl) { c.fillText(l, tx, y); y += ts * 1.18; }
    y += 14; c.fillStyle = "#b9ab94"; c.font = `500 24px ${UI_FONT}`; c.fillText("Bấm để xem chi tiết", tx, y);
    if (ex.credit) { c.font = `400 19px ${UI_FONT}`; c.fillStyle = "#9c8f7a"; const cl = wrapLines(c, "Ảnh: " + ex.credit, tw).slice(0, 4); let cy = H - 34 - cl.length * 24; for (const l of cl) { c.fillText(l, tx, cy); cy += 24; } }
    if (y > H - 34 - 4 * 24) textIssue("nhãn tủ kính: chữ chạm dòng nguồn ảnh", ex.title);
    ltex.needsUpdate = true;
  };
  drawLabel(null); if (ex.photo) loadImg(ex.photo).then(drawLabel);
  const m = artifactModel(ex.model, ex); m.position.y = 0.975; g.add(m);
  g.traverse((o) => { if (o.isMesh) { o.userData.ex = ex; interactive.push(o); } });
  CIRCLES.push([x, z, 0.8]);
}
function indoorSign(ex, x, z, ry) {
  const c = document.createElement("canvas"); c.width = 600; c.height = 760;
  const tex = canvasTex(c);
  const g = new THREE.Group(); placeAt(g, x, 0, z, ry);
  part(g, cyl(0.03, 0.04, 1.0, 8), DECO.gold, 0, 0.5, -0.03);
  part(g, cyl(0.16, 0.18, 0.04, 16), DECO.gold, 0, 0.02, -0.03);
  const board = part(g, new THREE.PlaneGeometry(0.82, 1.04), new THREE.MeshBasicMaterial({ map: tex }), 0, 1.45, 0, -0.12, 0, 0);
  const back = part(g, bx(0.86, 1.08, 0.03), DECO.caseWood, 0, 1.45, -0.025, -0.12, 0, 0);
  board.userData.ex = ex; back.userData.ex = ex; interactive.push(board, back);
  CIRCLES.push([x, z, 0.35]);
  const sign = { ex, canvas: c, tex }; drawSign(sign, null);
  if (ex.photo) loadImg(ex.photo).then((im) => drawSign(sign, im));
}
async function loadCases() {
  let list = [];
  try { const r = await fetch("images/tu_kinh/artifacts.json", { cache: "no-store" }); if (r.ok) list = await r.json(); } catch (e) {}
  if (!Array.isArray(list)) list = [];
  const by = {};
  for (const it of list) {
    if (!it || typeof it.title !== "string" || typeof it.room !== "string") continue;
    const ex = { date: it.date || "", title: it.title, text: it.text || "", lesson: it.lesson || "", credit: it.credit || "", model: it.model || "", photo: it.file ? "images/tu_kinh/" + it.file : null };
    (by[it.room] = by[it.room] || []).push(ex);
  }
  // hall: up to four cases on either side of the carpet
  const hallSpots = [[-6.5, -7, H2], [6.5, -7, -H2], [-6.5, -17, H2], [6.5, -17, -H2]];
  (by.hall || []).slice(0, 4).forEach((ex, k) => {
    const [x, z, ry] = hallSpots[k];
    buildCase(x, z, ry, ex);
  });
  // rooms: a row of up to three cases across the middle, signs beside them
  DATA.rooms.forEach((room, i) => {
    const g = ROOM_GEO[i], items = (by["room" + (i + 1)] || []).slice(0, 3);
    if (!items.length) { buildPedestal(room.pedestal, g); return; }
    const f = g.face, nx = Math.sin(f), nz = Math.cos(f), ax = Math.cos(f), az = -Math.sin(f);
    const offs = items.length === 1 ? [0] : items.length === 2 ? [-1.7, 1.7] : [-2.9, 0, 2.9];
    items.forEach((ex, k) => {
      const cx = g.c[0] - nx * 0.6 + ax * offs[k], cz = g.c[1] - nz * 0.6 + az * offs[k];
      buildCase(cx, cz, f, ex);
    });
  });
}

/* ================= lights ================= */
scene.add(new THREE.HemisphereLight(0xe8f1ff, 0x6b6b4a, 0.62));
const sun = new THREE.DirectionalLight(0xfff0d6, 0.75); sun.position.set(30, 50, 40); scene.add(sun);

/* ================= stick figures ================= */
function makeStick(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });
  const limb = (len) => { const p = new THREE.Group(); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 8), mat); m.position.y = -len / 2; p.add(m); return p; };
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), mat); head.position.y = 1.6;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeMat); e.position.set(0.075 * s, 1.64, -0.18); g.add(e); }
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 8), mat); body.position.y = 1.1;
  const armL = limb(0.55), armR = limb(0.55); armL.position.set(-0.05, 1.36, 0); armR.position.set(0.05, 1.36, 0);
  const legL = limb(0.82), legR = limb(0.82); legL.position.set(-0.05, 0.8, 0); legR.position.set(0.05, 0.8, 0);
  g.add(head, body, armL, armR, legL, legR);
  g.userData = { mat, armL, armR, legL, legR };
  pose(g, 0, 0, null, 0);
  return g;
}
// walk: amount 0..1; emote: "wave" | "clap" | null
function pose(g, phase, walk, emote, t) {
  const { armL, armR, legL, legR } = g.userData;
  const sw = Math.sin(phase) * 0.7 * walk;
  legL.rotation.set(sw, 0, -0.12); legR.rotation.set(-sw, 0, 0.12);
  armL.rotation.set(-sw * 0.8, 0, -0.35); armR.rotation.set(sw * 0.8, 0, 0.35);
  if (emote === "wave") { armR.rotation.set(0, 0, 2.5 + Math.sin(t * 14) * 0.35); }
  else if (emote === "clap") { const c = Math.abs(Math.sin(t * 12)); armL.rotation.set(-1.3, 0, -0.5 + c * 0.45); armR.rotation.set(-1.3, 0, 0.5 - c * 0.45); }
}
function pill(g, x, y, w, h) { const r = h / 2; g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arc(x + w - r, y + r, r, -H2, H2); g.lineTo(x + r, y + h); g.arc(x + r, y + r, r, H2, PI * 1.5); g.closePath(); }
function tagSprite(text, color, width) {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 128; const g = c.getContext("2d");
  g.font = `600 54px ${UI_FONT}`;
  const w = Math.min(1000, g.measureText(text).width + (color ? 100 : 64));
  g.fillStyle = "rgba(28,21,17,0.88)"; pill(g, (1024 - w) / 2, 12, w, 104); g.fill();
  g.strokeStyle = "rgba(201,162,74,0.75)"; g.lineWidth = 3; g.stroke();
  if (color) { g.fillStyle = color; g.beginPath(); g.arc((1024 - w) / 2 + 42, 64, 15, 0, PI * 2); g.fill(); }
  g.fillStyle = "#f3ead8"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 512 + (color ? 18 : 0), 66, w - (color ? 110 : 64));
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(c), transparent: true }));
  sp.scale.set(width, width / 8, 1); return sp;
}
function disposeSprite(sp) { if (!sp) return; sp.parent && sp.parent.remove(sp); sp.material.map.dispose(); sp.material.dispose(); }

// self figure (visible in third-person)
const me = { color: "#d62828", name: "", fig: null, bubble: null, bubbleUntil: 0, emote: null, emoteUntil: 0 };
function setMyFigure() {
  if (me.fig) scene.remove(me.fig);
  me.fig = makeStick(me.color); me.fig.visible = false; scene.add(me.fig);
  const tag = tagSprite(me.name || "Bạn", me.color, 2.3); tag.position.y = 2.2; me.fig.add(tag);
}

/* ================= peers ================= */
const avatars = new Map(); // id -> avatar
function ensureAvatar(id) {
  const s = Net.peers.get(id); if (!s) return null;
  let a = avatars.get(id);
  if (!a) {
    a = { fig: makeStick(s.c), color: s.c, name: "", tag: null, bubble: null, bubbleUntil: 0, emote: null, emoteUntil: 0, x: s.x, z: s.z, y: 0, yaw: s.yaw, phase: 0, walk: 0, sayAt: s.sayAt, emoteAt: s.emoteAt };
    a.fig.position.set(s.x, 0, s.z); a.fig.rotation.y = s.yaw; scene.add(a.fig); avatars.set(id, a);
  }
  if (a.color !== s.c) { a.color = s.c; a.fig.userData.mat.color.set(s.c); a.name = ""; }
  if (a.name !== s.n) { a.name = s.n; disposeSprite(a.tag); a.tag = tagSprite(s.n, s.c, 2.3); a.tag.position.y = 2.2; a.fig.add(a.tag); }
  if (s.sayAt !== a.sayAt) { a.sayAt = s.sayAt; if (s.say) { showBubble(a, s.say); addLog(s.n, s.say); } }
  if (s.emoteAt !== a.emoteAt) { a.emoteAt = s.emoteAt; if (EMOTES[s.emote]) { a.emote = s.emote; a.emoteUntil = performance.now() + 1800; showBubble(a, EMOTES[s.emote]); } }
  return a;
}
function removeAvatar(id) {
  const a = avatars.get(id); if (!a) return;
  scene.remove(a.fig); avatars.delete(id);
  if (follow === id) stopFollow();
}
function showBubble(a, text) {
  disposeSprite(a.bubble);
  a.bubble = tagSprite(text, null, 2.6); a.bubble.position.y = 2.5; a.fig.add(a.bubble);
  a.bubbleUntil = performance.now() + 6000;
}

/* ================= picking & info ================= */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const pickables = () => solids.concat(interactive);
function pick(cx, cy, maxDist) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera); ray.far = maxDist + (thirdPerson ? camDist : 0);
  const hit = ray.intersectObjects(pickables(), false)[0];
  return hit && hit.object.userData.ex ? hit.object.userData.ex : null;
}
let infoOpen = false, target = null;
function openInfo(ex) {
  infoOpen = true;
  if (document.pointerLockElement) {
  document.exitPointerLock();
  }
  for (const k in keys) keys[k] = false;
  const img = $("info-img");
  const src = ex.photo || (ex.img ? "images/" + ex.img + ".jpeg" : "");
  if (src) { img.src = src; img.alt = ex.title; img.hidden = false; } else { img.hidden = true; img.removeAttribute("src"); }
  $("info-date").textContent = ex.date || ""; $("info-title").textContent = ex.title;
  $("info-text").textContent = ex.text + (ex.credit ? "\n\nẢnh: " + ex.credit : ""); $("info-lesson").textContent = ex.lesson || "";
  $("lesson").hidden = !ex.lesson;
  $("info").hidden = false; $("prompt").hidden = true; $("close").focus();
}
function closeInfo() { infoOpen = false; $("info").hidden = true; }
$("close").addEventListener("click", closeInfo);
$("prompt").addEventListener("click", () => { if (elevAction) elevAction(); else if (target) openInfo(target); });

/* ================= input ================= */
const keys = {};
let started = false;
const isTouch = matchMedia("(pointer: coarse)").matches;
if (isTouch) document.body.classList.add("touch");
addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT") { if (e.key === "Escape") e.target.blur(); return; }
  if (e.key === "Escape") { if (infoOpen) closeInfo(); else if (!$("qr-modal").hidden) $("qr-modal").hidden = true; return; }
  if (!started || infoOpen) return;
  if (e.code === "KeyT") { e.preventDefault(); $("say").focus(); return; }
  if (e.code === "KeyV") { toggleView(); return; }
  if (e.code === "Space") { e.preventDefault(); jump(); return; }
  keys[e.code] = true;
  if (e.code === "KeyE" || e.code === "Enter") { if (elevAction) elevAction(); else if (target) openInfo(target); }
});
addEventListener("keyup", (e) => { keys[e.code] = false; });
addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

// let drag = null;
// canvas.addEventListener("pointerdown", (e) => {
//   if (!started || infoOpen) return;
//   if (document.activeElement && document.activeElement.tagName === "INPUT") document.activeElement.blur();
//   drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() };
//   canvas.setPointerCapture(e.pointerId);
// });
// canvas.addEventListener("pointermove", (e) => {
//   if (!drag || drag.id !== e.pointerId) return;
//   const k = e.pointerType === "touch" ? 0.006 : 0.0042;
//   player.yaw -= (e.clientX - drag.x) * k;
//   player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - (e.clientY - drag.y) * k));
//   drag.x = e.clientX; drag.y = e.clientY;
// });
// canvas.addEventListener("pointerup", (e) => {
//   if (!drag || drag.id !== e.pointerId) return;
//   const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy), dt = performance.now() - drag.t;
//   drag = null;
//   if (moved < 8 && dt < 400) { const hit = pick(e.clientX, e.clientY, 8); if (hit) openInfo(hit); }
// });
// canvas.addEventListener("pointercancel", () => { drag = null; });
  
// Desktop: khóa chuột và xoay camera theo hướng di chuyển chuột
canvas.addEventListener("click", () => {
  if (!started || infoOpen || isTouch) return;

  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
});

// Xoay camera khi chuột đã được khóa
document.addEventListener("mousemove", (e) => {
  if (
    document.pointerLockElement !== canvas ||
    !started ||
    infoOpen
  ) return;

  const sensitivity = 0.002;

  player.yaw -= e.movementX * sensitivity;
  player.pitch -= e.movementY * sensitivity;

  player.pitch = Math.max(
    -1.2,
    Math.min(1.2, player.pitch)
  );
});

// Mobile: vẫn giữ thao tác chạm và kéo để xoay camera
let touchDrag = null;

if (isTouch) {
  canvas.addEventListener("pointerdown", (e) => {
    if (!started || infoOpen) return;

    touchDrag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      sx: e.clientX,
      sy: e.clientY,
      t: performance.now()
    };

    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!touchDrag || touchDrag.id !== e.pointerId) return;

    const dx = e.clientX - touchDrag.x;
    const dy = e.clientY - touchDrag.y;

    player.yaw -= dx * 0.006;
    player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - dy * 0.006));

    touchDrag.x = e.clientX;
    touchDrag.y = e.clientY;
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!touchDrag || touchDrag.id !== e.pointerId) return;

    const moved = Math.hypot(
      e.clientX - touchDrag.sx,
      e.clientY - touchDrag.sy
    );

    const dt = performance.now() - touchDrag.t;
    touchDrag = null;

    if (moved < 8 && dt < 400) {
      const hit = pick(e.clientX, e.clientY, 8);
      if (hit) openInfo(hit);
    }
  });

  canvas.addEventListener("pointercancel", () => {
    touchDrag = null;
  });
}


let joyX = 0, joyY = 0, joyId = null;
const joy = $("joy"), knob = $("knob");
function joyMove(e) {
  const r = joy.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const d = Math.hypot(dx, dy), max = r.width / 2 - 10; if (d > max) { dx *= max / d; dy *= max / d; }
  knob.style.transform = `translate(${dx}px, ${dy}px)`; joyX = dx / max; joyY = dy / max;
}
joy.addEventListener("pointerdown", (e) => { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); joyMove(e); });
joy.addEventListener("pointermove", (e) => { if (e.pointerId === joyId) joyMove(e); });
const joyEnd = (e) => { if (e.pointerId !== joyId) return; joyId = null; joyX = joyY = 0; knob.style.transform = ""; };
joy.addEventListener("pointerup", joyEnd); joy.addEventListener("pointercancel", joyEnd);

function toggleView() {
  thirdPerson = !thirdPerson;
  $("view-btn").textContent = "Góc nhìn: " + (thirdPerson ? "người thứ ba" : "người thứ nhất");
  $("dot").hidden = thirdPerson;
}
$("view-btn").addEventListener("click", toggleView);
$("jump-btn").addEventListener("click", jump);

/* ================= multiplayer UI ================= */
const EMOTES = { wave: "👋 Vẫy tay", clap: "👏 Vỗ tay" };
let follow = null, joinedAt = 0;
function addLog(name, text) {
  const d = document.createElement("div");
  if (name) { const b = document.createElement("b"); b.textContent = name + ": "; d.append(b); }
  d.append(document.createTextNode(text));
  const log = $("log"); log.append(d); while (log.children.length > 4) log.firstChild.remove();
  setTimeout(() => d.remove(), 9000);
}
function renderPeople() {
  const online = Net.status === "online";
  $("live").classList.toggle("off", !online);
  $("people-count").textContent = Net.mode === "solo" ? "Chế độ một người" : online ? `${Net.peers.size + 1} người đang tham quan` : "Đang kết nối…";
  $("people-note").textContent = Net.mode === "firebase" ? "Ai mở link đều vào được và thấy nhau. Bấm “Đi theo” để camera bám theo người thuyết minh."
    : Net.mode === "claude" ? "Đang dùng phòng chung claude.ai: người được chia sẻ link và đang mở trang sẽ thấy nhau."
    : "Đang ở chế độ một người. Để cả lớp cùng vào, nhóm bật Firebase trong file config.js (xem README).";
  $("actions").hidden = !started;
  const list = $("people-list"); list.textContent = "";
  const row = (color, name, where, id) => {
    const d = document.createElement("div"); d.className = "person";
    const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = color;
    const who = document.createElement("div"); who.className = "who";
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = name;
    const wh = document.createElement("span"); wh.className = "where"; wh.textContent = where;
    who.append(nm, wh); d.append(sw, who);
    if (id) {
      const b = document.createElement("button"); b.type = "button"; b.className = "act";
      b.textContent = follow === id ? "Đang theo" : "Đi theo";
      b.addEventListener("click", () => (follow === id ? stopFollow() : startFollow(id)));
      d.append(b);
    }
    list.append(d);
  };
  row(me.color, (me.name || "Bạn") + " (bạn)", zoneName(player.x, player.z, player.base), null);
  for (const [id, s] of Net.peers) row(s.c, s.n, zoneName(s.x, s.z, s.y), id);
}
function startFollow(id) {
  const s = Net.peers.get(id); if (!s) return;
  follow = id; $("follow-text").textContent = "Đang đi theo " + s.n; $("follow-bar").hidden = false; renderPeople();
}
function stopFollow() { if (!follow) return; follow = null; $("follow-bar").hidden = true; renderPeople(); }
$("unfollow").addEventListener("click", stopFollow);
$("people-btn").addEventListener("click", () => {
  const p = $("people-panel"); p.hidden = !p.hidden; $("people-btn").setAttribute("aria-expanded", String(!p.hidden)); if (!p.hidden) renderPeople();
});
document.querySelectorAll("[data-emote]").forEach((b) => b.addEventListener("click", () => {
  const em = b.dataset.emote;
  Net.update({ emote: em, emoteAt: Date.now() });
  me.emote = em; me.emoteUntil = performance.now() + 1800; showMyBubble(EMOTES[em]);
  addLog("Bạn", EMOTES[em]);
}));
$("chatbox").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("say").value.replace(/\s+/g, " ").trim().slice(0, 80); if (!t) return;
  Net.update({ say: t, sayAt: Date.now() }); showMyBubble(t); addLog("Bạn", t);
  $("say").value = ""; $("say").blur();
});
function showMyBubble(text) {
  if (!me.fig) return; disposeSprite(me.bubble);
  me.bubble = tagSprite(text, null, 2.6); me.bubble.position.y = 2.5; me.fig.add(me.bubble); me.bubbleUntil = performance.now() + 6000;
}
// QR invite (only when hosted on the web, e.g. Vercel)
const hosted = !window.claude && /^https?:$/.test(location.protocol);
$("qr-btn").hidden = !hosted;
let qrMade = false;
$("qr-btn").addEventListener("click", () => {
  const url = location.href.split("#")[0];
  if (!qrMade && window.QRCode) { new QRCode($("qr"), { text: url, width: 220, height: 220 }); qrMade = true; }
  $("qr-url").textContent = url; $("qr-modal").hidden = false;
});
$("qr-close").addEventListener("click", () => { $("qr-modal").hidden = true; });

Net.onChange((type, id) => {
  if (type === "join" || type === "update") {
    const fresh = !avatars.has(id);
    ensureAvatar(id);
    if (type === "join" && fresh && performance.now() - joinedAt > 2500) addLog(null, Net.peers.get(id).n + " vừa vào bảo tàng");
  } else if (type === "leave") {
    const a = avatars.get(id); if (a) addLog(null, a.name + " đã rời đi");
    removeAvatar(id);
  }
  if (type !== "update" || !$("people-panel").hidden) renderPeople();
});

/* ================= main loop ================= */
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
let camDist = 0;
const sent = { t: 0, x: 0, z: 0, yaw: 0, m: false, y: 0 };
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();

let last = performance.now(), lastZone = "";
const fwd = new THREE.Vector3(), head = new THREE.Vector3();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;

  // --- my movement
  player.moving = false;
  if (started && !infoOpen) {
    let f = 0, s = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1; if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD) s += 1; if (keys.KeyA) s -= 1;
    if (keys.ArrowLeft) player.yaw += 1.8 * dt; if (keys.ArrowRight) player.yaw -= 1.8 * dt;
    f -= joyY; s += joyX;
    const len = Math.hypot(f, s);
    if (len > 0.08) {
      if (follow) stopFollow();
      const run = keys.ShiftLeft || keys.ShiftRight;
      const sp = (run ? 10 : 5.5) * Math.min(1, len) * dt;
      f /= Math.max(1, len); s /= Math.max(1, len);
      const sn = Math.sin(player.yaw), cs = Math.cos(player.yaw);
      const dx = (-sn * f + cs * s) * sp, dz = (-cs * f - sn * s) * sp;
      if (free(player.x + dx, player.z + dz)) { player.x += dx; player.z += dz; }
      else if (free(player.x + dx, player.z)) player.x += dx;
      else if (free(player.x, player.z + dz)) player.z += dz;
      player.moving = true; player.phase += dt * (run ? 16 : 12);
    }
    // follow mode
    if (follow) {
      const a = avatars.get(follow);
      if (!a) stopFollow();
      else {
        const k = Math.min(1, dt * 3);
        const bx = a.x + Math.sin(a.yaw) * 2, bz = a.z + Math.cos(a.yaw) * 2;
        const ok = free(bx, bz), tx = ok ? bx : a.x, tz = ok ? bz : a.z;
        const nx = player.x + (tx - player.x) * k, nz = player.z + (tz - player.z) * k;
        if (Math.hypot(nx - player.x, nz - player.z) > 0.01) { player.moving = true; player.phase += dt * 9; }
        if (free(nx, nz)) { player.x = nx; player.z = nz; }
        else if (Math.hypot(a.x - player.x, a.z - player.z) > 4) { player.x = a.x; player.z = a.z; }
        player.yaw += angDiff(a.yaw, player.yaw) * k;
      }
    }
  }

  // --- camera
  fwd.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
  if (player.jy > 0 || player.vy > 0) { player.vy -= 15 * dt; player.jy += player.vy * dt; if (player.jy <= 0) { player.jy = 0; player.vy = 0; } }
  updateElevator(dt);
  head.set(player.x, player.base + EYE + player.jy + (thirdPerson ? 0.25 : 0), player.z);
  if (thirdPerson) {
    ray.set(head, fwd.clone().negate()); ray.far = 3.4;
    const hit = ray.intersectObjects(solids, false)[0];
    camDist = hit ? Math.max(0.5, hit.distance - 0.3) : 3.4;
    camera.position.copy(head).addScaledVector(fwd, -camDist);
  } else { camDist = 0; camera.position.copy(head); }
  camera.rotation.set(player.pitch, player.yaw, 0);

  // --- my figure
  if (me.fig) {
    me.fig.visible = thirdPerson && started;
    me.fig.position.set(player.x, player.base + player.jy, player.z); me.fig.rotation.y = player.yaw;
    pose(me.fig, player.phase, player.moving ? 1 : 0, now < me.emoteUntil ? me.emote : null, t);
    if (me.bubble) me.bubble.visible = now < me.bubbleUntil;
  }

  // --- peers
  const k = Math.min(1, dt * 8);
  for (const [id, a] of avatars) {
    const s = Net.peers.get(id); if (!s) continue;
    const ox = a.x, oz = a.z;
    a.x += (s.x - a.x) * k; a.z += (s.z - a.z) * k; a.yaw += angDiff(s.yaw, a.yaw) * k;
    const speed = Math.hypot(a.x - ox, a.z - oz) / Math.max(dt, 1e-3);
    a.walk += ((speed > 0.4 || s.m ? 1 : 0) - a.walk) * Math.min(1, dt * 6);
    a.phase += dt * 9 * a.walk;
    a.y += ((s.y || 0) - a.y) * Math.min(1, dt * 12); a.fig.position.set(a.x, a.y, a.z); a.fig.rotation.y = a.yaw;
    pose(a.fig, a.phase, a.walk, now < a.emoteUntil ? a.emote : null, t);
    if (a.bubble) a.bubble.visible = now < a.bubbleUntil;
  }

  // --- send my state
  if (started && Net.mode !== "solo" && now - sent.t > (player.jy > 0 ? 80 : 200)) {
    if (Math.abs(player.x - sent.x) > 0.05 || Math.abs(player.z - sent.z) > 0.05 || Math.abs(player.yaw - sent.yaw) > 0.05 || player.moving !== sent.m || Math.abs(player.base + player.jy - sent.y) > 0.05) {
      sent.t = now; sent.y = player.base + player.jy; sent.x = player.x; sent.z = player.z; sent.yaw = player.yaw; sent.m = player.moving;
      Net.update({ x: +player.x.toFixed(2), z: +player.z.toFixed(2), yaw: +player.yaw.toFixed(2), m: player.moving, y: +(player.base + player.jy).toFixed(2) });
    }
  }

  // --- ambient animation
  for (const fl of flags) {
    const p = fl.geo.attributes.position, b = fl.base;
    for (let i = 0; i < p.count; i++) { const x = b[i * 3]; p.array[i * 3 + 2] = Math.sin(x * 2.2 - t * 3 + fl.ph) * 0.14 * ((x + 1.5) / 3); }
    p.needsUpdate = true;
  }
  for (const sp of spinners) sp.obj.rotation.y += sp.speed * dt;
  animatePond(t, dt);
  updateStatueSprite();
  // the statue is built from a front and a back image: turn it so the viewer always sees one of them, never the thin edge
  if (statueBoard) {
    const face = (window.STATUE && window.STATUE.faceY) || 0;
    const toCam = Math.atan2(camera.position.x - statueBoard.position.x, camera.position.z - statueBoard.position.z);
    const target = Math.abs(angDiff(toCam, face)) < H2 ? toCam : toCam + PI;
    statueBoard.rotation.y += angDiff(target, statueBoard.rotation.y) * Math.min(1, dt * 10);
  }

  // --- prompt + HUD
  if (started && !infoOpen) {
    target = pick(innerWidth / 2, innerHeight / 2, 4.5);
    const pr = $("prompt");
    elevAction = elevatorPrompt();
    if (elevAction) { pr.textContent = ""; const b = document.createElement("b"); b.textContent = elevAction.label; pr.append(b, document.createTextNode(isTouch ? " · Chạm vào đây" : " · Nhấn E")); pr.hidden = false; }
    else if (target) { pr.textContent = ""; const b = document.createElement("b"); b.textContent = target.title; pr.append(b, document.createTextNode(isTouch ? " · Chạm để xem" : " · Nhấn E hoặc bấm để xem")); pr.hidden = false; }
    else pr.hidden = true;
    const zone = zoneName(player.x, player.z, player.base);
    if (zone !== lastZone) { $("room").textContent = zone; lastZone = zone; if (!$("people-panel").hidden) renderPeople(); }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/* ================= start ================= */
const COLORS = ["#d62828", "#f77f00", "#2a9d8f", "#1d4ed8", "#7b2cbf", "#222222"];
const swWrap = $("swatches");
let saved = {}; try { saved = JSON.parse(localStorage.getItem("museum-me") || "{}"); } catch (e) {}
me.color = COLORS.includes(saved.c) ? saved.c : COLORS[Math.floor(Math.random() * COLORS.length)];
$("nick").value = typeof saved.n === "string" ? saved.n : "";
COLORS.forEach((c, i) => {
  const b = document.createElement("button"); b.type = "button"; b.className = "sw"; b.style.background = c;
  b.setAttribute("aria-label", "Màu " + (i + 1)); b.setAttribute("aria-pressed", String(c === me.color));
  b.addEventListener("click", () => { me.color = c; swWrap.querySelectorAll(".sw").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
  swWrap.append(b);
});
$("mode-note").textContent = window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL ? "Chế độ nhiều người: bật. Ai mở link này đều thấy nhau."
  : window.claude ? "Chế độ nhiều người qua claude.ai: người được chia sẻ link sẽ thấy nhau."
  : "Đang chạy chế độ một người (chưa cấu hình Firebase).";

$("go").addEventListener("click", () => {
  me.name = $("nick").value.replace(/\s+/g, " ").trim().slice(0, 24) || "Khách " + Math.floor(100 + Math.random() * 900);
  try { localStorage.setItem("museum-me", JSON.stringify({ n: me.name, c: me.color })); } catch (e) {}
  started = true; joinedAt = performance.now();
  $("start").hidden = true; $("hud").hidden = false; $("dot").hidden = thirdPerson; $("people-btn").hidden = false;
  if (isTouch) joy.hidden = false;
  setMyFigure();
  renderPeople();
  Net.start({ x: +player.x.toFixed(2), z: +player.z.toFixed(2), yaw: 0, n: me.name, c: me.color, m: false });
});

window.__museum = { player, avatars, scene, camera }; // tiện kiểm tra khi phát triển
async function init() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load(`700 40px "Noto Serif"`), document.fonts.load(`600 40px "Be Vietnam Pro"`), document.fonts.load(`400 40px "Be Vietnam Pro"`)]),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch (e) {}
  buildOutdoor(); buildBuilding(); buildStatue(); buildGarden(); buildVehicles(); buildHall(); buildUpperFloor(); buildRooms(); loadCases();
  requestAnimationFrame(frame);
  $("go").disabled = false; $("go").textContent = "Vào bảo tàng";
}
init();
})();
