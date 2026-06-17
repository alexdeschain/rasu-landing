/* ============================================================
   РАСУ — 3D hero scene
   Stylised low-poly electrical substation. As `open` grows 0→1
   the roof lifts off and fades, the walls turn translucent, an
   interior teal "power-on" glow ramps up, and the CAMERA leans
   in and tilts down to look right inside at the transformers.

   Drive sources (max wins):
     • scroll progress  (main.js → setScrollProgress)
     • hover / click on the canvas
     • idle auto-demo    (slow open/close until the user interacts)

   Three.js r160 via CDN import map. No bundler.
   ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CONTAINER_ID = 'scene-container';

/* ---------- WebGL capability check (graceful fallback) ---------- */
function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}

function showFallback(container) {
  // Static substation photo instead of the canvas.
  container.classList.add('is-fallback');
  // The peek hint is meaningless without the live scene.
  const hint = document.getElementById('scene-hint');
  if (hint) hint.style.display = 'none';
}

/* ---------- Palette (matches site brand) ---------- */
const COLORS = {
  building:    0x55687e,
  buildingDark: 0x3a4a5c,
  roof:        0x61748a,
  base:        0x2a3a4d,
  ground:      0x1f2d40,
  metal:       0xaab6c6,   // lighter so equipment pops
  metalDark:   0x7a8a9c,
  transformer: 0xb4c0d0,   // light steel — stands out inside
  tank:        0x9aa8b8,
  insulator:   0xe6ecf2,
  copper:      0x39b59a,
  accent:      0x30ba9a,
  wire:        0x2a3a4e
};

/* ---------- Module state ---------- */
let scrollProgress = 0;     // 0..1 from main.js (scroll over hero)
let hoverProgress = 0;      // 0..1 toggled by hover
let clickProgress = 0;      // 0..1 toggled by click
let autoProgress = 0;       // 0..1 idle auto-demo
let openCurrent = 0;        // lerped actual open amount (drives everything)

let renderer, scene, camera, controls, clock;
let roof, building, equipment, interiorLight, sceneHint;
let wallMaterials = [];
let glowMeshes = [];        // meshes whose emissive ramps with open

let pointer = new THREE.Vector2();
let mouseParallax = new THREE.Vector2();
let reducedMotion = false;
let isMobile = false;
let userInteracted = false; // any hover/click/drag/scroll stops the auto-demo
let autoStartTime = 0;
let azimuth = 0;            // current orbit azimuth (auto-rotate + drag)
let dragAzimuth = 0;        // extra azimuth from user drag

/* ---------- Camera keyframes (interpolated by openCurrent) ----------
   Spherical orbit around an animated target. Closed = wide, premium
   establishing shot biased to the right (clear of the text gradient).
   Open  = closer, steeper top-down angle, target dropped INTO the box
   so we look straight inside at the transformers.                     */
const CAM = {
  closed: { radius: 15.0, polar: 1.16, targetY: 1.9, fov: 40 },
  open:   { radius: 8.7,  polar: 0.70, targetY: 1.15, fov: 47 }
};
const ORBIT_TARGET_X = 0;

/* ============================================================
   Geometry builders
   ============================================================ */

/** Cooling-fin radiator bank attached to a transformer side. */
function buildRadiator(material, fins) {
  const group = new THREE.Group();
  const finGeo = new THREE.BoxGeometry(0.05, 1.15, 0.62);
  const n = fins || 7;
  for (let i = 0; i < n; i++) {
    const fin = new THREE.Mesh(finGeo, material);
    fin.position.x = i * 0.13;
    fin.castShadow = true;
    group.add(fin);
  }
  // top + bottom header pipes that tie the fins together
  const headerGeo = new THREE.BoxGeometry(n * 0.13, 0.08, 0.16);
  const top = new THREE.Mesh(headerGeo, material); top.position.set((n - 1) * 0.065, 0.5, 0.0); group.add(top);
  const bot = new THREE.Mesh(headerGeo, material); bot.position.set((n - 1) * 0.065, -0.5, 0.0); group.add(bot);
  return group;
}

/** A single power transformer: tank + conservator + bushings + radiators.
 *  Built larger and more detailed so it reads clearly from above. */
function buildTransformer() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: COLORS.transformer, metalness: 0.6, roughness: 0.38 });
  const tankMat = new THREE.MeshStandardMaterial({ color: COLORS.tank, metalness: 0.55, roughness: 0.42 });
  const finMat  = new THREE.MeshStandardMaterial({ color: COLORS.metalDark, metalness: 0.65, roughness: 0.4 });
  const insMat  = new THREE.MeshStandardMaterial({ color: COLORS.insulator, metalness: 0.08, roughness: 0.65 });
  // Bushing caps get a faint teal emissive that ramps with "power on".
  const capMat  = new THREE.MeshStandardMaterial({ color: COLORS.accent, metalness: 0.4, roughness: 0.45, emissive: 0x30ba9a, emissiveIntensity: 0.0 });
  glowMeshes.push({ mat: capMat, base: 0.0, peak: 0.9 });

  // Main body (tank)
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.55, 1.4), bodyMat);
  body.position.y = 0.78;
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  // Lid plate
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.12, 1.48), finMat);
  lid.position.y = 1.58;
  lid.castShadow = true;
  group.add(lid);

  // Conservator tank (horizontal cylinder offset to the back)
  const cons = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 1.5, 18), tankMat);
  cons.rotation.z = Math.PI / 2;
  cons.position.set(0, 1.92, -0.55);
  cons.castShadow = true;
  group.add(cons);
  // saddle supports for the conservator
  [-0.55, 0.55].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.1), finMat);
    leg.position.set(x, 1.74, -0.55);
    group.add(leg);
  });

  // HV bushings / insulators on top (cone stack + cap), well-defined
  const bushPositions = [-0.5, 0, 0.5];
  bushPositions.forEach((x) => {
    // tapered porcelain stack
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.85, 16), insMat);
    stack.position.set(x, 2.06, 0.32);
    stack.castShadow = true;
    group.add(stack);
    // sheds (two discs) for a real-insulator silhouette
    [0.0, 0.28].forEach((dy) => {
      const shed = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16), insMat);
      shed.position.set(x, 1.95 + dy, 0.32);
      group.add(shed);
    });
    // glowing terminal cap
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 14), capMat);
    cap.position.set(x, 2.54, 0.32);
    cap.castShadow = true;
    group.add(cap);
  });

  // Radiators on both sides (taller, ribbed)
  const radL = buildRadiator(finMat, 7);
  radL.position.set(-1.32, 0.62, -0.1);
  group.add(radL);
  const radR = buildRadiator(finMat, 7);
  radR.position.set(0.95, 0.62, -0.1);
  group.add(radR);

  return group;
}

/** Lattice support pylon made of thin boxes. */
function buildPylon(height) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: COLORS.metalDark, metalness: 0.6, roughness: 0.4 });
  const legGeo = new THREE.BoxGeometry(0.07, height, 0.07);
  const w = 0.45;
  const offsets = [[-w, -w], [w, -w], [-w, w], [w, w]];
  offsets.forEach(([x, z]) => {
    const leg = new THREE.Mesh(legGeo, mat);
    leg.position.set(x, height / 2, z);
    leg.castShadow = true;
    leg.rotation.x = (z > 0 ? -1 : 1) * 0.04;
    leg.rotation.z = (x > 0 ? 1 : -1) * 0.04;
    group.add(leg);
  });
  const braceGeo = new THREE.BoxGeometry(2 * w + 0.1, 0.05, 0.05);
  for (let i = 1; i <= 4; i++) {
    const y = (height / 5) * i;
    const b1 = new THREE.Mesh(braceGeo, mat); b1.position.set(0, y, -w); group.add(b1);
    const b2 = new THREE.Mesh(braceGeo, mat); b2.position.set(0, y, w); group.add(b2);
    const b3 = new THREE.Mesh(braceGeo, mat); b3.rotation.y = Math.PI / 2; b3.position.set(-w, y, 0); group.add(b3);
    const b4 = new THREE.Mesh(braceGeo, mat); b4.rotation.y = Math.PI / 2; b4.position.set(w, y, 0); group.add(b4);
  }
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.08), mat);
  arm.position.y = height - 0.2;
  arm.castShadow = true;
  group.add(arm);
  return group;
}

/** Catenary (sagging) wire between two points using a Tube. */
function buildCatenary(from, to, sag, mat) {
  const mid = from.clone().add(to).multiplyScalar(0.5);
  mid.y -= sag;
  const curve = new THREE.CatmullRomCurve3([from, mid, to]);
  const geo = new THREE.TubeGeometry(curve, 24, 0.02, 6, false);
  return new THREE.Mesh(geo, mat);
}

/** Small post insulator stack. */
function buildInsulatorPost(x, z, mat) {
  const group = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.11, 14), mat);
    disc.position.y = 0.2 + i * 0.2;
    disc.castShadow = true;
    group.add(disc);
  }
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 8), mat);
  rod.position.y = 0.4;
  group.add(rod);
  group.position.set(x, 0, z);
  return group;
}

/* ============================================================
   Scene assembly
   ============================================================ */
function buildScene() {
  const wireMat = new THREE.MeshStandardMaterial({ color: COLORS.wire, metalness: 0.3, roughness: 0.7 });
  // Busbar: emissive ramps up on "power on"
  const busMat = new THREE.MeshStandardMaterial({ color: COLORS.copper, metalness: 0.6, roughness: 0.35, emissive: 0x30ba9a, emissiveIntensity: 0.25 });
  glowMeshes.push({ mat: busMat, base: 0.25, peak: 1.3 });
  const insMat = new THREE.MeshStandardMaterial({ color: COLORS.insulator, metalness: 0.1, roughness: 0.7 });

  /* ---- Ground plane ---- */
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: COLORS.ground, metalness: 0.0, roughness: 1.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  /* ---- Concrete base pad ---- */
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(9.5, 0.25, 7),
    new THREE.MeshStandardMaterial({ color: COLORS.base, metalness: 0.1, roughness: 0.9 })
  );
  pad.position.y = 0.1;
  pad.receiveShadow = true;
  scene.add(pad);

  /* ---- Equipment group (inside the building) ---- */
  equipment = new THREE.Group();

  const t1 = buildTransformer(); t1.position.set(-2.1, 0.22, 0.1); equipment.add(t1);
  const t2 = buildTransformer(); t2.position.set(0.4, 0.22, 0.1); equipment.add(t2);
  const t3 = buildTransformer(); t3.position.set(2.9, 0.22, -0.2); t3.scale.setScalar(0.92); equipment.add(t3);

  // Insulator posts + a glowing busbar running across the back
  const posts = [-3.0, -0.9, 1.4, 3.4];
  posts.forEach((x) => equipment.add(buildInsulatorPost(x, -1.9, insMat)));
  const busbar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.6, 12), busMat);
  busbar.rotation.z = Math.PI / 2;
  busbar.position.set(0.2, 1.95, -1.9);
  equipment.add(busbar);

  // Drop wires from busbar down to transformer bushings
  [-2.1, 0.4, 2.9].forEach((x) => {
    const w = buildCatenary(
      new THREE.Vector3(x, 1.92, -1.9),
      new THREE.Vector3(x, 2.5, 0.42),
      0.28, wireMat
    );
    equipment.add(w);
  });

  // Glowing floor strip — control-room style indicator that the bay is "live"
  const stripMat = new THREE.MeshStandardMaterial({ color: COLORS.accent, emissive: 0x30ba9a, emissiveIntensity: 0.0, metalness: 0.2, roughness: 0.6 });
  glowMeshes.push({ mat: stripMat, base: 0.0, peak: 1.1 });
  const strip = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.04, 0.16), stripMat);
  strip.position.set(0, 0.26, 1.9);
  equipment.add(strip);

  scene.add(equipment);

  /* ---- Building shell (open box: 4 walls, no top) ---- */
  // Lower walls than before so the steep open-camera sees over them,
  // and translucent so the interior also reads from the side when open.
  const BW = 8.4, BH = 2.45, BD = 6.0, TH = 0.14; // building w/h/d, wall thickness
  const wallY = 0.22 + BH / 2;
  building = new THREE.Group();

  function makeWallMat(openOpacity) {
    const m = new THREE.MeshStandardMaterial({
      color: COLORS.building, metalness: 0.35, roughness: 0.5,
      side: THREE.DoubleSide, transparent: true, opacity: 1
    });
    // Each wall fades to its own target when open (front fades the most so
    // it stops occluding the transformers from the lean-in camera).
    wallMaterials.push({ mat: m, open: openOpacity });
    return m;
  }
  const trimMat = new THREE.MeshStandardMaterial({ color: COLORS.buildingDark, metalness: 0.4, roughness: 0.5 });

  function wall(w, h, d, x, y, z, openOpacity) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeWallMat(openOpacity));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  building.add(wall(BW, BH, TH, 0, wallY, -BD / 2, 0.55));      // back  (keeps box readable)
  building.add(wall(BW, BH, TH, 0, wallY, BD / 2, 0.12));       // front (fades away to reveal)
  building.add(wall(TH, BH, BD, -BW / 2, wallY, 0, 0.4));       // left
  building.add(wall(TH, BH, BD, BW / 2, wallY, 0, 0.4));        // right

  // Horizontal trim line (windows band)
  const band = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.05, 0.2, BD + 0.05), trimMat);
  band.position.set(0, 0.22 + BH * 0.66, 0);
  building.add(band);

  // Accent door frame on the front
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.9, 0.06),
    new THREE.MeshStandardMaterial({ color: COLORS.accent, metalness: 0.3, roughness: 0.5, emissive: 0x0c2f27, emissiveIntensity: 0.5 })
  );
  door.position.set(-2.4, 0.22 + 0.95, BD / 2 + 0.03);
  building.add(door);

  scene.add(building);

  /* ---- Roof (SEPARATE mesh — this is what lifts off) ---- */
  const roofMat = new THREE.MeshStandardMaterial({
    color: COLORS.roof, metalness: 0.4, roughness: 0.5,
    transparent: true, opacity: 1
  });
  roof = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.4, 0.4, BD + 0.4), roofMat);
  roof.castShadow = true;
  roof.userData.baseY = 0.22 + BH + 0.18;     // resting position on top of walls
  roof.userData.liftY = 5.0;                   // how high it travels when open
  roof.position.y = roof.userData.baseY;
  // ridge detail
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.15, 0.14, 0.55), trimMat);
  ridge.position.y = 0.24;
  roof.add(ridge);
  scene.add(roof);

  /* ---- Side ЛЭП pylons with cross-spans ---- */
  const pylonH = 4.6;
  const pL = buildPylon(pylonH); pL.position.set(-8.2, 0.22, 0); scene.add(pL);
  const pR = buildPylon(pylonH); pR.position.set(8.2, 0.22, 0); scene.add(pR);

  [-0.9, 0, 0.9].forEach((dz) => {
    const span = buildCatenary(
      new THREE.Vector3(-8.2, 0.22 + pylonH - 0.2, dz),
      new THREE.Vector3(8.2, 0.22 + pylonH - 0.2, dz),
      1.7, wireMat
    );
    scene.add(span);
  });
}

/* ============================================================
   Lighting
   ============================================================ */
function buildLights() {
  // Brighter ambient so geometry reads, still cool-toned.
  scene.add(new THREE.AmbientLight(0x8197b4, 0.9));

  // Key directional (studio) with soft shadows
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(8, 13, 7);
  key.castShadow = !isMobile;
  if (key.castShadow) {
    key.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 50;
    key.shadow.camera.left = -16;
    key.shadow.camera.right = 16;
    key.shadow.camera.top = 16;
    key.shadow.camera.bottom = -16;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
  }
  scene.add(key);

  // Teal rim light for the brand glow
  const rim = new THREE.DirectionalLight(0x30ba9a, 0.85);
  rim.position.set(-9, 5, -7);
  scene.add(rim);

  // Fill from the front-camera side so interior faces aren't black
  const fill = new THREE.DirectionalLight(0xb7cee4, 0.6);
  fill.position.set(3, 5, 12);
  scene.add(fill);

  // Hemisphere for natural ground bounce
  scene.add(new THREE.HemisphereLight(0xaec4dd, 0x1a2942, 0.7));

  // INTERIOR accent point light — ramps up with "power on" (open).
  interiorLight = new THREE.PointLight(0x40d8b6, 0.0, 16, 1.6);
  interiorLight.position.set(0, 2.3, 0.2);
  scene.add(interiorLight);
}

/* ============================================================
   Init
   ============================================================ */
function init() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  isMobile = window.matchMedia('(max-width: 768px)').matches;

  if (!webglAvailable()) {
    showFallback(container);
    return;
  }

  let width = container.clientWidth || window.innerWidth;
  let height = container.clientHeight || window.innerHeight;

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    showFallback(container);
    return;
  }
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap DPR
  viewW = width; viewH = height;
  renderer.shadowMap.enabled = !isMobile;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  // Soft dark fog blends the scene base into the hero gradient
  scene.fog = new THREE.Fog(0x18273f, 24, 46);

  clock = new THREE.Clock();

  camera = new THREE.PerspectiveCamera(CAM.closed.fov, width / height, 0.1, 100);

  // OrbitControls give us damping + the user can spin/drag, but we drive
  // radius / polar / target / fov ourselves from `openCurrent`.
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = false;            // keep page scroll usable over canvas
  controls.enableRotate = false;          // we manage azimuth manually (avoids fighting auto-demo)
  controls.target.set(ORBIT_TARGET_X, CAM.closed.targetY, 0);

  buildLights();
  buildScene();

  // Place camera at the initial (closed) pose immediately.
  azimuth = -0.62;            // slight right-biased 3/4 view
  applyCameraPose(0, true);

  /* ---- Events ---- */
  window.addEventListener('resize', onResize, { passive: true });

  const dom = renderer.domElement;
  dom.style.touchAction = 'pan-y';        // keep vertical page scroll on mobile
  dom.style.cursor = 'pointer';
  dom.addEventListener('pointermove', onPointerMove, { passive: true });
  dom.addEventListener('pointerenter', onPointerEnter, { passive: true });
  dom.addEventListener('pointerleave', onPointerLeave, { passive: true });
  dom.addEventListener('pointerdown', onPointerDown, { passive: true });
  dom.addEventListener('pointerup', onPointerUp, { passive: true });
  dom.addEventListener('click', onClick);

  // Peek hint button: tap/click toggles the effect (works on mobile too)
  // and a hover previews it on desktop.
  sceneHint = document.getElementById('scene-hint');
  if (sceneHint) {
    // Tailor the wording to the input method (hover vs touch).
    const touch = window.matchMedia('(hover: none)').matches || ('ontouchstart' in window);
    const label = sceneHint.querySelector('.hero__peek-text');
    if (label) label.textContent = touch ? 'Нажмите, чтобы заглянуть внутрь' : 'Наведите, чтобы заглянуть внутрь';
    sceneHint.addEventListener('click', onClick);
    sceneHint.addEventListener('pointerenter', () => { if (!isMobile) { userInteracted = true; hoverProgress = 1; } }, { passive: true });
    sceneHint.addEventListener('pointerleave', () => { hoverProgress = 0; }, { passive: true });
  }

  // Any scroll counts as interaction (stops the auto-demo cycle).
  window.addEventListener('scroll', () => { userInteracted = true; }, { passive: true, once: true });

  autoStartTime = performance.now();

  // Expose a tiny debug API (used by screenshot harness; harmless otherwise).
  window.__rasuScene = {
    setOpen(v) { debugOpen = Math.max(0, Math.min(1, v)); debugOpenActive = true; userInteracted = true; },
    clearOpen() { debugOpenActive = false; },
    getCam() {
      return {
        pos: camera.position.toArray().map((n) => +n.toFixed(2)),
        target: controls.target.toArray().map((n) => +n.toFixed(2)),
        fov: +camera.fov.toFixed(1),
        open: +openCurrent.toFixed(3)
      };
    }
  };

  animate();
}

/* ---------- Interaction ---------- */
let clickToggle = 0;
let dragging = false;
let lastDragX = 0;

function onClick() {
  userInteracted = true;
  clickToggle = clickToggle ? 0 : 1;
  clickProgress = clickToggle;
}

function onPointerEnter() {
  userInteracted = true;
  if (!isMobile) hoverProgress = 1;
}
function onPointerLeave() {
  hoverProgress = 0;
  dragging = false;
}
function onPointerDown(e) {
  userInteracted = true;
  dragging = true;
  lastDragX = e.clientX;
}
function onPointerUp() {
  dragging = false;
}

function onPointerMove(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  mouseParallax.x = pointer.x;
  mouseParallax.y = pointer.y;
  if (dragging) {
    dragAzimuth += (e.clientX - lastDragX) * 0.005;
    lastDragX = e.clientX;
    userInteracted = true;
  }
}

function onResize() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container || !renderer) return;
  isMobile = window.matchMedia('(max-width: 768px)').matches;
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  camera.aspect = w / h;
  viewW = w; viewH = h;
  curViewOffset = -1;          // force the view offset to recompute for new size
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap DPR on resize too
}

/* ============================================================
   Animation loop
   ============================================================ */
function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

let debugOpen = 0;
let debugOpenActive = false;

/* Cached size for setViewOffset (kept in sync on resize). */
let viewW = 1, viewH = 1;
let curViewOffset = -1;

/** Shift the camera frustum vertically by `frac` of the height (subject moves
 *  UP as frac grows). 0 clears the offset. Guarded so we only touch the
 *  projection when it actually changes (avoids per-frame matrix churn). */
function applyViewOffset(frac) {
  if (Math.abs(frac - curViewOffset) < 0.001) return;
  curViewOffset = frac;
  if (!frac) {
    camera.clearViewOffset();
  } else {
    // offsetY positive moves the rendered content DOWN in the frame, i.e.
    // the subject appears higher. Use a negative offset to raise the subject.
    camera.setViewOffset(viewW, viewH, 0, -frac * viewH, viewW, viewH);
  }
}

/** Compute the orbit camera pose for a given eased-open amount.
 *  `snap` places it instantly (init); otherwise the caller lerps openCurrent. */
function applyCameraPose(o, snap) {
  const aspect = camera.aspect || 1.6;
  // Portrait phones: the hero copy covers the top, so we keep the substation
  // a touch smaller, pull it slightly less close when open, and SHIFT the
  // rendered view down so the building rises into the clear lower band.
  const portrait = aspect < 0.85;
  const narrow = aspect < 1.25;

  const fovBoost = portrait ? 9 : (narrow ? 5 : 0);
  const radiusMul = portrait ? 1.22 : (narrow ? 1.08 : 1.0);
  // On portrait keep the open target higher (don't dive as deep) so the
  // interior doesn't sink behind the bottom edge / hero text.
  const openTargetY = portrait ? 1.85 : CAM.open.targetY;

  const radius  = lerp(CAM.closed.radius, CAM.open.radius, o) * radiusMul;
  const polar   = lerp(CAM.closed.polar, CAM.open.polar, o);
  const targetY = lerp(CAM.closed.targetY, openTargetY, o);
  const fov     = lerp(CAM.closed.fov, CAM.open.fov, o) + fovBoost;

  // Shift the projection so the subject sits higher on tall screens.
  applyViewOffset(portrait ? 0.21 : 0.0);

  // Gentle parallax (calm) added to azimuth/polar.
  const px = reducedMotion ? 0 : mouseParallax.x * 0.10;
  const py = reducedMotion ? 0 : mouseParallax.y * 0.06;
  const az = azimuth + dragAzimuth + px;
  const pol = THREE.MathUtils.clamp(polar - py, 0.35, 1.45);

  // Spherical → cartesian around the (animated) target.
  const tx = ORBIT_TARGET_X;
  const tz = 0;
  const sinP = Math.sin(pol);
  const x = tx + radius * sinP * Math.sin(az);
  const y = targetY + radius * Math.cos(pol);
  const z = tz + radius * sinP * Math.cos(az);

  const targetVec = new THREE.Vector3(tx, targetY, tz);

  if (snap) {
    camera.position.set(x, y, z);
    controls.target.copy(targetVec);
  } else {
    // Smooth follow (lerp) — controls.update() adds its own damping on top.
    camera.position.lerp(new THREE.Vector3(x, y, z), 0.12);
    controls.target.lerp(targetVec, 0.12);
  }

  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = lerp(camera.fov, fov, snap ? 1 : 0.12);
    camera.updateProjectionMatrix();
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (!renderer) return;

  const dt = clock ? clock.getDelta() : 0.016;
  const now = performance.now();

  /* ---- Idle auto-demo: slow open/close cycle until user interacts ---- */
  if (!userInteracted && !reducedMotion) {
    const t = (now - autoStartTime) / 1000;
    if (t > 1.6) {
      // Smooth 0→1→0 every ~7s, after a short initial delay.
      const phase = (t - 1.6) * (Math.PI * 2 / 7);
      autoProgress = (1 - Math.cos(phase)) * 0.5; // 0..1..0
    } else {
      autoProgress = 0;
    }
  } else {
    autoProgress = 0;
  }

  /* ---- Combine all open sources (max wins) ---- */
  let openTarget = Math.max(scrollProgress, hoverProgress, clickProgress, autoProgress);
  if (debugOpenActive) openTarget = debugOpen;

  // Smooth, no jerk
  openCurrent = lerp(openCurrent, openTarget, 0.09);
  const o = easeInOut(openCurrent);

  /* ---- Roof: lift, fade, drift + tilt for a "lid off" feel ---- */
  if (roof) {
    roof.position.y = lerp(roof.userData.baseY, roof.userData.baseY + roof.userData.liftY, o);
    roof.position.x = lerp(0, 0.8, o);
    roof.rotation.z = lerp(0, 0.06, o);
    roof.material.opacity = lerp(1, 0.0, o);
    roof.visible = roof.material.opacity > 0.02;
  }

  /* ---- Walls: turn translucent so the interior reads from the side
          (front wall fades the most — see per-wall open targets) ---- */
  for (let i = 0; i < wallMaterials.length; i++) {
    const w = wallMaterials[i];
    w.mat.opacity = lerp(1.0, w.open, o);
    w.mat.depthWrite = w.mat.opacity > 0.95; // avoid sorting halos when see-through
  }

  /* ---- Interior "power on": glow light + emissive ramps ---- */
  if (interiorLight) interiorLight.intensity = lerp(0.0, 2.6, o);
  for (let i = 0; i < glowMeshes.length; i++) {
    const g = glowMeshes[i];
    g.mat.emissiveIntensity = lerp(g.base, g.peak, o);
  }

  /* ---- Peek hint: hide once the interior is clearly revealed ---- */
  if (sceneHint) {
    const showHint = openCurrent < 0.35;
    sceneHint.classList.toggle('is-hidden', !showHint);
  }

  /* ---- Camera: auto-rotate azimuth + lean-in driven by open ---- */
  if (!reducedMotion && !dragging) {
    // Slow drift; ease the rotation as we open so the reveal settles.
    azimuth += dt * 0.12 * (1 - 0.8 * o);
  }
  applyCameraPose(o, false);

  controls.update();
  renderer.render(scene, camera);
}

/* ============================================================
   Public API (consumed by main.js)
   ============================================================ */
export function setScrollProgress(t) {
  scrollProgress = Math.max(0, Math.min(1, t));
  if (scrollProgress > 0.02) userInteracted = true;
}

/* Auto-init on import */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
