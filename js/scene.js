/* ============================================================
   РАСУ — 3D hero scene
   Stylised low-poly FIBRE-PRODUCTION PLANT whose control hall is
   filled with РАСУ's product: rows of АСУ ТП / industrial control
   cabinets and operator consoles.

   As `open` grows 0→1 the workshop is DISASSEMBLED:
     • the roof lifts off and fades,
     • the walls turn translucent (the front wall fades the most),
     • an interior teal "power-on" glow ramps up and the cabinet
       LEDs light up,
     • the CAMERA leans in and tilts down to look right inside at
       the rows of control cabinets.

   Drive sources (max wins):
     • scroll progress  (main.js → setScrollProgress) — primary driver
     • hover / click on the canvas
     • idle auto-demo    (a gentle teaser ONLY before the first scroll)

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
  // Static photo instead of the live canvas.
  container.classList.add('is-fallback');
  // Let the page know there is no scroll-driven disassembly, so the
  // pin track can collapse and scrolling stays normal.
  document.documentElement.classList.add('no-scene');
}

/* ---------- Palette (matches site brand) ---------- */
const COLORS = {
  building:     0x5a6e84,
  buildingDark: 0x3a4a5c,
  rib:          0x47596d,
  roof:         0x61748a,
  glass:        0x9fc4d6,
  base:         0x2a3a4d,
  ground:       0x1f2d40,

  cabinet:      0xc2ccd8,   // light steel — cabinets must read clearly
  cabinetDark:  0x9aa6b4,   // side / shading
  cabinetFace:  0x39424e,   // dark front panel so LEDs pop
  consoleBody:  0xb4c0d0,
  vent:         0x6c7a8a,

  floor:        0x222f3f,
  tray:         0x8893a2,
  spool:        0x86909e,

  ledTeal:      0x30ba9a,
  ledAmber:     0xf0a23a,
  ledGreen:     0x46c46a,
  screen:       0x30ba9a,
  accent:       0x30ba9a
};

/* ---------- Module state ---------- */
let scrollProgress = 0;     // 0..1 from main.js (scroll over the pinned hero)
let hoverProgress = 0;      // 0..1 toggled by hover
let clickProgress = 0;      // 0..1 toggled by click
let autoProgress = 0;       // 0..1 idle teaser (before first scroll only)
let openCurrent = 0;        // lerped actual open amount (drives everything)

/* Mobile = tap-driven self-contained tween (NO scroll pin). The query is
   re-evaluated on resize so a portrait→landscape flip past 768px switches
   behaviour without a reload. */
const MOBILE_QUERY = '(max-width: 768px)';

/* Time-based auto-open tween (mobile tap). Independent of scroll: when
   active it OWNS `openCurrent` and drives it 0→1 over a fixed duration with
   an easing twin, then holds at 1. This is deliberately NOT a lerp toward a
   scroll target — the spec wants a self-playing reveal. */
let autoOpen = {
  active: false,    // currently tweening
  done: false,      // reached 1 and holding open
  start: 0,         // performance.now() at tween start
  from: 0,          // openCurrent when the tween began
  duration: 2000    // ms (within the requested 1.5–2.5s window)
};

let renderer, scene, camera, controls, clock;
let roof, building, equipment, interiorLight;
let wallMaterials = [];
let glowMeshes = [];        // emissive materials whose intensity ramps with open
let ledGroups = [];         // { mat, base, peak, phase, speed } — blinking LEDs

let pointer = new THREE.Vector2();
let mouseParallax = new THREE.Vector2();
let reducedMotion = false;
let isMobile = false;
let userInteracted = false; // any hover/click/drag/scroll stops the auto-demo
let scrollDriven = false;   // true once the page scroll has taken over
let autoStartTime = 0;
let azimuth = 0;            // current orbit azimuth (auto-rotate + drag)
let dragAzimuth = 0;        // extra azimuth from user drag

/* ---------- Camera keyframes (interpolated by openCurrent) ----------
   Spherical orbit around an animated target. Closed = wide premium
   establishing shot of the workshop, biased right (clear of the text).
   Open  = closer, steeper top-down angle, target dropped INTO the hall
   so we look straight down the rows of control cabinets.              */
const CAM = {
  closed: { radius: 17.5, polar: 1.14, targetY: 2.0, fov: 41 },
  open:   { radius: 10.5, polar: 0.66, targetY: 1.05, fov: 49 }
};
const ORBIT_TARGET_X = 0;

/* ============================================================
   Geometry builders
   ============================================================ */

/** A grid of small emissive LED dots on a flat panel (front of a cabinet).
 *  Returns a Group positioned at local origin; caller places it.
 *  Each cabinet gets its own emissive material so it can blink
 *  independently and ramp with the global "power on". */
function buildLedPanel(width, height, cols, rows) {
  const group = new THREE.Group();
  // Mostly teal, with a sprinkle of amber/green for a "live system" feel.
  const palette = [COLORS.ledTeal, COLORS.ledTeal, COLORS.ledTeal, COLORS.ledTeal,
                   COLORS.ledGreen, COLORS.ledAmber];
  const ledGeo = new THREE.PlaneGeometry(0.045, 0.045);
  const marginX = width * 0.16;
  const marginY = height * 0.14;
  const stepX = (width - marginX * 2) / Math.max(1, cols - 1);
  const stepY = (height - marginY * 2) / Math.max(1, rows - 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = palette[(r * cols + c) % palette.length];
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.0,
        metalness: 0.0, roughness: 0.5
      });
      // Register for global power-on ramp + individual flicker.
      ledGroups.push({
        mat,
        base: 0.0,
        peak: 1.7 + Math.random() * 1.1,
        phase: Math.random() * Math.PI * 2,
        speed: 1.4 + Math.random() * 2.6
      });
      const led = new THREE.Mesh(ledGeo, mat);
      led.position.set(-width / 2 + marginX + c * stepX,
                       -height / 2 + marginY + r * stepY,
                       0);
      group.add(led);
    }
  }
  return group;
}

/** One industrial control cabinet / 19" server rack.
 *  Light steel body, dark recessed front panel with an LED grid and a
 *  few ventilation slits. `tall`/`wide` tweak the silhouette so the
 *  rows don't look uniform.                                           */
function buildCabinet(opts) {
  const o = opts || {};
  const w = o.w || 0.9;
  const h = o.h || 2.1;
  const d = o.d || 0.85;
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: COLORS.cabinet, metalness: 0.55, roughness: 0.45 });
  const sideMat = new THREE.MeshStandardMaterial({ color: COLORS.cabinetDark, metalness: 0.55, roughness: 0.5 });
  const faceMat = new THREE.MeshStandardMaterial({ color: COLORS.cabinetFace, metalness: 0.4, roughness: 0.55 });
  const ventMat = new THREE.MeshStandardMaterial({ color: COLORS.vent, metalness: 0.5, roughness: 0.6 });

  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
  body.position.y = h / 2;
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  // Side panels (slightly darker) to give the rack some depth
  [-1, 1].forEach((s) => {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.04, h * 0.98, d * 0.98), sideMat);
    sp.position.set(s * (w / 2 - 0.01), h / 2, 0);
    group.add(sp);
  });

  // Top cap
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.07, d + 0.04), sideMat);
  cap.position.y = h + 0.02;
  cap.castShadow = true;
  group.add(cap);

  // Plinth
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), sideMat);
  plinth.position.y = 0.06;
  group.add(plinth);

  // Recessed dark front panel (faces +Z)
  const panelH = h * 0.86;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, panelH, 0.04), faceMat);
  panel.position.set(0, h / 2 + 0.05, d / 2 + 0.005);
  group.add(panel);

  // Ventilation slits near the top of the panel
  for (let i = 0; i < 3; i++) {
    const slit = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.025, 0.02), ventMat);
    slit.position.set(0, h * 0.86 - i * 0.06, d / 2 + 0.03);
    group.add(slit);
  }

  // LED grid on the panel
  const leds = buildLedPanel(w * 0.66, panelH * 0.6, o.cols || 4, o.rows || 5);
  leds.position.set(0, h / 2 + 0.02, d / 2 + 0.03);
  group.add(leds);

  return group;
}

/** Operator console / control desk: a cabinet base with a slanted,
 *  glowing screen on top (teal). Reads as the human-machine interface
 *  of the АСУ ТП.                                                      */
function buildConsole() {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: COLORS.consoleBody, metalness: 0.5, roughness: 0.45 });
  const frameMat = new THREE.MeshStandardMaterial({ color: COLORS.cabinetDark, metalness: 0.5, roughness: 0.5 });
  const screenMat = new THREE.MeshStandardMaterial({
    color: COLORS.screen, emissive: COLORS.screen, emissiveIntensity: 0.0,
    metalness: 0.1, roughness: 0.35
  });
  glowMeshes.push({ mat: screenMat, base: 0.05, peak: 1.5 });

  // Desk body
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.0, 1.0), baseMat);
  desk.position.y = 0.5;
  desk.castShadow = true; desk.receiveShadow = true;
  group.add(desk);

  // Slanted screen frame
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 0.08), frameMat);
  frame.position.set(0, 1.42, -0.18);
  frame.rotation.x = -0.42;
  frame.castShadow = true;
  group.add(frame);

  // Glowing screen face (slightly in front of the frame)
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.74), screenMat);
  screen.position.set(0, 1.43, -0.13);
  screen.rotation.x = -0.42;
  group.add(screen);

  // A row of mimic LEDs along the desk lip
  const lip = buildLedPanel(1.3, 0.12, 8, 1);
  lip.position.set(0, 0.96, 0.5);
  lip.rotation.x = -0.25;
  group.add(lip);

  return group;
}

/** A horizontal cable tray (thin perforated-looking box) spanning the
 *  hall above an aisle. */
function buildCableTray(length) {
  const mat = new THREE.MeshStandardMaterial({ color: COLORS.tray, metalness: 0.55, roughness: 0.5 });
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(length, 0.05, 0.28), mat);
  group.add(base);
  // side rails
  [-0.14, 0.14].forEach((z) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.09, 0.03), mat);
    rail.position.set(0, 0.02, z);
    group.add(rail);
  });
  return group;
}

/** A fibre spool: a cylinder with two flange discs on a horizontal axis
 *  (hints at the fibre-production line along one wall). */
function buildSpool(radius) {
  const group = new THREE.Group();
  const coreMat = new THREE.MeshStandardMaterial({ color: COLORS.accent, metalness: 0.3, roughness: 0.55 });
  const flangeMat = new THREE.MeshStandardMaterial({ color: COLORS.spool, metalness: 0.5, roughness: 0.5 });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, 0.5, 20), coreMat);
  core.rotation.z = Math.PI / 2;
  group.add(core);
  [-0.28, 0.28].forEach((x) => {
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.05, 22), flangeMat);
    fl.rotation.z = Math.PI / 2;
    fl.position.x = x;
    fl.castShadow = true;
    group.add(fl);
  });
  return group;
}

/* ============================================================
   Scene assembly
   ============================================================ */

/* Building dimensions (long axis along X = the workshop nave). */
const BW = 12.6, BH = 2.7, BD = 6.6, TH = 0.16; // width / height / depth / wall thickness
const WALL_Y = 0.22 + BH / 2;

function buildScene() {
  /* ---- Ground plane ---- */
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: COLORS.ground, metalness: 0.0, roughness: 1.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  /* ---- Concrete base pad ---- */
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(BW + 1.6, 0.25, BD + 1.6),
    new THREE.MeshStandardMaterial({ color: COLORS.base, metalness: 0.1, roughness: 0.9 })
  );
  pad.position.y = 0.1;
  pad.receiveShadow = true;
  scene.add(pad);

  /* ---- Interior equipment: the АСУ ТП hall ---- */
  equipment = new THREE.Group();
  buildControlHall(equipment);
  scene.add(equipment);

  /* ---- Building shell + roof ---- */
  buildBuilding();
}

/** Lay out the technical floor, rows of cabinets, consoles, cable trays
 *  and a hint of the fibre line along the back wall. */
function buildControlHall(root) {
  /* ---- Technical (raised access) floor ---- */
  const floorMat = new THREE.MeshStandardMaterial({ color: COLORS.floor, metalness: 0.25, roughness: 0.7 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(BW - 0.5, 0.06, BD - 0.5), floorMat);
  floor.position.y = 0.24;
  floor.receiveShadow = true;
  root.add(floor);

  // Faint tile grid: thin inset strips along both axes (cheap, reads as
  // a raised-floor pattern from above).
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x35465a, metalness: 0.2, roughness: 0.8 });
  const innerW = BW - 0.8, innerD = BD - 0.8;
  for (let i = -2; i <= 2; i++) {
    const gx = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.005, innerD), lineMat);
    gx.position.set(i * (innerW / 5), 0.272, 0);
    root.add(gx);
    const gz = new THREE.Mesh(new THREE.BoxGeometry(innerW, 0.005, 0.03), lineMat);
    gz.position.set(0, 0.272, i * (innerD / 5));
    root.add(gz);
  }

  /* ---- Rows of control cabinets ----
     3 rows along Z, each a run of cabinets along X with a small gap.
     The middle row is consoles + cabinets; outer rows are pure racks. */
  const FLOOR_TOP = 0.27;
  const rowZ = [-1.85, 0.05, 1.95];        // three rows with aisles between
  const startX = -BW / 2 + 1.4;
  const gapX = 1.18;
  const perRow = 8;

  // Outer rows: 8 cabinets each (16) with slight per-cabinet variation.
  [rowZ[0], rowZ[2]].forEach((z, ri) => {
    for (let i = 0; i < perRow; i++) {
      const tall = (i % 4 === 0);
      const cab = buildCabinet({
        w: 0.9,
        h: tall ? 2.25 : 2.05,
        d: 0.82,
        cols: 4,
        rows: tall ? 6 : 5
      });
      cab.position.set(startX + i * gapX, FLOOR_TOP, z);
      // Rear rows face the camera (+Z); make all cabinets face +Z for a
      // clean "front panel wall" of LEDs down each aisle.
      root.add(cab);
    }
  });

  // Middle row: a mix of two consoles + cabinets (the operator zone).
  const midItems = ['cab', 'cab', 'console', 'cab', 'cab', 'console', 'cab', 'cab'];
  midItems.forEach((kind, i) => {
    let item;
    if (kind === 'console') {
      item = buildConsole();
    } else {
      item = buildCabinet({ w: 0.9, h: 2.0, d: 0.82, cols: 4, rows: 5 });
    }
    item.position.set(startX + i * gapX, FLOOR_TOP, rowZ[1]);
    root.add(item);
  });

  /* ---- Cable trays above the two aisles ---- */
  const trayLen = BW - 2.0;
  const aisleZ = [(rowZ[0] + rowZ[1]) / 2, (rowZ[1] + rowZ[2]) / 2];
  aisleZ.forEach((z) => {
    const tray = buildCableTray(trayLen);
    tray.position.set(0, 0.27 + 2.45, z);
    root.add(tray);
  });

  /* ---- A glowing "system live" floor strip down the central aisle ---- */
  const stripMat = new THREE.MeshStandardMaterial({
    color: COLORS.accent, emissive: COLORS.accent, emissiveIntensity: 0.0,
    metalness: 0.2, roughness: 0.6
  });
  glowMeshes.push({ mat: stripMat, base: 0.0, peak: 1.2 });
  const strip = new THREE.Mesh(new THREE.BoxGeometry(BW - 2.4, 0.03, 0.14), stripMat);
  strip.position.set(0, 0.30, aisleZ[1] + 0.55);
  root.add(strip);

  /* ---- Atmosphere: a short fibre-production line against the back wall
          (a rack of spools on an axis). NOT the focus — kept low + subtle. */
  const lineGroup = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: COLORS.cabinetDark, metalness: 0.5, roughness: 0.5 });
  // support frame
  const beam = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.1, 0.12), frameMat);
  beam.position.set(0, 1.15, 0);
  lineGroup.add(beam);
  [-2.5, 2.5].forEach((x) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.12), frameMat);
    post.position.set(x, 0.6, 0);
    lineGroup.add(post);
  });
  // spools hanging on the beam
  for (let i = -2; i <= 2; i++) {
    const sp = buildSpool(0.34);
    sp.position.set(i * 1.05, 0.78, 0);
    lineGroup.add(sp);
  }
  lineGroup.position.set(0, FLOOR_TOP, -BD / 2 + 0.6);
  root.add(lineGroup);
}

/** Building shell (4 translucent-on-open walls + facade ribs + window
 *  strips) and the SEPARATE roof mesh that lifts off. Reads as a modern
 *  industrial workshop / hangar. */
function buildBuilding() {
  building = new THREE.Group();

  function makeWallMat(openOpacity) {
    const m = new THREE.MeshStandardMaterial({
      color: COLORS.building, metalness: 0.35, roughness: 0.55,
      side: THREE.DoubleSide, transparent: true, opacity: 1
    });
    wallMaterials.push({ mat: m, open: openOpacity });
    return m;
  }
  const ribMat = new THREE.MeshStandardMaterial({ color: COLORS.rib, metalness: 0.4, roughness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: COLORS.glass, metalness: 0.2, roughness: 0.2,
    transparent: true, opacity: 0.5, side: THREE.DoubleSide
  });
  wallMaterials.push({ mat: glassMat, open: 0.06 }); // window bands fade too

  function wall(w, h, d, x, y, z, openOpacity) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeWallMat(openOpacity));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  // Four walls. Front (+Z) fades the most so it stops occluding the hall.
  building.add(wall(BW, BH, TH, 0, WALL_Y, -BD / 2, 0.5));   // back
  building.add(wall(BW, BH, TH, 0, WALL_Y, BD / 2, 0.08));   // front
  building.add(wall(TH, BH, BD, -BW / 2, WALL_Y, 0, 0.38));  // left
  building.add(wall(TH, BH, BD, BW / 2, WALL_Y, 0, 0.38));   // right

  // Continuous window band (strip glazing) around the upper third — the
  // modern-cech look.
  const bandY = 0.22 + BH * 0.7;
  const bandH = 0.5;
  [[-BD / 2 - 0.01, BW], [BD / 2 + 0.01, BW]].forEach(([z, len]) => {
    const g = new THREE.Mesh(new THREE.BoxGeometry(len, bandH, 0.04), glassMat);
    g.position.set(0, bandY, z);
    building.add(g);
  });
  [[-BW / 2 - 0.01, BD], [BW / 2 + 0.01, BD]].forEach(([x, len]) => {
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.04, bandH, len), glassMat);
    g.position.set(x, bandY, 0);
    building.add(g);
  });

  // Facade ribs (vertical pilasters) along front + back for the panelised
  // industrial façade.
  const ribCount = 9;
  for (let i = 0; i <= ribCount; i++) {
    const x = -BW / 2 + (BW / ribCount) * i;
    [-BD / 2 - 0.03, BD / 2 + 0.03].forEach((z) => {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.14, BH, 0.1), ribMat);
      rib.position.set(x, WALL_Y, z);
      building.add(rib);
    });
  }

  // Base sill trim
  const sill = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.2, 0.18, BD + 0.2), ribMat);
  sill.position.set(0, 0.22 + 0.09, 0);
  building.add(sill);

  // Accent roller-shutter door on the front
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 1.9, 0.06),
    new THREE.MeshStandardMaterial({ color: COLORS.accent, metalness: 0.3, roughness: 0.5, emissive: 0x0c2f27, emissiveIntensity: 0.5 })
  );
  door.position.set(-BW / 2 + 2.4, 0.22 + 0.95, BD / 2 + 0.04);
  building.add(door);

  scene.add(building);

  /* ---- Roof (SEPARATE mesh — this is what lifts off) ----
     A low double-pitch (gable) cap built from two slanted slabs so it
     reads as a workshop, kept as ONE group that lifts as a unit. */
  const roofMat = new THREE.MeshStandardMaterial({
    color: COLORS.roof, metalness: 0.4, roughness: 0.5,
    transparent: true, opacity: 1
  });
  roof = new THREE.Group();
  const slabW = BW + 0.5;
  const slabLen = (BD + 0.5) * 0.62;
  const pitch = 0.32;
  [-1, 1].forEach((s) => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(slabW, 0.18, slabLen), roofMat);
    slab.position.set(0, 0, s * slabLen * 0.46);
    slab.rotation.x = -s * pitch;
    slab.castShadow = true;
    roof.add(slab);
  });
  // Ridge beam
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(slabW, 0.16, 0.3),
    new THREE.MeshStandardMaterial({ color: COLORS.buildingDark, metalness: 0.4, roughness: 0.5, transparent: true, opacity: 1 }));
  ridge.position.y = slabLen * pitch * 0.5 + 0.06;
  roof.add(ridge);
  // Track every roof material so they fade together.
  roof.userData.mats = [roofMat, ridge.material];

  roof.userData.baseY = 0.22 + BH + 0.34;     // resting position on top of walls
  roof.userData.liftY = 5.6;                    // how high it travels when open
  roof.position.y = roof.userData.baseY;
  scene.add(roof);
}

/* ============================================================
   Lighting
   ============================================================ */
function buildLights() {
  // Bright, cool ambient so the cabinets read clearly.
  scene.add(new THREE.AmbientLight(0x90a6c0, 1.0));

  // Key directional (studio) with soft shadows
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(9, 15, 8);
  key.castShadow = !isMobile;
  if (key.castShadow) {
    key.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 60;
    key.shadow.camera.left = -20;
    key.shadow.camera.right = 20;
    key.shadow.camera.top = 20;
    key.shadow.camera.bottom = -20;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
  }
  scene.add(key);

  // Teal rim light for the brand glow
  const rim = new THREE.DirectionalLight(0x30ba9a, 0.85);
  rim.position.set(-11, 6, -8);
  scene.add(rim);

  // Fill from the front-camera side so interior faces aren't black
  const fill = new THREE.DirectionalLight(0xb7cee4, 0.65);
  fill.position.set(3, 6, 14);
  scene.add(fill);

  // Hemisphere for natural ground bounce
  scene.add(new THREE.HemisphereLight(0xaec4dd, 0x1a2942, 0.75));

  // INTERIOR accent point light — ramps up with "power on" (open).
  interiorLight = new THREE.PointLight(0x40d8b6, 0.0, 22, 1.6);
  interiorLight.position.set(0, 2.4, 0.3);
  scene.add(interiorLight);
}

/* ============================================================
   Init
   ============================================================ */
function init() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  isMobile = window.matchMedia(MOBILE_QUERY).matches;

  if (!webglAvailable()) {
    showFallback(container);
    return;
  }

  // Reduced-motion on MOBILE: there is no scroll-pin and no tap animation to
  // drive the reveal, so present the workshop ALREADY OPEN (the informative
  // end-state) instead of a closed box the user can't open. Held by the
  // autoOpen.done branch in animate().
  if (reducedMotion && isMobile) { autoOpen.done = true; openCurrent = 1; }

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
  renderer.toneMappingExposure = 1.14;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  // Soft fog blends the scene base into the hero gradient.
  scene.fog = new THREE.Fog(0x18273f, 30, 60);

  clock = new THREE.Clock();

  camera = new THREE.PerspectiveCamera(CAM.closed.fov, width / height, 0.1, 200);

  // OrbitControls give us damping + the user can drag, but we drive
  // radius / polar / target / fov ourselves from `openCurrent`.
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = false;            // keep page scroll usable over canvas
  controls.enableRotate = false;          // we manage azimuth manually
  controls.target.set(ORBIT_TARGET_X, CAM.closed.targetY, 0);

  buildLights();
  buildScene();

  // Place camera at the initial (closed) pose immediately.
  azimuth = -0.6;            // slight right-biased 3/4 view
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

  autoStartTime = performance.now();

  // Expose a tiny debug API (used by the screenshot harness; harmless otherwise).
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

/** MOBILE tap trigger: kick off the self-playing disassembly tween from the
 *  CURRENT open amount up to fully open. Idempotent — a second tap while it
 *  is already running (or finished) is ignored, so double-taps can't restart
 *  or jitter the reveal. With reduced-motion we snap straight to open. */
export function startAutoOpen() {
  userInteracted = true;
  if (autoOpen.active || autoOpen.done) return;     // guard double-tap
  if (reducedMotion) { autoOpen.done = true; openCurrent = 1; return; }
  autoOpen.active = true;
  autoOpen.from = openCurrent;
  autoOpen.start = performance.now();
}

function onClick() {
  userInteracted = true;
  // MOBILE: a tap launches the self-playing disassembly (no scroll pin).
  if (isMobile) { startAutoOpen(); return; }
  // DESKTOP: once scroll drives the scene, clicking shouldn't fight it.
  if (scrollDriven) return;
  clickToggle = clickToggle ? 0 : 1;
  clickProgress = clickToggle;
}

function onPointerEnter() {
  userInteracted = true;
  if (!isMobile && !scrollDriven) hoverProgress = 1;
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
  const wasMobile = isMobile;
  isMobile = window.matchMedia(MOBILE_QUERY).matches;
  // Crossed the breakpoint → hand ownership back to the mode that now applies
  // so neither the desktop scroll-pin nor the mobile tap-tween gets stuck.
  if (wasMobile !== isMobile) {
    autoOpen.active = false;
    autoOpen.done = false;
  }
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

/** Shift the camera frustum vertically by `frac` of the height (subject
 *  appears higher as frac grows). 0 clears the offset. Guarded so we only
 *  touch the projection when it actually changes. */
function applyViewOffset(frac) {
  if (Math.abs(frac - curViewOffset) < 0.001) return;
  curViewOffset = frac;
  if (!frac) {
    camera.clearViewOffset();
  } else {
    camera.setViewOffset(viewW, viewH, 0, -frac * viewH, viewW, viewH);
  }
}

/** Compute the orbit camera pose for a given eased-open amount. */
function applyCameraPose(o, snap) {
  const aspect = camera.aspect || 1.6;
  const portrait = aspect < 0.85;
  const narrow = aspect < 1.25;

  const fovBoost = portrait ? 10 : (narrow ? 6 : 0);
  const radiusMul = portrait ? 1.26 : (narrow ? 1.1 : 1.0);
  const openTargetY = portrait ? 1.7 : CAM.open.targetY;

  const radius  = lerp(CAM.closed.radius, CAM.open.radius, o) * radiusMul;
  const polar   = lerp(CAM.closed.polar, CAM.open.polar, o);
  const targetY = lerp(CAM.closed.targetY, openTargetY, o);
  const fov     = lerp(CAM.closed.fov, CAM.open.fov, o) + fovBoost;

  // Shift the projection so the subject sits higher on tall screens.
  applyViewOffset(portrait ? 0.2 : 0.0);

  // Gentle parallax added to azimuth/polar.
  const px = reducedMotion ? 0 : mouseParallax.x * 0.10;
  const py = reducedMotion ? 0 : mouseParallax.y * 0.06;
  const az = azimuth + dragAzimuth + px;
  const pol = THREE.MathUtils.clamp(polar - py, 0.32, 1.45);

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

  /* ---- Idle teaser: a single gentle peek ONLY before the first scroll.
          Disabled on mobile (the tap hint does the "it's interactive" job
          there) so it can't fight the tap-driven tween. ---- */
  if (!isMobile && !userInteracted && !reducedMotion && !scrollDriven) {
    const t = (now - autoStartTime) / 1000;
    if (t > 1.4) {
      // One soft 0→~0.5→0 swell so the user notices it's interactive.
      const phase = (t - 1.4) * (Math.PI * 2 / 6.5);
      autoProgress = (1 - Math.cos(phase)) * 0.28; // peaks ~0.28
    } else {
      autoProgress = 0;
    }
  } else {
    autoProgress = 0;
  }

  /* ---- Open amount ---------------------------------------------------- */
  let o;
  if (debugOpenActive) {
    // Debug API forces a value directly (used by the screenshot harness).
    openCurrent = lerp(openCurrent, debugOpen, 0.2);
    o = easeInOut(openCurrent);
  } else if (autoOpen.active || autoOpen.done) {
    // MOBILE tap tween OWNS the open amount: a self-playing, time-based twin
    // from `from`→1 over autoOpen.duration, then hold at 1. We advance the
    // raw 0..1 amount here and let the shared easeInOut below shape the
    // curve (single source of easing → smooth, no double-easing).
    if (autoOpen.active) {
      const p = Math.min(1, (now - autoOpen.start) / autoOpen.duration);
      openCurrent = autoOpen.from + (1 - autoOpen.from) * p;
      if (p >= 1) { openCurrent = 1; autoOpen.active = false; autoOpen.done = true; }
    } else {
      openCurrent = 1; // hold fully open
    }
    o = easeInOut(openCurrent);
  } else {
    /* ---- Combine all open sources (max wins) — desktop scroll/hover/click. */
    const openTarget = Math.max(scrollProgress, hoverProgress, clickProgress, autoProgress);
    // Smooth, no jerk. Scroll-driven uses a slightly snappier follow so the
    // reveal tracks the wheel closely; idle/hover stays silky.
    openCurrent = lerp(openCurrent, openTarget, scrollDriven ? 0.14 : 0.09);
    o = easeInOut(openCurrent);
  }

  /* ---- Roof: lift, fade, drift + tilt for a "lid off" feel ---- */
  if (roof) {
    roof.position.y = lerp(roof.userData.baseY, roof.userData.baseY + roof.userData.liftY, o);
    roof.position.x = lerp(0, 1.0, o);
    roof.rotation.z = lerp(0, 0.07, o);
    const op = lerp(1, 0.0, o);
    roof.userData.mats.forEach((m) => { m.opacity = op; });
    roof.visible = op > 0.02;
  }

  /* ---- Walls: turn translucent so the interior reads (front fades most).
          The glass window bands start translucent; their starting opacity
          is captured once so the lerp doesn't snap them opaque. ---- */
  for (let i = 0; i < wallMaterials.length; i++) {
    const w = wallMaterials[i];
    if (w.startOp === undefined) w.startOp = w.mat.opacity; // 1.0 for walls, 0.5 for glass
    w.mat.opacity = lerp(w.startOp, w.open, o);
    w.mat.depthWrite = w.mat.opacity > 0.95; // avoid sorting halos when see-through
  }

  /* ---- Interior "power on": glow light + emissive + LED flicker ramp ---- */
  if (interiorLight) interiorLight.intensity = lerp(0.0, 3.0, o);
  for (let i = 0; i < glowMeshes.length; i++) {
    const g = glowMeshes[i];
    g.mat.emissiveIntensity = lerp(g.base, g.peak, o);
  }
  // LEDs: ramp with open AND flicker over time so the system looks alive.
  for (let i = 0; i < ledGroups.length; i++) {
    const L = ledGroups[i];
    const flick = reducedMotion ? 1.0 : (0.72 + 0.28 * Math.sin(now * 0.001 * L.speed + L.phase));
    L.mat.emissiveIntensity = lerp(L.base, L.peak, o) * flick;
  }

  /* ---- Camera: auto-rotate azimuth + lean-in driven by open ---- */
  if (!reducedMotion && !dragging) {
    // Slow drift; ease the rotation as we open so the reveal settles.
    azimuth += dt * 0.1 * (1 - 0.85 * o);
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
  if (scrollProgress > 0.002) { userInteracted = true; scrollDriven = true; }
}

/* Expose whether the live scene exists (main.js decides the pin track). */
export function sceneActive() {
  return !!renderer;
}

/* Live mobile check (re-evaluated, not cached) so main.js and scene.js agree
   on the mode even after a resize across the 768px breakpoint. */
export function isMobileMode() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

/* Auto-init on import */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
