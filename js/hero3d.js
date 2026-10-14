/* ==========================================================================
   jfchaney.com — hero 3D
   Four objects from the story on this page, lit like product shots. Every few
   seconds the current one burns away into copper particles that swirl and
   re-form as the next:

     01  bronze medallion — "Clean since 2009"
     02  kraft shipping box — the RIC2 warehouse floor
     03  laptop typing its own code — the builder, RVA Digital Works
     04  violet resin d20 — off the clock

   Every texture is painted in code at load time (no image downloads).
   three.js r169 is vendored in /js/vendor — no build step, no CDN.
   Drag to spin, click to skip ahead, dots to jump, button to pause.
   Add ?hero-debug to the URL to expose window.jfHero for testing.
   ========================================================================== */

import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/three-0.169.0/addons/RoundedBoxGeometry.js';

const stage = document.getElementById('hero3d');

/* ---------------------------------------------------------------- config */

const STORY = [
  { key: 'medallion', num: '01', title: 'Clean since 2009', sub: 'the day it turned', hold: 6.0 },
  { key: 'box', num: '02', title: 'RIC2', sub: 'started over on the warehouse floor', hold: 5.5 },
  { key: 'laptop', num: '03', title: 'The builder', sub: 'RVA Digital Works', hold: 8.0 },
  { key: 'd20', num: '04', title: 'Off the clock', sub: 'a little goofy, a little nerdy', hold: 5.5 },
];

// How each object idles. spin = rad/s around Y. front/amp/freq = gentle sway
// around a 3/4 product angle. pitch = tilt toward camera. spinX = tumble.
const MOTION = {
  medallion: { spin: 0.55, pitch: 0.06 },
  box: { front: -0.62, amp: 0.3, freq: 0.32, pitch: 0.36 },
  laptop: { front: -0.42, amp: 0.26, freq: 0.28, pitch: 0.26 },
  d20: { spin: 0.42, spinX: 0.24 },
};

const FIT = { medallion: 1.34, box: 1.36, laptop: 1.6, d20: 1.2 };

const TRANS_DUR = 3.3;   // seconds per morph
const INTRO_DUR = 2.8;
const OUT_END = 0.38;    // morph timeline: 0..OUT_END old object burns away,
const IN_START = 0.62;   // OUT_END..IN_START pure particle swirl, IN_START..1 new one forms

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

let MAX_ANISO = 4;
let TEX = 1;

/* =================================================================== main */

async function main() {
  const canvas = stage.querySelector('canvas');
  const capEl = stage.querySelector('[data-hero-cap]');
  const dots = [...stage.querySelectorAll('[data-hero-dot]')];
  const pauseBtn = stage.querySelector('[data-hero-pause]');
  const DEBUG = new URLSearchParams(location.search).has('hero-debug');

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = matchMedia('(max-width: 800px)').matches;
  const lowPower = small || (navigator.hardwareConcurrency || 8) <= 4;
  const COUNT = lowPower ? 5200 : 11000;
  TEX = lowPower ? 0.62 : 1;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    stage.classList.add('is-fallback');
    return;
  }
  MAX_ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer);
  scene.environmentIntensity = 1.0;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const CAM_Y = 0.5;

  // a few direct lights for crisp highlights on top of the studio reflections
  const key = new THREE.DirectionalLight(0xffe2c0, 2.1); key.position.set(4, 6, 5);
  const rimV = new THREE.DirectionalLight(0x9b82ff, 2.4); rimV.position.set(-6, 2.5, -4);
  const rimC = new THREE.DirectionalLight(0xffb45a, 1.3); rimC.position.set(6, -1, -5);
  scene.add(key, rimV, rimC);

  const tilt = new THREE.Group();   // pointer parallax
  const pivot = new THREE.Group();  // idle motion + drag
  pivot.rotation.order = 'XYZ';
  scene.add(tilt);
  tilt.add(pivot);

  // soft copper light pool under the object
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: radialTexture(), color: 0xe0a94e, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = -1.72;
  pool.scale.set(4.4, 3.2, 1);
  tilt.add(pool);

  /* ------------------------------------------------------------- objects */

  await waitForFonts();

  const objects = new Array(STORY.length).fill(null);
  const builders = { medallion: buildMedallion, box: buildBox, laptop: buildLaptop, d20: buildD20 };

  function prepare(i) {
    if (objects[i]) return objects[i];
    const s = STORY[i];
    const o = builders[s.key]();
    o.key = s.key;
    o.index = i;
    normalize(o, FIT[s.key]);
    // per-mesh reflection strength (e.g. keep the laptop screen readable under the softbox)
    o.root.traverse((m) => {
      if (m.isMesh && m.userData.envIntensity !== undefined) {
        m.material.envMap = scene.environment;
        m.material.envMapIntensity = m.userData.envIntensity;
      }
    });
    finalizeObject(o, COUNT);
    o.root.visible = false;
    pivot.add(o.root);
    // warm up the shaders now so the first morph doesn't stutter
    o.root.visible = true;
    try { renderer.compile(scene, camera); } catch (e) { /* non-fatal */ }
    o.root.visible = false;
    objects[i] = o;
    return o;
  }

  const particles = buildParticles(COUNT);
  pivot.add(particles.points);

  /* --------------------------------------------------------------- state */

  const st = {
    cur: -1, from: -1, to: 0, phase: 'trans', T: 0, dur: INTRO_DUR, hold: 0,
    paused: reduceMotion, frozen: false, queued: -1,
    time: 0,
    yaw: 0, pitch: 0, yawBase: 0, pitchBase: 0, dragVel: 0, dragPitch: 0,
    motion: MOTION[STORY[0].key],
  };

  function setCaption(i) {
    const s = STORY[i];
    if (capEl) {
      capEl.classList.add('is-swapping');
      setTimeout(() => {
        capEl.querySelector('[data-cap-num]').textContent = `${s.num} / 0${STORY.length}`;
        capEl.querySelector('[data-cap-title]').textContent = s.title;
        capEl.querySelector('[data-cap-sub]').textContent = s.sub;
        capEl.classList.remove('is-swapping');
      }, 260);
    }
    dots.forEach((d, k) => {
      d.classList.toggle('is-on', k === i);
      if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
    });
  }

  function startTransition(to) {
    const A = st.cur >= 0 ? objects[st.cur] : null;
    const B = prepare(to);
    st.from = st.cur;
    st.to = to;
    st.phase = 'trans';
    st.T = 0;
    st.dur = A ? TRANS_DUR : INTRO_DUR;
    particles.load(A, B);
    particles.points.visible = true;
    if (A) { A.root.visible = true; setDissolve(A, 'out', -1); }
    B.root.visible = true;
    setDissolve(B, 'in', -1);
    if (B.onShow) B.onShow();
    retarget(B.key);
    setCaption(to);
  }

  function finishTransition() {
    const A = st.from >= 0 ? objects[st.from] : null;
    const B = objects[st.to];
    if (A && A !== B) { A.root.visible = false; if (A.onHide) A.onHide(); }
    setDissolve(B, 'idle');
    particles.points.visible = false;
    st.cur = st.to;
    st.from = -1;
    st.phase = 'hold';
    st.hold = 0;
    if (st.queued >= 0 && st.queued !== st.cur) { const q = st.queued; st.queued = -1; goTo(q); }
    else st.queued = -1;
  }

  // swap without the particle morph (reduced motion)
  function snapTo(i) {
    const B = prepare(i);
    objects.forEach((o) => { if (o && o !== B) { o.root.visible = false; if (o.onHide) o.onHide(); } });
    B.root.visible = true;
    setDissolve(B, 'idle');
    if (B.onShow) B.onShow(true);
    particles.points.visible = false;
    st.cur = i; st.to = i; st.from = -1; st.phase = 'hold'; st.hold = 0;
    retarget(B.key, true);
    setCaption(i);
  }

  function goTo(i) {
    i = ((i % STORY.length) + STORY.length) % STORY.length;
    if (st.phase === 'trans') { st.queued = i; return; }
    if (i === st.cur) return;
    if (reduceMotion) snapTo(i); else startTransition(i);
  }

  // point the idle motion at the new object, from wherever we are now
  function retarget(keyName, snap) {
    const m = MOTION[keyName];
    st.motion = m;
    if (!m.spin) {
      const f = m.front || 0;
      st.yawBase = f + TAU * Math.round((st.yaw - f) / TAU);
    } else {
      st.yawBase = st.yaw;
    }
    st.pitchBase = m.spinX ? st.pitch : TAU * Math.round(st.pitch / TAU);
    if (snap) {
      st.yaw = st.yawBase + (m.amp || 0) * Math.sin(st.time * (m.freq || 0.3));
      st.pitch = st.pitchBase + (m.pitch || 0);
    }
  }

  function setDissolve(o, mode, cut) {
    const u = o.du;
    if (mode === 'out') { u.uDir.value = 1; u.uUseY.value = 0; u.uFRange.value.copy(o.fOutRange); u.uCut.value = cut; }
    else if (mode === 'in') { u.uDir.value = -1; u.uUseY.value = 1; u.uFRange.value.copy(o.fInRange); u.uCut.value = cut; }
    else { u.uDir.value = 1; u.uCut.value = -2; }
  }

  /* ------------------------------------------------------------ controls */

  dots.forEach((d, k) => d.addEventListener('click', (e) => { e.stopPropagation(); goTo(k); }));
  function setPaused(p) {
    st.paused = p;
    if (pauseBtn) {
      pauseBtn.setAttribute('aria-pressed', p ? 'true' : 'false');
      pauseBtn.setAttribute('aria-label', p ? 'Play animation' : 'Pause animation');
      pauseBtn.classList.toggle('is-paused', p);
    }
  }
  if (pauseBtn) pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); setPaused(!st.paused); });
  setPaused(st.paused);

  // drag to spin, click/tap to skip ahead
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), lastX: e.clientX, lastT: performance.now(), moved: 0 };
    stage.classList.add('is-dragging');
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const now = performance.now();
    const dx = e.clientX - drag.lastX;
    drag.moved += Math.abs(dx) + Math.abs(e.clientY - drag.y) * 0.2;
    st.yawBase += dx * 0.0085;
    st.dragPitch = clamp((e.clientY - drag.y) * 0.004, -0.5, 0.5);
    const dt = Math.max(1, now - drag.lastT);
    st.dragVel = lerp(st.dragVel, (dx * 0.0085) / (dt / 1000), 0.5);
    drag.lastX = e.clientX; drag.lastT = now;
  });
  function endDrag() {
    if (!drag) return;
    const quick = performance.now() - drag.t < 350 && drag.moved < 8;
    drag = null;
    st.dragPitch = 0;
    stage.classList.remove('is-dragging');
    if (quick) { st.dragVel = 0; goTo((st.phase === 'trans' ? st.to : st.cur) + 1); }
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', () => { if (drag) { drag = null; st.dragPitch = 0; stage.classList.remove('is-dragging'); } });

  // parallax toward the pointer
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const r = stage.getBoundingClientRect();
    ptr.tx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 0.75), -1, 1);
    ptr.ty = clamp((e.clientY - (r.top + r.height / 2)) / (r.height * 0.75), -1, 1);
  }, { passive: true });

  /* -------------------------------------------------------------- sizing */

  let dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 1.75);
  let pxH = 1;
  const uiEl = stage.querySelector('.hero3d-ui');
  function resize() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the object centered in the space above the caption + controls
    const uiH = Math.min(h * 0.3, uiEl ? uiEl.offsetHeight + 14 : 0);
    const hEff = Math.max(1, h - uiH);
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const dist = 2.08 / (Math.tan(halfFov) * (hEff / h)) / Math.min(1, w / hEff);
    camera.position.set(0, CAM_Y, dist);
    camera.lookAt(0, 0, 0);
    camera.setViewOffset(w, h, 0, uiH / 2, w, h);
    camera.updateProjectionMatrix();
    pxH = h * dpr;
    particles.mat.uniforms.uScale.value = pxH / (2 * Math.tan(halfFov));
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  /* ---------------------------------------------------------------- loop */

  let running = false, raf = 0, last = performance.now();
  let inView = true;
  const perf = { n: 0, sum: 0, settled: false };

  function update(dt) {
    const m = st.motion;
    const live = !st.paused && !st.frozen;
    if (live) st.time += dt;

    // morph timeline
    if (st.phase === 'trans' && !st.frozen) {
      st.T += dt / st.dur;
      if (st.T >= 1) finishTransition();
    } else if (st.phase === 'hold' && live) {
      st.hold += dt;
      if (st.hold > STORY[st.cur].hold) goTo(st.cur + 1);
    }
    applyTimeline();

    // idle motion
    if (live) {
      st.yawBase += (m.spin || 0) * dt;
      st.pitchBase += (m.spinX || 0) * dt;
    }
    st.yawBase += st.dragVel * dt;
    st.dragVel *= Math.exp(-dt * (drag ? 12 : 2.6));
    const yawT = st.yawBase + (m.amp || 0) * Math.sin(st.time * (m.freq || 0.3));
    const pitchT = st.pitchBase + (m.pitch || 0) + st.dragPitch;
    const k = 1 - Math.exp(-dt * (drag ? 14 : 3.2));
    st.yaw += (yawT - st.yaw) * k;
    st.pitch += (pitchT - st.pitch) * k;
    pivot.rotation.set(st.pitch, st.yaw, 0);
    pivot.position.y = Math.sin(st.time * 1.15) * 0.055;

    ptr.x += (ptr.tx - ptr.x) * (1 - Math.exp(-dt * 3));
    ptr.y += (ptr.ty - ptr.y) * (1 - Math.exp(-dt * 3));
    tilt.rotation.y = ptr.x * 0.24;
    tilt.rotation.x = ptr.y * 0.12;

    particles.mat.uniforms.uTime.value += dt;

    // tick the laptop's typing if it's on screen
    objects.forEach((o) => { if (o && o.root.visible && o.tick) o.tick(dt, st); });
  }

  function applyTimeline() {
    if (st.phase !== 'trans') return;
    const T = st.T;
    const A = st.from >= 0 ? objects[st.from] : null;
    const B = objects[st.to];
    if (A) A.du.uCut.value = (T / OUT_END) * 1.04 - 0.02;
    B.du.uCut.value = ((T - IN_START) / (1 - IN_START)) * 1.04 - 0.02;
    particles.mat.uniforms.uT.value = T;
    const swirl = Math.sin(Math.PI * clamp(T, 0, 1));
    pool.material.opacity = 0.2 * (1 - 0.55 * swirl);
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    update(dt);
    renderer.render(scene, camera);
    adaptQuality(dt);
  }

  // drop resolution a notch if the device is struggling
  function adaptQuality(dt) {
    if (perf.settled) return;
    perf.n++;
    if (perf.n < 30) return;
    perf.sum += dt;
    if (perf.n >= 120) {
      const avg = perf.sum / 90;
      if (avg > 0.026 && dpr > 1) { dpr = Math.max(1, dpr - 0.35); resize(); perf.n = 0; perf.sum = 0; }
      else perf.settled = true;
    }
  }

  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) { last = performance.now(); raf = requestAnimationFrame(frame); }
    else cancelAnimationFrame(raf);
  }
  const syncRunning = () => setRunning(inView && !document.hidden);
  new IntersectionObserver((entries) => { inView = entries[0].isIntersecting; syncRunning(); }, { threshold: 0.02 }).observe(stage);
  document.addEventListener('visibilitychange', syncRunning);

  /* --------------------------------------------------------------- start */

  prepare(0);
  if (reduceMotion) snapTo(0); else startTransition(0);
  renderer.render(scene, camera);
  stage.classList.add('is-ready');
  syncRunning();

  // build the rest in the background, one per idle slot
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 120));
  let nextBuild = 1;
  (function buildNext() {
    if (nextBuild >= STORY.length) return;
    idle(() => { prepare(nextBuild++); buildNext(); }, { timeout: 1500 });
  })();

  if (DEBUG) {
    window.jfHero = {
      goTo,
      pause: () => setPaused(true),
      play: () => setPaused(false),
      // freeze a morph from object a to b at timeline T (0..1) for screenshots
      freeze(a, b, T, yaw) {
        for (let i = 0; i < STORY.length; i++) prepare(i);
        objects.forEach((o) => { o.root.visible = false; });
        st.frozen = true;
        if (a === b || T >= 1) {
          snapTo(b);
        } else {
          st.cur = a; st.phase = 'hold';
          objects[a].root.visible = true;
          startTransition(b);
          st.T = T;
          applyTimeline();
        }
        if (typeof yaw === 'number') { st.yawBase = yaw; st.yaw = yaw; }
        st.pitch = st.pitchBase + (st.motion.pitch || 0);
        update(0); renderer.render(scene, camera);
      },
      render: () => { update(0); renderer.render(scene, camera); },
      // advance the simulation by `sec` seconds at 60 fps without waiting on real frames
      step(sec) {
        st.frozen = false;
        for (let i = 0, n = Math.round(sec * 60); i < n; i++) update(1 / 60);
        renderer.render(scene, camera);
        return { cur: st.cur, to: st.to, phase: st.phase, T: +st.T.toFixed(2), hold: +st.hold.toFixed(2) };
      },
      state: st,
      objects,
      renderer,
    };
  }
}

/* ============================================================ environment */

// A small virtual photo studio: dark room, warm key softbox, violet and copper
// strip lights. Pre-filtered into an environment map, so metal, resin and glass
// pick up believable reflections in the site's own palette.
function buildEnvironment(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(
    new THREE.SphereGeometry(30, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.011, 0.014), side: THREE.BackSide })
  ));
  const plane = new THREE.PlaneGeometry(1, 1);
  const panel = (hex, intensity, pos, sx, sy) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity), side: THREE.DoubleSide });
    const m = new THREE.Mesh(plane, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.scale.set(sx, sy, 1);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(0xffe1bd, 6.0, [7, 7, 7], 7, 5);       // big warm key, upper right front
  panel(0xffffff, 2.6, [0, 11, 1], 12, 2.4);   // overhead strip
  panel(0x8a6fd6, 6.5, [-9, 2, -6], 2.2, 10);  // violet rim strip
  panel(0xe0a94e, 4.5, [9, 0.5, -7], 1.8, 9);  // copper strip
  panel(0xdfe7ff, 1.5, [-6, -1, 10], 6, 3);    // cool front fill
  panel(0x3b2614, 1.0, [0, -10, 0], 20, 20);   // warm floor bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  env.traverse((o) => { if (o.material) o.material.dispose(); });
  plane.dispose();
  return rt.texture;
}

function radialTexture() {
  const c = makeCanvas(256, 256);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

async function waitForFonts() {
  if (!document.fonts || !document.fonts.load) return;
  const want = [
    '800 120px "Sora"', '700 120px "Bricolage Grotesque"', '600 60px "Bricolage Grotesque"',
    '500 40px "JetBrains Mono"', '400 40px "JetBrains Mono"',
  ];
  await Promise.race([
    Promise.all(want.map((f) => document.fonts.load(f).catch(() => null))),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
}

/* ======================================================= texture helpers */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w));
  c.height = Math.max(2, Math.round(h));
  return c;
}
const gray = (v) => { const g = Math.round(clamp(v, 0, 1) * 255); return `rgb(${g},${g},${g})`; };

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise2D(seed) {
  const r = mulberry32(seed);
  const P = new Float32Array(65536);
  for (let i = 0; i < P.length; i++) P[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8;
    return lerp(lerp(P[y0 | x0], P[y0 | x1], u), lerp(P[y1 | x0], P[y1 | x1], u), v);
  };
}
function fbm(n, x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); norm += a; a *= 0.5; f *= 2.03; }
  return s / norm;
}

function tex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

function readGray(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const H = new Float32Array(c.width * c.height);
  for (let i = 0, j = 0; i < H.length; i++, j += 4) H[i] = d[j] / 255;
  return H;
}

function blurField(H, w, h, passes) {
  const tmp = new Float32Array(H.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const l = x > 0 ? x - 1 : x, r = x < w - 1 ? x + 1 : x;
        tmp[row + x] = (H[row + l] + H[row + x] * 2 + H[row + r]) * 0.25;
      }
    }
    for (let y = 0; y < h; y++) {
      const u = (y > 0 ? y - 1 : y) * w, m = y * w, d = (y < h - 1 ? y + 1 : y) * w;
      for (let x = 0; x < w; x++) H[m + x] = (tmp[u + x] + tmp[m + x] * 2 + tmp[d + x]) * 0.25;
    }
  }
  return H;
}

// height field -> tangent-space normal map (canvas y runs down, texture v runs up)
function normalFromHeight(H, w, h, strength) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const yu = (y > 0 ? y - 1 : y) * w, yd = (y < h - 1 ? y + 1 : y) * w, row = y * w;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
      const nx = -(H[row + xr] - H[row + xl]) * strength;
      const ny = -(H[yu + x] - H[yd + x]) * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (row + x) * 4;
      d[i] = (nx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// G = roughness, B = metalness (how three.js reads roughnessMap / metalnessMap)
function packORM(roughC, metalC) {
  const w = roughC.width, h = roughC.height;
  const r = roughC.getContext('2d').getImageData(0, 0, w, h).data;
  const m = metalC ? metalC.getContext('2d').getImageData(0, 0, w, h).data : null;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 255; d[i + 1] = r[i]; d[i + 2] = m ? m[i] : 0; d[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Paint color / height / roughness / metal layers together with one painter.
function paintSurface(w, h, painter, opts = {}) {
  const color = makeCanvas(w, h), height = makeCanvas(w, h), rough = makeCanvas(w, h), metal = makeCanvas(w, h);
  const L = {
    cx: color.getContext('2d'), hx: height.getContext('2d'), rx: rough.getContext('2d'), mx: metal.getContext('2d'),
    w: color.width, h: color.height,
  };
  L.hx.fillStyle = gray(0.5); L.hx.fillRect(0, 0, L.w, L.h);
  L.rx.fillStyle = gray(opts.rough ?? 0.5); L.rx.fillRect(0, 0, L.w, L.h);
  L.mx.fillStyle = gray(opts.metal ?? 0); L.mx.fillRect(0, 0, L.w, L.h);
  painter(L);
  const H = readGray(height);
  if (opts.heightPost) opts.heightPost(H, L.w, L.h);
  blurField(H, L.w, L.h, opts.blur ?? 1);
  const normal = normalFromHeight(H, L.w, L.h, (opts.normal ?? 4) * (L.w / 1024));
  const sample = { data: L.cx.getImageData(0, 0, L.w, L.h).data, w: L.w, h: L.h };
  return {
    map: tex(color, true), normalMap: tex(normal, false), ormMap: tex(packORM(rough, metal), false),
    sample, canvas: color,
  };
}

function disk(ctx, x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = fill; ctx.fill(); }

// text along a circle. top: reads clockwise over the top; bottom: reads left->right under the bottom
function arcText(ctx, text, cx, cy, r, centerAng, top, spacing = 0) {
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  const dir = top ? 1 : -1;
  let ang = centerAng - dir * (total / r) / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  chars.forEach((ch, i) => {
    const a = ang + dir * (widths[i] / 2) / r;
    ctx.save();
    ctx.translate(cx + r * Math.cos(a), cy + r * Math.sin(a));
    ctx.rotate(top ? a + Math.PI / 2 : a - Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    ang += dir * (widths[i] + spacing) / r;
  });
  ctx.restore();
}

function star(ctx, x, y, r, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    if (i === 0) ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    else ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  ctx.closePath();
  ctx.fill();
}

function fitFont(ctx, weight, family, text, size, maxW) {
  ctx.font = `${weight} ${size}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w > maxW) { size *= maxW / w; ctx.font = `${weight} ${size}px ${family}`; }
  return size;
}

function toRoman(n) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
  return s;
}

const SORA = '"Sora", "Arial Black", sans-serif';
const BRIC = '"Bricolage Grotesque", "Arial", sans-serif';
const MONO = '"JetBrains Mono", "Consolas", monospace';

/* ===================================================== 01 · the medallion */

function coinFace(S, side) {
  const c = S / 2, R = (S / 2) * 0.998;
  const hC = makeCanvas(S, S);
  const hx = hC.getContext('2d');
  hx.fillStyle = gray(0.3); hx.fillRect(0, 0, S, S);

  // raised rim with a sloped inner wall
  disk(hx, c, c, R, gray(0.9));
  const wall = hx.createRadialGradient(c, c, R * 0.865, c, c, R * 0.918);
  wall.addColorStop(0, gray(0.3)); wall.addColorStop(1, gray(0.74));
  disk(hx, c, c, R * 0.918, wall);
  disk(hx, c, c, R * 0.865, gray(0.3));

  // bead ring + inner line
  for (let i = 0; i < 100; i++) {
    const a = (i / 100) * TAU;
    disk(hx, c + Math.cos(a) * R * 0.835, c + Math.sin(a) * R * 0.835, R * 0.0105, gray(0.72));
  }
  hx.strokeStyle = gray(0.68); hx.lineWidth = R * 0.011;
  hx.beginPath(); hx.arc(c, c, R * 0.585, 0, TAU); hx.stroke();

  // ring lettering
  const fs = R * 0.112;
  hx.fillStyle = gray(0.8);
  hx.font = `700 ${fs}px ${BRIC}`;
  const cap = fs * 0.72, mid = R * 0.712;
  const ring = side === 'front' ? ['STILL HERE', 'STILL GRATEFUL'] : ['ONE DAY AT A TIME', 'JAKE CHANEY'];
  arcText(hx, ring[0], c, c, mid - cap / 2, -Math.PI / 2, true, fs * 0.16);
  arcText(hx, ring[1], c, c, mid + cap / 2, Math.PI / 2, false, fs * 0.16);
  hx.fillStyle = gray(0.78);
  star(hx, c - mid, c, R * 0.042);
  star(hx, c + mid, c, R * 0.042);

  // center
  hx.textAlign = 'center';
  hx.textBaseline = 'alphabetic';
  if (side === 'front') {
    hx.fillStyle = gray(0.74);
    fitFont(hx, 600, BRIC, 'CLEAN SINCE', R * 0.082, R * 0.7);
    hx.fillText('CLEAN SINCE', c, c - R * 0.205);
    hx.fillStyle = gray(0.92);
    fitFont(hx, 800, SORA, '2009', R * 0.4, R * 0.98);
    hx.fillText('2009', c, c + R * 0.13);
    hx.fillStyle = gray(0.74);
    fitFont(hx, 600, BRIC, 'RICHMOND · VA', R * 0.068, R * 0.62);
    hx.fillText('RICHMOND · VA', c, c + R * 0.31);
    hx.fillRect(c - R * 0.3, c - R * 0.165, R * 0.6, R * 0.012);
  } else {
    const years = Math.max(1, new Date().getFullYear() - 2009);
    const roman = toRoman(years);
    hx.fillStyle = gray(0.78);
    star(hx, c, c - R * 0.29, R * 0.05);
    hx.fillStyle = gray(0.92);
    fitFont(hx, 800, SORA, roman, R * 0.36, R * 0.96);
    hx.fillText(roman, c, c + R * 0.12);
    hx.fillStyle = gray(0.74);
    fitFont(hx, 600, BRIC, 'YEARS', R * 0.08, R * 0.6);
    hx.fillText('YEARS', c, c + R * 0.3);
  }

  // height -> antique-bronze color, roughness and normals
  const H = readGray(hC);
  const rnd = mulberry32(side === 'front' ? 11 : 12);
  for (let i = 0; i < H.length; i++) if (H[i] < 0.36) H[i] += (rnd() - 0.5) * 0.035; // sandblasted field
  blurField(H, S, S, Math.max(1, Math.round(2 * TEX)));
  const Hw = blurField(Float32Array.from(H), S, S, Math.round(7 * TEX));
  const n = noise2D(side === 'front' ? 21 : 22);

  const col = makeCanvas(S, S), orm = makeCanvas(S, S);
  const cctx = col.getContext('2d'), octx = orm.getContext('2d');
  const ci = cctx.createImageData(S, S), oi = octx.createImageData(S, S);
  const cd = ci.data, od = oi.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x, j = i * 4;
      const h = H[i];
      const raised = sstep(0.42, 0.72, h);
      const cav = clamp((Hw[i] - h) * 4.2, 0, 1);
      const m = fbm(n, x / (S * 0.09), y / (S * 0.09), 3);
      const wear = 0.88 + m * 0.24;
      let r = lerp(146, 232, raised) * wear, g = lerp(96, 176, raised) * wear, b = lerp(54, 110, raised) * wear;
      r = lerp(r, 62, cav * 0.85); g = lerp(g, 40, cav * 0.85); b = lerp(b, 24, cav * 0.85);
      cd[j] = r; cd[j + 1] = g; cd[j + 2] = b; cd[j + 3] = 255;
      const rough = clamp(lerp(0.46, 0.19, raised) + cav * 0.28 + (m - 0.5) * 0.12, 0.08, 1);
      od[j] = 255; od[j + 1] = rough * 255; od[j + 2] = (1 - cav * 0.35) * 255; od[j + 3] = 255;
    }
  }
  cctx.putImageData(ci, 0, 0);
  octx.putImageData(oi, 0, 0);
  const normal = normalFromHeight(H, S, S, 9 * TEX);
  return { map: tex(col, true), normalMap: tex(normal, false), ormMap: tex(orm, false), sample: { data: cd, w: S, h: S } };
}

function buildMedallion() {
  const S = Math.round(1024 * TEX);
  const front = coinFace(S, 'front'), back = coinFace(S, 'back');
  const R = 1.3, T = 0.15, B = 0.045;

  const faceMat = (s) => new THREE.MeshPhysicalMaterial({
    map: s.map, normalMap: s.normalMap, roughnessMap: s.ormMap, metalnessMap: s.ormMap,
    roughness: 1, metalness: 1,
  });
  const faceGeo = new THREE.CircleGeometry(R - B, 160);
  const fMesh = new THREE.Mesh(faceGeo, faceMat(front));
  fMesh.position.z = T / 2;
  fMesh.userData.sample = front.sample;
  const bMesh = new THREE.Mesh(faceGeo.clone(), faceMat(back));
  bMesh.rotation.y = Math.PI;
  bMesh.position.z = -T / 2;
  bMesh.userData.sample = back.sample;

  // rounded edge: lathe a profile that wraps from the back face to the front
  const pts = [];
  const N = 10;
  for (let i = 0; i <= N; i++) { const a = -Math.PI / 2 + (i / N) * (Math.PI / 2); pts.push(new THREE.Vector2(R - B + B * Math.cos(a), -T / 2 + B + B * Math.sin(a))); }
  for (let i = 0; i <= N; i++) { const a = (i / N) * (Math.PI / 2); pts.push(new THREE.Vector2(R - B + B * Math.cos(a), T / 2 - B + B * Math.sin(a))); }
  const edgeGeo = new THREE.LatheGeometry(pts, 160);
  edgeGeo.rotateX(Math.PI / 2);
  const edge = new THREE.Mesh(edgeGeo, new THREE.MeshPhysicalMaterial({ color: srgbColor(206, 150, 92), metalness: 1, roughness: 0.3 }));
  edge.userData.flat = [206, 150, 92];

  const content = new THREE.Group();
  content.add(fMesh, bMesh, edge);
  const root = new THREE.Group();
  root.add(content);
  return { root, content };
}

function srgbColor(r, g, b) { return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace); }

/* ============================================== 02 · the RIC2 shipping box */

function kraft(L, seed, flutesVertical) {
  const { cx, hx, rx, w, h } = L;
  const r = mulberry32(seed);
  cx.fillStyle = 'rgb(166,126,86)';
  cx.fillRect(0, 0, w, h);
  const big = Math.max(w, h);
  for (let i = 0; i < 28; i++) {
    const x = r() * w, y = r() * h, rad = (0.12 + r() * 0.4) * big;
    const g = cx.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.5;
    g.addColorStop(0, dark ? 'rgba(118,80,44,0.13)' : 'rgba(218,176,124,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, w, h);
  }
  const fibers = Math.round((w * h) / 85);
  for (let i = 0; i < fibers; i++) {
    const x = r() * w, y = r() * h, len = (2 + r() * 10) * TEX, a = r() * TAU;
    cx.strokeStyle = r() < 0.55 ? `rgba(104,70,38,${0.05 + r() * 0.12})` : `rgba(232,196,148,${0.04 + r() * 0.1})`;
    cx.lineWidth = 0.5 + r() * 0.9;
    cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); cx.stroke();
  }
  for (let i = 0; i < fibers / 6; i++) {
    cx.fillStyle = `rgba(70,46,26,${0.1 + r() * 0.25})`;
    cx.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5);
    hx.fillStyle = gray(0.5 + (r() - 0.5) * 0.12);
    hx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
  // handling grime toward the edges
  const e = Math.min(w, h) * 0.07;
  [[0, 0, w, e, 0, 0, 0, e], [0, h - e, w, e, 0, h, 0, h - e], [0, 0, e, h, 0, 0, e, 0], [w - e, 0, e, h, w, 0, w - e, 0]].forEach(([x, y, ww, hh, x0, y0, x1, y1]) => {
    const g = cx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(70,46,24,0.22)'); g.addColorStop(1, 'rgba(70,46,24,0)');
    cx.fillStyle = g; cx.fillRect(x, y, ww, hh);
  });
  rx.fillStyle = gray(0.86); rx.fillRect(0, 0, w, h);
  // corrugation flutes showing through the liner
  const pitch = 9 * TEX, n = flutesVertical ? w : h;
  for (let t = 0; t < n; t++) {
    hx.fillStyle = gray(0.5 + Math.sin((t / pitch) * TAU) * 0.022);
    if (flutesVertical) hx.fillRect(t, 0, 1, h); else hx.fillRect(0, t, w, 1);
  }
}

function tape(L, x, y, w, h, jaggedEnd) {
  const { cx, hx, rx } = L;
  const r = mulberry32(Math.round(x * 7 + y * 13));
  const path = (ctx) => {
    ctx.beginPath();
    if (jaggedEnd) {
      ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h);
      const teeth = 9;
      for (let i = 1; i <= teeth; i++) ctx.lineTo(x + w - (w * i) / teeth, y + h - (i % 2 ? h * 0.025 : 0));
      ctx.closePath();
    } else ctx.rect(x, y, w, h);
  };
  cx.save(); path(cx); cx.clip();
  cx.fillStyle = 'rgba(190,146,86,0.6)'; cx.fillRect(x, y, w, h);
  const g = cx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, 'rgba(255,236,200,0.18)'); g.addColorStop(0.5, 'rgba(255,236,200,0.02)'); g.addColorStop(1, 'rgba(255,236,200,0.14)');
  cx.fillStyle = g; cx.fillRect(x, y, w, h);
  for (let i = 0; i < 14; i++) {
    cx.strokeStyle = `rgba(255,240,210,${0.06 + r() * 0.1})`; cx.lineWidth = 1 + r() * 2;
    const px = x + r() * w, py = y + r() * h;
    cx.beginPath(); cx.moveTo(px, py); cx.lineTo(px + (r() - 0.5) * w * 0.6, py + (r() - 0.5) * h * 0.6); cx.stroke();
  }
  cx.restore();
  cx.strokeStyle = 'rgba(120,84,40,0.35)'; cx.lineWidth = 1.2; path(cx); cx.stroke();

  hx.save(); path(hx); hx.clip();
  hx.fillStyle = gray(0.58); hx.fillRect(x, y, w, h);
  for (let i = 0; i < 10; i++) {
    hx.strokeStyle = gray(0.58 + (r() - 0.5) * 0.12); hx.lineWidth = 2 + r() * 3;
    const px = x + r() * w, py = y + r() * h;
    hx.beginPath(); hx.moveTo(px, py); hx.lineTo(px + (r() - 0.5) * w, py + (r() - 0.5) * h); hx.stroke();
  }
  hx.restore();
  rx.save(); path(rx); rx.fillStyle = gray(0.34); rx.fill(); rx.restore();
}

const INK = 'rgba(38,26,16,0.86)';

function upArrows(cx, x, y, s) {
  cx.save();
  cx.fillStyle = INK;
  cx.strokeStyle = INK;
  for (const dx of [-0.32, 0.32]) {
    const ax = x + dx * s;
    cx.beginPath();
    cx.moveTo(ax, y - s * 0.55); cx.lineTo(ax - s * 0.2, y - s * 0.22); cx.lineTo(ax - s * 0.07, y - s * 0.22);
    cx.lineTo(ax - s * 0.07, y + s * 0.32); cx.lineTo(ax + s * 0.07, y + s * 0.32); cx.lineTo(ax + s * 0.07, y - s * 0.22);
    cx.lineTo(ax + s * 0.2, y - s * 0.22); cx.closePath(); cx.fill();
  }
  cx.fillRect(x - s * 0.56, y + s * 0.4, s * 1.12, s * 0.08);
  cx.font = `700 ${s * 0.17}px ${BRIC}`;
  cx.textAlign = 'center';
  cx.fillText('THIS SIDE UP', x, y + s * 0.78);
  cx.restore();
}

function fragileGlass(cx, x, y, s) {
  cx.save();
  cx.strokeStyle = INK; cx.lineWidth = s * 0.06; cx.lineJoin = 'round';
  cx.beginPath();
  cx.moveTo(x - s * 0.3, y - s * 0.5); cx.lineTo(x + s * 0.3, y - s * 0.5);
  cx.quadraticCurveTo(x + s * 0.32, y + s * 0.02, x, y + s * 0.08);
  cx.quadraticCurveTo(x - s * 0.32, y + s * 0.02, x - s * 0.3, y - s * 0.5);
  cx.moveTo(x, y + s * 0.08); cx.lineTo(x, y + s * 0.42);
  cx.moveTo(x - s * 0.2, y + s * 0.45); cx.lineTo(x + s * 0.2, y + s * 0.45);
  cx.moveTo(x - s * 0.05, y - s * 0.5); cx.lineTo(x + s * 0.06, y - s * 0.3); cx.lineTo(x - s * 0.04, y - s * 0.18); cx.lineTo(x + s * 0.04, y - s * 0.05);
  cx.stroke();
  cx.restore();
}

function stampText(cx, text, x, y, size, angle, color, seed) {
  cx.save();
  cx.translate(x, y); cx.rotate(angle);
  cx.font = `800 ${size}px ${SORA}`;
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  const tw = cx.measureText(text).width;
  const st = makeCanvas(tw + size * 0.9, size * 1.7);
  const s = st.getContext('2d');
  s.font = cx.font; s.textAlign = 'center'; s.textBaseline = 'middle';
  s.fillStyle = color; s.strokeStyle = color; s.lineWidth = size * 0.08;
  s.strokeRect(size * 0.15, size * 0.12, st.width - size * 0.3, st.height - size * 0.24);
  s.fillText(text, st.width / 2, st.height / 2 + size * 0.04);
  // worn ink
  const r = mulberry32(seed);
  s.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < (st.width * st.height) / 40; i++) {
    s.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`;
    s.fillRect(r() * st.width, r() * st.height, 1 + r() * 2.5, 1 + r() * 2.5);
  }
  cx.globalAlpha = 0.85;
  cx.drawImage(st, -st.width / 2, -st.height / 2);
  cx.restore();
}

function shippingLabel(L, x, y, lw, lh, angle) {
  const { cx, hx, rx } = L;
  const r = mulberry32(2009);
  const tr = (ctx) => { ctx.translate(x + lw / 2, y + lh / 2); ctx.rotate(angle); ctx.translate(-lw / 2, -lh / 2); };

  hx.save(); tr(hx); hx.fillStyle = gray(0.6); hx.fillRect(0, 0, lw, lh); hx.restore();
  rx.save(); tr(rx); rx.fillStyle = gray(0.58); rx.fillRect(0, 0, lw, lh); rx.restore();

  cx.save(); tr(cx);
  cx.shadowColor = 'rgba(40,24,10,0.35)'; cx.shadowBlur = lw * 0.02;
  cx.fillStyle = '#efebe2'; cx.fillRect(0, 0, lw, lh);
  cx.shadowBlur = 0;
  const p = lw * 0.06, ink = '#1b1916';
  cx.fillStyle = ink; cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
  const t = (txt, fx, fy, size, weight = 600, font = BRIC) => { cx.font = `${weight} ${size}px ${font}`; cx.fillText(txt, fx, fy); };
  t('FROM:', p, p + lw * 0.05, lw * 0.035, 700);
  t('J. CHANEY', p + lw * 0.13, p + lw * 0.05, lw * 0.04, 600);
  t('HIGHLAND SPRINGS, VA', p + lw * 0.13, p + lw * 0.1, lw * 0.04, 600);
  cx.fillRect(p, lh * 0.19, lw - p * 2, Math.max(1.5, lw * 0.005));
  t('SHIP TO:', p, lh * 0.27, lw * 0.035, 700);
  t('JAKE CHANEY', p + lw * 0.06, lh * 0.345, lw * 0.07, 800, SORA);
  t('RICHMOND, VIRGINIA', p + lw * 0.06, lh * 0.41, lw * 0.05, 600);
  cx.fillRect(p, lh * 0.45, lw - p * 2, Math.max(1.5, lw * 0.005));
  // routing block
  cx.fillRect(p, lh * 0.49, lw * 0.52, lh * 0.2);
  cx.fillStyle = '#efebe2';
  cx.textAlign = 'center';
  t('RIC2', p + lw * 0.26, lh * 0.655, lh * 0.15, 800, SORA);
  cx.fillStyle = ink; cx.textAlign = 'left';
  t('PKG', p + lw * 0.6, lh * 0.53, lw * 0.035, 700);
  t('1 OF 1', p + lw * 0.6, lh * 0.6, lw * 0.06, 800, SORA);
  t('NIGHT SHIFT', p + lw * 0.6, lh * 0.67, lw * 0.033, 700);
  // barcode
  let bx = p;
  const by = lh * 0.73, bh = lh * 0.15;
  while (bx < lw - p) {
    const bw = (1 + Math.floor(r() * 4)) * lw * 0.0042;
    if (r() > 0.42) cx.fillRect(bx, by, bw, bh);
    bx += bw + lw * 0.0042 * (1 + Math.floor(r() * 2));
  }
  t('TRK# 1RVA 2009 0017 RIC2', p, lh * 0.94, lw * 0.036, 500, MONO);
  cx.restore();
}

function buildBox() {
  const W = 1.9, Hh = 1.25, D = 1.35;
  const ppu = 540 * TEX; // canvas pixels per unit
  const face = (fw, fh, seed, painter, flutesVertical = true) => paintSurface(fw * ppu, fh * ppu, (L) => {
    kraft(L, seed, flutesVertical);
    painter(L);
  }, { rough: 0.86, normal: 3.2, blur: 1 });

  const tapeW = D * 0.24 * ppu;

  const right = face(D, Hh, 3, (L) => {
    tape(L, L.w / 2 - tapeW / 2, 0, tapeW, L.h * 0.3, true);
    upArrows(L.cx, L.w * 0.5, L.h * 0.58, L.h * 0.3);
  });
  const left = face(D, Hh, 4, (L) => {
    tape(L, L.w / 2 - tapeW / 2, 0, tapeW, L.h * 0.3, true);
    upArrows(L.cx, L.w * 0.5, L.h * 0.58, L.h * 0.3);
  });
  const top = face(W, D, 5, (L) => {
    // flap seam along the long axis, taped
    L.cx.fillStyle = 'rgba(60,40,20,0.55)'; L.cx.fillRect(0, L.h / 2 - 1.5, L.w, 3);
    L.hx.fillStyle = gray(0.3); L.hx.fillRect(0, L.h / 2 - 2, L.w, 4);
    tape(L, 0, L.h / 2 - tapeW / 2, L.w, tapeW, false);
  }, false);
  const bottom = face(W, D, 6, () => {}, false);
  const front = face(W, Hh, 7, (L) => {
    shippingLabel(L, L.w * 0.47, L.h * 0.14, L.w * 0.44, L.h * 0.7, -0.018);
    upArrows(L.cx, L.w * 0.19, L.h * 0.3, L.h * 0.26);
    L.cx.fillStyle = INK; L.cx.font = `700 ${L.h * 0.05}px ${BRIC}`; L.cx.textAlign = 'left';
    L.cx.fillText('HANDLE WITH CARE', L.w * 0.07, L.h * 0.84);
  });
  const back = face(W, Hh, 8, (L) => {
    stampText(L.cx, 'FRAGILE', L.w * 0.42, L.h * 0.45, L.h * 0.16, -0.12, 'rgb(168,36,28)', 77);
    fragileGlass(L.cx, L.w * 0.8, L.h * 0.45, L.h * 0.36);
    upArrows(L.cx, L.w * 0.15, L.h * 0.42, L.h * 0.24);
  });

  const faces = [right, left, top, bottom, front, back]; // BoxGeometry group order: +x -x +y -y +z -z
  const mats = faces.map((f) => new THREE.MeshPhysicalMaterial({
    map: f.map, normalMap: f.normalMap, roughnessMap: f.ormMap, metalnessMap: f.ormMap,
    roughness: 1, metalness: 1, sheen: 0.25, sheenRoughness: 0.8, sheenColor: srgbColor(214, 170, 120),
  }));
  const geo = new RoundedBoxGeometry(W, Hh, D, 3, 0.03);
  const mesh = new THREE.Mesh(geo, mats);
  mesh.userData.sampleByGroup = faces.map((f) => f.sample);

  const content = new THREE.Group();
  content.add(mesh);
  const root = new THREE.Group();
  root.add(content);
  return { root, content };
}

/* ========================================================= 03 · the laptop */

const CODE = [
  [['// jfchaney.com — built in Richmond, VA', 'com']],
  [['const ', 'kw'], ['jake', 'id'], [' = {', 'p']],
  [['  from', 'prop'], [':    ', 'p'], ['"Highland Springs, VA"', 'str'], [',', 'p']],
  [['  clean', 'prop'], [':   ', 'p'], ['2009', 'num'], [',', 'p']],
  [['  shipped', 'prop'], [': [', 'p'], ['"RIC2"', 'str'], [', ', 'p'], ['"Seattle"', 'str'], [', ', 'p'], ['"GovWin"', 'str'], ['],', 'p']],
  [['  builds', 'prop'], [':  ', 'p'], ['"things that help people show up"', 'str'], [',', 'p']],
  [['  home', 'prop'], [':    ', 'p'], ['"Richmond, VA"', 'str'], [',', 'p']],
  [['};', 'p']],
  [],
  [['while', 'kw'], [' (', 'p'], ['jake', 'id'], ['.', 'p'], ['isHere', 'prop'], [') {', 'p']],
  [['  jake', 'id'], ['.', 'p'], ['showUp', 'fn'], ['();', 'p']],
  [['  jake', 'id'], ['.', 'p'], ['keepPromises', 'fn'], ['();', 'p']],
  [['  jake', 'id'], ['.', 'p'], ['stayGrateful', 'fn'], ['();', 'p']],
  [['}', 'p']],
];
const CODE_COL = { com: '#6f6b64', kw: '#b39dff', id: '#f4f2ee', prop: '#e9dcc6', str: '#f2cd7f', num: '#e8a24c', fn: '#7fd3c5', p: '#9d9890' };
const CODE_TOTAL = CODE.reduce((n, line) => n + line.reduce((m, [t]) => m + t.length, 0) + 1, 0);

function drawCode(ctx, w, h, shown, cursorOn) {
  const s = w / 1280;
  ctx.fillStyle = '#0d1016'; ctx.fillRect(0, 0, w, h);
  // title bar + tab
  ctx.fillStyle = '#151922'; ctx.fillRect(0, 0, w, 52 * s);
  [['#3a3f4b', 34], ['#3a3f4b', 60], ['#3a3f4b', 86]].forEach(([c, x]) => disk(ctx, x * s, 26 * s, 7.5 * s, c));
  ctx.fillStyle = '#0d1016'; ctx.fillRect(120 * s, 10 * s, 190 * s, 42 * s);
  ctx.fillStyle = '#e0a94e'; ctx.fillRect(120 * s, 10 * s, 190 * s, 3 * s);
  ctx.font = `500 ${19 * s}px ${MONO}`; ctx.fillStyle = '#d9d4cb'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText('jake.js', 150 * s, 33 * s);
  ctx.fillStyle = '#5b5f69'; ctx.fillText('index.html', 345 * s, 33 * s);
  // status bar
  ctx.fillStyle = '#151922'; ctx.fillRect(0, h - 40 * s, w, 40 * s);
  ctx.font = `500 ${17 * s}px ${MONO}`; ctx.fillStyle = '#9d9890';
  ctx.fillText('⎇ master', 24 * s, h - 20 * s);
  ctx.fillStyle = '#7fd3c5'; ctx.fillText('✓ deployed', 160 * s, h - 20 * s);
  ctx.fillStyle = '#e0a94e'; ctx.textAlign = 'right'; ctx.fillText('RVA Digital Works', w - 24 * s, h - 20 * s);
  ctx.textAlign = 'left';

  // code
  const lh = 44 * s, top = 96 * s, gx = 92 * s, fs = 25 * s;
  ctx.font = `500 ${fs}px ${MONO}`;
  ctx.textBaseline = 'alphabetic';
  const cw = ctx.measureText('m').width;
  let left = shown, cursor = null;
  CODE.forEach((line, li) => {
    const y = top + li * lh;
    ctx.fillStyle = '#3a3e47'; ctx.textAlign = 'right';
    ctx.fillText(String(li + 1), gx - 26 * s, y);
    ctx.textAlign = 'left';
    let x = gx;
    for (const [txt, kind] of line) {
      if (left <= 0) break;
      const part = txt.slice(0, left);
      ctx.fillStyle = CODE_COL[kind];
      ctx.fillText(part, x, y);
      x += part.length * cw;
      left -= part.length;
    }
    if (left > 0) { left -= 1; cursor = [gx, y + lh]; }
    else if (!cursor) cursor = [x, y];
  });
  if (cursorOn && cursor) {
    ctx.fillStyle = '#f2cd7f';
    ctx.fillRect(cursor[0] + 2 * s, cursor[1] - fs * 0.85, cw * 0.55, fs * 1.05);
  }
}

function brushedAluminum(w, h, seed, logo) {
  return paintSurface(w, h, (L) => {
    const r = mulberry32(seed);
    L.cx.fillStyle = 'rgb(196,200,207)'; L.cx.fillRect(0, 0, L.w, L.h);
    for (let i = 0; i < L.h * 1.2; i++) {
      L.cx.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,42,48'},${0.008 + r() * 0.018})`;
      L.cx.fillRect(0, r() * L.h, L.w, 1);
      L.rx.fillStyle = gray(0.41 + r() * 0.04);
      L.rx.fillRect(0, r() * L.h, L.w, 1);
    }
    if (logo) {
      const cxp = L.w / 2, cyp = L.h / 2, s = L.h * 0.14;
      L.rx.fillStyle = gray(0.06);
      L.rx.font = `700 ${s * 1.5}px ${BRIC}`; L.rx.textAlign = 'center'; L.rx.textBaseline = 'middle';
      L.rx.fillText('J', cxp, cyp + s * 0.06);
      L.cx.fillStyle = 'rgba(255,236,200,0.22)';
      L.cx.font = L.rx.font; L.cx.textAlign = 'center'; L.cx.textBaseline = 'middle';
      L.cx.fillText('J', cxp, cyp + s * 0.06);
    }
  }, { rough: 0.42, metal: 1, normal: 0.6, blur: 1 });
}

function buildLaptop() {
  const BW = 2.5, BT = 0.075, BD = 1.7;
  const LW = 2.5, LH = 1.62, LT = 0.045;
  const alu = brushedAluminum(512 * TEX, 352 * TEX, 31, false);
  const aluLogo = brushedAluminum(512 * TEX, 332 * TEX, 32, true);
  const aluMat = (s) => new THREE.MeshPhysicalMaterial({
    map: s.map, normalMap: s.normalMap, roughnessMap: s.ormMap, metalnessMap: s.ormMap,
    roughness: 1, metalness: 1, clearcoat: 0.15, clearcoatRoughness: 0.4,
  });

  const content = new THREE.Group();

  // base
  const base = new THREE.Mesh(new RoundedBoxGeometry(BW, BT, BD, 2, 0.03), aluMat(alu));
  base.position.y = BT / 2;
  base.userData.sample = alu.sample;
  content.add(base);

  // keyboard deck + keys
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(2.26, 0.86), new THREE.MeshPhysicalMaterial({ color: srgbColor(14, 14, 17), roughness: 0.8, metalness: 0.1 }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(0, BT + 0.0006, -0.36);
  deck.userData.flat = [30, 30, 36];
  content.add(deck);

  const keyGeo = new RoundedBoxGeometry(0.118, 0.022, 0.112, 1, 0.014);
  const keyMat = new THREE.MeshPhysicalMaterial({ color: srgbColor(40, 41, 47), roughness: 0.46, metalness: 0.0, clearcoat: 0.25, clearcoatRoughness: 0.45 });
  const pitch = 0.1435;
  const keys = [];
  for (let row = 0; row < 5; row++) for (let col = 0; col < 15; col++) keys.push([(col - 7) * pitch, row, 1]);
  [0, 1, 2, 3].forEach((c) => keys.push([(c - 7) * pitch, 5, 1]));
  keys.push([0, 5, 6.85]); // space bar spans 7 slots
  [11, 12, 13, 14].forEach((c) => keys.push([(c - 7) * pitch, 5, 1]));
  const keyMesh = new THREE.InstancedMesh(keyGeo, keyMat, keys.length);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  keys.forEach(([x, row, wMul], i) => {
    sc.set(wMul === 1 ? 1 : (wMul * pitch - 0.025) / 0.118, 1, 1);
    ps.set(x, BT + 0.012, -0.72 + row * 0.136);
    mtx.compose(ps, q, sc);
    keyMesh.setMatrixAt(i, mtx);
  });
  keyMesh.userData.noSample = true;
  content.add(keyMesh);

  // trackpad
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.98, 0.004, 0.6, 2, 0.002), new THREE.MeshPhysicalMaterial({ color: srgbColor(150, 154, 160), metalness: 0, roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.3 }));
  pad.position.set(0, BT + 0.0005, 0.47);
  pad.userData.flat = [150, 154, 162];
  content.add(pad);

  // hinge
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 2.0, 24), new THREE.MeshPhysicalMaterial({ color: srgbColor(36, 37, 41), metalness: 0.6, roughness: 0.4 }));
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(0, BT + 0.012, -BD / 2 + 0.03);
  hinge.userData.flat = [60, 62, 68];
  content.add(hinge);

  // lid (opened ~103°)
  const lid = new THREE.Group();
  lid.position.set(0, BT + 0.012, -BD / 2 + 0.03);
  lid.rotation.x = -0.23;
  const lidMats = [aluMat(alu), aluMat(alu), aluMat(alu), aluMat(alu), aluMat(alu), aluMat(aluLogo)];
  const lidBox = new THREE.Mesh(new RoundedBoxGeometry(LW, LH, LT, 2, 0.02), lidMats);
  lidBox.position.y = LH / 2;
  lidBox.userData.sampleByGroup = [alu.sample, alu.sample, alu.sample, alu.sample, alu.sample, aluLogo.sample];
  lid.add(lidBox);

  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(LW - 0.07, LH - 0.07), new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 }));
  bezel.position.set(0, LH / 2, LT / 2 + 0.0008);
  bezel.userData.flat = [20, 20, 24];
  lid.add(bezel);

  const CW = Math.round(1280 * Math.max(0.7, TEX)), CH = Math.round(CW * 0.625);
  const screenCanvas = makeCanvas(CW, CH);
  const sctx = screenCanvas.getContext('2d');
  drawCode(sctx, CW, CH, CODE_TOTAL, false);
  const screenSample = { data: sctx.getImageData(0, 0, CW, CH).data, w: CW, h: CH, gain: 1.6 };
  drawCode(sctx, CW, CH, 0, true);
  const screenTex = tex(screenCanvas, true);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 1.4375),
    new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.05, metalness: 0, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 1.35, clearcoat: 1, clearcoatRoughness: 0.02 })
  );
  screen.position.set(0, LH / 2 + 0.03, LT / 2 + 0.0016);
  screen.userData.sample = screenSample;
  screen.userData.sampleWeight = 1.8;
  screen.userData.envIntensity = 0.22;
  lid.add(screen);
  content.add(lid);

  const root = new THREE.Group();
  root.add(content);

  // typing state
  const type = { shown: 0, acc: 0, wait: 0, blink: 0, cursorOn: true, lastShown: -1, lastCursor: null };
  const redraw = () => {
    if (type.shown === type.lastShown && type.cursorOn === type.lastCursor) return;
    drawCode(sctx, CW, CH, type.shown, type.cursorOn);
    screenTex.needsUpdate = true;
    type.lastShown = type.shown; type.lastCursor = type.cursorOn;
  };
  return {
    root, content,
    onShow(instant) { type.shown = instant ? CODE_TOTAL : 0; type.acc = 0; type.wait = instant ? 0 : 1.6; redraw(); },
    onHide() { type.shown = 0; redraw(); },
    tick(dt, st) {
      if (st.frozen) { type.shown = CODE_TOTAL; type.cursorOn = false; redraw(); return; }
      if (st.paused && type.shown === 0) { type.shown = CODE_TOTAL; }
      if (type.wait > 0) type.wait -= dt;
      else if (type.shown < CODE_TOTAL && !st.paused) {
        type.acc += dt * 52;
        const step = Math.floor(type.acc);
        if (step > 0) { type.acc -= step; type.shown = Math.min(CODE_TOTAL, type.shown + step); type.cursorOn = true; type.blink = 0; }
      }
      type.blink += dt;
      if (type.blink > 0.53) { type.blink = 0; type.cursorOn = !type.cursorOn; }
      redraw();
    },
  };
}

/* ============================================================ 04 · the d20 */

function buildD20() {
  const S = Math.round(1024 * TEX);
  const geo = new THREE.IcosahedronGeometry(1.18, 0); // 20 faces, non-indexed
  const pos = geo.attributes.position;
  const faces = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let f = 0; f < 20; f++) {
    a.fromBufferAttribute(pos, f * 3); b.fromBufferAttribute(pos, f * 3 + 1); c.fromBufferAttribute(pos, f * 3 + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    faces.push({ n, num: 0 });
  }
  // number the faces so opposite sides add up to 21, like a real d20
  const order = faces.map((_, i) => i).sort((i, j) => faces[j].n.y - faces[i].n.y || faces[j].n.x - faces[i].n.x);
  let k = 20;
  for (const i of order) {
    if (faces[i].num) continue;
    let opp = -1, best = 2;
    faces.forEach((g, j) => { const d = g.n.dot(faces[i].n); if (!g.num && j !== i && d < best) { best = d; opp = j; } });
    faces[i].num = k; faces[opp].num = 21 - k; k--;
    if (k <= 10) break;
  }

  // atlas: 5 x 4 cells, one equilateral triangle per face
  const cols = 5, rows = 4, cw = S / cols, ch = S / rows;
  const tw = cw * 0.92, th = (tw * Math.sqrt(3)) / 2;
  const uv = new Float32Array(60 * 2);
  const tri = [];
  for (let f = 0; f < 20; f++) {
    const col = f % cols, row = Math.floor(f / cols);
    const cxp = col * cw + cw / 2, cyp = row * ch + ch / 2;
    const apex = [cxp, cyp - th / 2], bl = [cxp - tw / 2, cyp + th / 2], br = [cxp + tw / 2, cyp + th / 2];
    tri.push({ apex, bl, br, cx: cxp, cy: cyp + th / 6, num: faces[f].num });
    [apex, bl, br].forEach(([px, py], v) => { uv[(f * 3 + v) * 2] = px / S; uv[(f * 3 + v) * 2 + 1] = 1 - py / S; });
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  // swirled violet resin, painted low-res then scaled up
  const SW = Math.round(384 * TEX);
  const swirl = makeCanvas(SW, SW);
  const sx = swirl.getContext('2d');
  const si = sx.createImageData(SW, SW);
  const n1 = noise2D(41), n2 = noise2D(42);
  for (let y = 0; y < SW; y++) for (let x = 0; x < SW; x++) {
    const u = (x / SW) * 6, v = (y / SW) * 6;
    const wx = fbm(n1, u, v, 3) * 3.2, wy = fbm(n2, u + 5.2, v + 1.3, 3) * 3.2;
    const t = fbm(n1, u + wx, v + wy, 4);
    const band = 0.5 + 0.5 * Math.sin(t * 22);
    const deep = sstep(0.25, 0.75, fbm(n2, u * 0.7 + 9, v * 0.7, 2));
    const r = lerp(lerp(64, 30, deep), 176, band * band * 0.75);
    const g = lerp(lerp(36, 18, deep), 146, band * band * 0.7);
    const bb = lerp(lerp(142, 70, deep), 246, band * band * 0.75);
    const j = (y * SW + x) * 4;
    si.data[j] = r; si.data[j + 1] = g; si.data[j + 2] = bb; si.data[j + 3] = 255;
  }
  sx.putImageData(si, 0, 0);

  const surf = paintSurface(S, S, (L) => {
    L.cx.imageSmoothingQuality = 'high';
    L.cx.drawImage(swirl, 0, 0, L.w, L.h);
    const r = mulberry32(20);
    // gold and pearl glitter
    for (let i = 0; i < 2200 * TEX; i++) {
      const x = r() * L.w, y = r() * L.h, s = 1 + r() * 1.8;
      const gold = r() < 0.6;
      L.cx.fillStyle = gold ? 'rgba(242,205,127,0.95)' : 'rgba(255,250,240,0.8)';
      L.cx.fillRect(x, y, s, s);
      L.mx.fillStyle = gray(gold ? 1 : 0.4); L.mx.fillRect(x, y, s, s);
      L.rx.fillStyle = gray(0.12); L.rx.fillRect(x, y, s, s);
    }
    // engraved, gold-filled numbers
    L.hx.fillStyle = gray(0.62); L.hx.fillRect(0, 0, L.w, L.h);
    tri.forEach(({ cx, cy, num, apex, bl, br }) => {
      // slight edge darkening toward the triangle rim gives a hint of depth in the resin
      L.cx.save();
      L.cx.beginPath(); L.cx.moveTo(apex[0], apex[1]); L.cx.lineTo(bl[0], bl[1]); L.cx.lineTo(br[0], br[1]); L.cx.closePath();
      L.cx.lineWidth = tw * 0.06; L.cx.strokeStyle = 'rgba(16,8,34,0.35)'; L.cx.stroke();
      L.cx.restore();
      const size = th * 0.4;
      const label = String(num);
      [L.cx, L.hx, L.rx, L.mx].forEach((ctx, li) => {
        ctx.save();
        ctx.font = `800 ${size}px ${SORA}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = li === 0 ? 'rgb(226,180,96)' : li === 1 ? gray(0.2) : li === 2 ? gray(0.32) : gray(1);
        ctx.fillText(label, cx, cy + size * 0.04);
        if (num === 6 || num === 9) ctx.fillRect(cx - size * 0.24, cy + size * 0.5, size * 0.48, size * 0.08);
        ctx.restore();
      });
    });
  }, { rough: 0.22, metal: 0, normal: 5, blur: Math.max(1, Math.round(2 * TEX)) });

  const mat = new THREE.MeshPhysicalMaterial({
    map: surf.map, normalMap: surf.normalMap, roughnessMap: surf.ormMap, metalnessMap: surf.ormMap,
    roughness: 1, metalness: 1, clearcoat: 0.7, clearcoatRoughness: 0.12,
    sheen: 0.4, sheenRoughness: 0.5, sheenColor: srgbColor(160, 130, 240),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.sample = surf.sample;
  const content = new THREE.Group();
  content.add(mesh);
  const root = new THREE.Group();
  root.add(content);
  return { root, content };
}

/* ======================================================= object plumbing */

// center the object and scale it to a common size
function normalize(o, radius) {
  o.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o.content);
  const center = box.getCenter(new THREE.Vector3());
  let maxD = 0;
  const v = new THREE.Vector3();
  o.content.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      maxD = Math.max(maxD, v.distanceTo(center));
    }
  });
  o.content.position.sub(center);
  o.root.scale.setScalar(radius / maxD);
  o.root.updateMatrixWorld(true);
}

/* ---- dissolve field: identical math in JS (particles) and GLSL (surfaces) */

const F = Math.fround, K1 = F(0.1031), K2 = F(31.32);
const fr = (x) => F(x - Math.floor(x));
function hash13(x, y, z) {
  let a = fr(F(x * K1)), b = fr(F(y * K1)), c = fr(F(z * K1));
  const d = F(F(F(a * F(c + K2)) + F(b * F(b + K2))) + F(c * F(a + K2)));
  a = F(a + d); b = F(b + d); c = F(c + d);
  return fr(F(F(a + b) * c));
}
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => hash13(ix + a, iy + b, iz + c);
  const mx = (p, q, t) => p * (1 - t) + q * t;
  return mx(
    mx(mx(h(0, 0, 0), h(1, 0, 0), ux), mx(h(0, 1, 0), h(1, 1, 0), ux), uy),
    mx(mx(h(0, 0, 1), h(1, 0, 1), ux), mx(h(0, 1, 1), h(1, 1, 1), ux), uy),
    uz
  );
}
function rawField(x, y, z, o, useY) {
  const n = 0.62 * vnoise(F(F(x * 1.7) + 3.1), F(y * 1.7), F(z * 1.7)) + 0.38 * vnoise(F(x * 4.1), F(F(y * 4.1) + 7.7), F(z * 4.1));
  const yN = clamp((y - o.boxMin.y) / o.boxSize.y, 0, 1);
  return 0.55 * n + 0.45 * (useY ? yN : 1 - yN);
}

const DISSOLVE_GLSL = /* glsl */`
uniform float uCut;
uniform float uDir;
uniform float uUseY;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec2 uFRange;
uniform vec3 uGlow;
varying vec3 vPivotPos;
float dHash(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float dNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dHash(i), dHash(i + vec3(1.0, 0.0, 0.0)), u.x), mix(dHash(i + vec3(0.0, 1.0, 0.0)), dHash(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(dHash(i + vec3(0.0, 0.0, 1.0)), dHash(i + vec3(1.0, 0.0, 1.0)), u.x), mix(dHash(i + vec3(0.0, 1.0, 1.0)), dHash(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}
float dField(vec3 p) {
  float n = 0.62 * dNoise(p * 1.7 + vec3(3.1, 0.0, 0.0)) + 0.38 * dNoise(p * 4.1 + vec3(0.0, 7.7, 0.0));
  float yN = clamp((p.y - uBoxMin.y) / uBoxSize.y, 0.0, 1.0);
  float f = 0.55 * n + 0.45 * mix(1.0 - yN, yN, uUseY);
  return clamp((f - uFRange.x) / (uFRange.y - uFRange.x), 0.0, 1.0);
}
`;

function patchMaterial(mat, o, toPivot) {
  const uniforms = Object.assign({ uToPivot: { value: toPivot } }, o.du);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uToPivot;\nvarying vec3 vPivotPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vPivotPos = (uToPivot * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vPivotPos = (uToPivot * vec4(transformed, 1.0)).xyz;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + DISSOLVE_GLSL)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  float dEdge = (dField(vPivotPos) - uCut) * uDir;
  if (dEdge < 0.0) discard;
  float dGlow = 1.0 - smoothstep(0.0, 0.065, dEdge);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uGlow * dGlow * dGlow;');
  };
  mat.customProgramCacheKey = () => 'jf-dissolve';
}

const GLOW = new THREE.Color(1.0, 0.4, 0.1).multiplyScalar(4.2);

function srgbToLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

// Patch materials for the burn effect and scatter COUNT sample points over the surface.
function finalizeObject(o, COUNT) {
  o.root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(o.root);
  o.boxMin = bb.min.clone();
  o.boxSize = bb.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.01, 0.01, 0.01));
  o.du = {
    uCut: { value: -2 }, uDir: { value: 1 }, uUseY: { value: 0 },
    uBoxMin: { value: o.boxMin }, uBoxSize: { value: o.boxSize },
    uFRange: { value: new THREE.Vector2(0, 1) }, uGlow: { value: GLOW },
  };

  // triangles in pivot space, area-weighted
  const tris = [];
  let total = 0;
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  o.root.traverse((m) => {
    if (!m.isMesh) return;
    const toPivot = m.matrixWorld.clone();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mat) => patchMaterial(mat, o, toPivot));
    if (m.isInstancedMesh || m.userData.noSample) return;
    const g = m.geometry;
    const p = g.attributes.position, uv = g.attributes.uv, idx = g.index;
    const triCount = (idx ? idx.count : p.count) / 3;
    const weight = m.userData.sampleWeight || 1;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      va.fromBufferAttribute(p, i0).applyMatrix4(toPivot);
      vb.fromBufferAttribute(p, i1).applyMatrix4(toPivot);
      vc.fromBufferAttribute(p, i2).applyMatrix4(toPivot);
      const cr = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va));
      const area = cr.length() * 0.5 * weight;
      if (area <= 1e-9) continue;
      let group = 0;
      if (g.groups.length) {
        const vi = t * 3;
        for (let gi = 0; gi < g.groups.length; gi++) { const G = g.groups[gi]; if (vi >= G.start && vi < G.start + G.count) { group = G.materialIndex; break; } }
      }
      total += area;
      tris.push({ a: va.clone(), b: vb.clone(), c: vc.clone(), n: cr.normalize(), uv: uv ? [i0, i1, i2] : null, uvAttr: uv, mesh: m, group, cum: total });
    }
  });

  const pos = new Float32Array(COUNT * 3), nrm = new Float32Array(COUNT * 3), col = new Float32Array(COUNT * 3);
  const fOut = new Float32Array(COUNT), fIn = new Float32Array(COUNT);
  const rnd = mulberry32(o.index * 97 + 5);
  const tmpUV = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
  for (let s = 0; s < COUNT; s++) {
    const target = rnd() * total;
    let lo = 0, hi = tris.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tris[mid].cum < target) lo = mid + 1; else hi = mid; }
    const T = tris[lo];
    let u = rnd(), v = rnd();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    const x = T.a.x * w + T.b.x * u + T.c.x * v, y = T.a.y * w + T.b.y * u + T.c.y * v, z = T.a.z * w + T.b.z * u + T.c.z * v;
    pos[s * 3] = x; pos[s * 3 + 1] = y; pos[s * 3 + 2] = z;
    nrm[s * 3] = T.n.x; nrm[s * 3 + 1] = T.n.y; nrm[s * 3 + 2] = T.n.z;

    // color from the painted texture where the point landed
    const ud = T.mesh.userData;
    const src = ud.sampleByGroup ? ud.sampleByGroup[T.group] : ud.sample;
    let r = 200, g = 150, b = 90, gain = 1;
    if (src && T.uv) {
      tmpUV[0].fromBufferAttribute(T.uvAttr, T.uv[0]); tmpUV[1].fromBufferAttribute(T.uvAttr, T.uv[1]); tmpUV[2].fromBufferAttribute(T.uvAttr, T.uv[2]);
      const su = tmpUV[0].x * w + tmpUV[1].x * u + tmpUV[2].x * v;
      const sv = tmpUV[0].y * w + tmpUV[1].y * u + tmpUV[2].y * v;
      const px = clamp(Math.floor(su * src.w), 0, src.w - 1), py = clamp(Math.floor((1 - sv) * src.h), 0, src.h - 1);
      const j = (py * src.w + px) * 4;
      r = src.data[j]; g = src.data[j + 1]; b = src.data[j + 2];
      gain = src.gain || 1;
    } else if (ud.flat) { [r, g, b] = ud.flat; }
    col[s * 3] = srgbToLinear(r) * gain; col[s * 3 + 1] = srgbToLinear(g) * gain; col[s * 3 + 2] = srgbToLinear(b) * gain;

    fOut[s] = rawField(x, y, z, o, false);
    fIn[s] = rawField(x, y, z, o, true);
  }

  // normalize each field to 0..1 over the surface (2nd..98th percentile) so the burn uses the whole timeline
  const range = (arr) => { const srt = Float32Array.from(arr).sort(); return new THREE.Vector2(srt[Math.floor(COUNT * 0.02)], srt[Math.floor(COUNT * 0.98)]); };
  o.fOutRange = range(fOut);
  o.fInRange = range(fIn);
  const norm = (arr, rg) => { for (let i = 0; i < arr.length; i++) arr[i] = clamp((arr[i] - rg.x) / (rg.y - rg.x), 0, 1); };
  norm(fOut, o.fOutRange);
  norm(fIn, o.fInRange);
  const az = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) az[i] = Math.atan2(pos[i * 3 + 2], pos[i * 3]) + (rnd() - 0.5) * 0.35;
  const order = Uint32Array.from(az.keys()).sort((i, j) => az[i] - az[j]);
  o.samples = { pos, nrm, col, fOut, fIn, order };
}

/* ============================================================== particles */

function buildParticles(COUNT) {
  const geo = new THREE.BufferGeometry();
  const mk = (n) => new THREE.BufferAttribute(new Float32Array(COUNT * n), n);
  const attrs = { position: mk(3), aTo: mk(3), aNFrom: mk(3), aNTo: mk(3), aCFrom: mk(3), aCTo: mk(3), aTimes: mk(2), aRand: mk(4) };
  Object.entries(attrs).forEach(([k, a]) => geo.setAttribute(k, a));
  const r = mulberry32(99);
  for (let i = 0; i < COUNT * 4; i++) attrs.aRand.array[i] = r();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 }, uTime: { value: 0 }, uSize: { value: 0.026 }, uScale: { value: 800 }, uFadeIn: { value: 0 },
      uEmber: { value: new THREE.Color(1.0, 0.42, 0.11).multiplyScalar(1.45) },
      uViolet: { value: new THREE.Color(0.42, 0.3, 1.0).multiplyScalar(1.4) },
    },
    vertexShader: /* glsl */`
      uniform float uT; uniform float uTime; uniform float uSize; uniform float uScale; uniform float uFadeIn; uniform vec3 uEmber; uniform vec3 uViolet;
      attribute vec3 aTo; attribute vec3 aNFrom; attribute vec3 aNTo; attribute vec3 aCFrom; attribute vec3 aCTo;
      attribute vec2 aTimes; attribute vec4 aRand;
      varying vec3 vColor; varying float vAlpha;
      vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
      void main() {
        float span = max(aTimes.y - aTimes.x, 0.001);
        float s = clamp((uT - aTimes.x) / span, 0.0, 1.0);
        float e = s * s * (3.0 - 2.0 * s);
        e = e * e * (3.0 - 2.0 * e);
        float arc = sin(3.14159265 * s);
        vec3 p = mix(position + aNFrom * 0.012, aTo + aNTo * 0.012, e);
        // lift off the old surface along its normal
        p += aNFrom * (0.1 + 0.25 * aRand.z) * sin(3.14159265 * clamp(s * 2.4, 0.0, 1.0)) * (1.0 - e);
        // mid-flight, get pulled into a spinning column of embers
        float hy = (aRand.w - 0.5) * 2.6;
        float arm = floor(aRand.x * 2.0) * 3.14159265;
        float th = arm + hy * 2.1 + s * 6.0 + uTime * 0.5 + (aRand.y - 0.5) * 0.24;
        float ringR = (0.5 + 0.38 * (hy + 1.3)) * (0.92 + 0.16 * aRand.z); // funnel: narrow at the bottom
        vec3 ring = vec3(cos(th) * ringR, hy, sin(th) * ringR);
        float pull = smoothstep(0.0, 0.55, arc) * (aRand.z > 0.82 ? 0.45 : 0.97);
        p = mix(p, ring, pull);
        p += vec3(sin(uTime * 2.1 + aRand.x * 40.0), sin(uTime * 1.7 + aRand.y * 50.0), cos(uTime * 1.9 + aRand.z * 60.0)) * 0.035 * arc;
        float live = step(aTimes.x, uT) * (1.0 - smoothstep(aTimes.y, aTimes.y + 0.03, uT));
        live *= mix(1.0, smoothstep(0.0, 0.35, s), uFadeIn);
        vec3 ember = aRand.x > 0.86 ? uViolet : uEmber * (0.75 + 0.5 * aRand.y);
        vColor = mix(mix(aCFrom, aCTo, e), ember, smoothstep(0.0, 0.6, arc)) * 0.8;
        vAlpha = live;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = live > 0.0 ? uSize * (0.55 + 0.9 * aRand.w) * (1.0 + 0.6 * arc) * uScale / -mv.z : 0.0;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d); a *= a;
        float core = smoothstep(0.16, 0.0, d);
        gl_FragColor = vec4(vColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb *= (a * 0.75 + core * 0.45) * vAlpha;
        gl_FragColor.a = a * vAlpha * 0.4;
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 2;

  // a loose spherical cloud for the very first build
  const cloud = { pos: new Float32Array(COUNT * 3), nrm: new Float32Array(COUNT * 3) };
  for (let i = 0; i < COUNT; i++) {
    const u = r() * 2 - 1, th = r() * TAU, rad = 2.0 + r() * 1.6;
    const sq = Math.sqrt(1 - u * u);
    const x = sq * Math.cos(th), y = u, z = sq * Math.sin(th);
    cloud.pos.set([x * rad, y * rad * 0.8, z * rad], i * 3);
    cloud.nrm.set([x, y, z], i * 3);
  }
  const ember = [srgbToLinear(224) * 1.2, srgbToLinear(169) * 1.2, srgbToLinear(78) * 1.2];

  function load(A, B) {
    const P = attrs.position.array, To = attrs.aTo.array, NF = attrs.aNFrom.array, NT = attrs.aNTo.array;
    const CF = attrs.aCFrom.array, CT = attrs.aCTo.array, TM = attrs.aTimes.array;
    const b = B.samples;
    for (let k = 0; k < COUNT; k++) {
      const ib = b.order[k];
      To[k * 3] = b.pos[ib * 3]; To[k * 3 + 1] = b.pos[ib * 3 + 1]; To[k * 3 + 2] = b.pos[ib * 3 + 2];
      NT[k * 3] = b.nrm[ib * 3]; NT[k * 3 + 1] = b.nrm[ib * 3 + 1]; NT[k * 3 + 2] = b.nrm[ib * 3 + 2];
      CT[k * 3] = b.col[ib * 3]; CT[k * 3 + 1] = b.col[ib * 3 + 1]; CT[k * 3 + 2] = b.col[ib * 3 + 2];
      const arrive = IN_START + (1 - IN_START) * (b.fIn[ib] + 0.02) / 1.04;
      let leave;
      if (A) {
        const a = A.samples, ia = a.order[k];
        P[k * 3] = a.pos[ia * 3]; P[k * 3 + 1] = a.pos[ia * 3 + 1]; P[k * 3 + 2] = a.pos[ia * 3 + 2];
        NF[k * 3] = a.nrm[ia * 3]; NF[k * 3 + 1] = a.nrm[ia * 3 + 1]; NF[k * 3 + 2] = a.nrm[ia * 3 + 2];
        CF[k * 3] = a.col[ia * 3]; CF[k * 3 + 1] = a.col[ia * 3 + 1]; CF[k * 3 + 2] = a.col[ia * 3 + 2];
        leave = OUT_END * (a.fOut[ia] + 0.02) / 1.04;
      } else {
        P[k * 3] = cloud.pos[k * 3]; P[k * 3 + 1] = cloud.pos[k * 3 + 1]; P[k * 3 + 2] = cloud.pos[k * 3 + 2];
        NF[k * 3] = cloud.nrm[k * 3]; NF[k * 3 + 1] = cloud.nrm[k * 3 + 1]; NF[k * 3 + 2] = cloud.nrm[k * 3 + 2];
        CF[k * 3] = ember[0]; CF[k * 3 + 1] = ember[1]; CF[k * 3 + 2] = ember[2];
        leave = attrs.aRand.array[k * 4 + 1] * 0.3;
      }
      TM[k * 2] = leave; TM[k * 2 + 1] = Math.max(arrive, leave + 0.24);
    }
    mat.uniforms.uFadeIn.value = A ? 0 : 1;
    mat.uniforms.uT.value = 0;
    Object.values(attrs).forEach((a) => { a.needsUpdate = true; });
  }

  return { points, mat, load };
}

/* ================================================================== start */

if (stage) {
  main().catch((err) => {
    console.warn('[hero3d]', err);
    stage.classList.add('is-fallback');
  });
}
