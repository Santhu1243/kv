// scene basics
let scene, camera, renderer, warehouse, animationId;
let isAnimating = true;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let overlayMode = "ABC";
// interaction state
let cameraControls = { mouseX: 0, mouseY: 0, isMouseDown: false, isPanning: false };
let hoveredMesh = null,
  selectedMesh = null;
let dragging = false,
  draggedMesh = null,
  dragOffset = new THREE.Vector3();
let dragStarted = false; // ✅ ADD
let startMouse = { x: 0, y: 0 };
function abcDirectColor(abc) {
  if (abc === "A") return new THREE.Color("#e74c3c"); // 🔴 Red
  if (abc === "B") return new THREE.Color("#2ecc71"); // 🟢 Green
  return new THREE.Color("#1e3cff"); // 🔵 Blue
}
function abcToScore(abc) {
  switch (abc) {
    case "A":
      return 1.0;
    case "B":
      return 0.6;
    case "C":
      return 0.3;
    default:
      return 0.1;
  }
}

const stats = {
  minHits: Infinity,
  maxHits: -Infinity,
  minQty: Infinity,
  maxQty: -Infinity,
};

function normalize(value, min, max) {
  if (max === min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

const HEAT_WEIGHTS = {
  abc: 0.4,
  hits: 0.35,
  qty: 0.25,
};

function calculateHeatStats(bins) {
  if (!Array.isArray(bins) || bins.length === 0) {
    return { minHits: 0, maxHits: 1, minQty: 0, maxQty: 1 };
  }

  let minHits = Infinity,
    maxHits = -Infinity;
  let minQty = Infinity,
    maxQty = -Infinity;

  bins.forEach((b) => {
    const hits = b.hits ?? 0;
    const qty = b.qty ?? 0;

    minHits = Math.min(minHits, hits);
    maxHits = Math.max(maxHits, hits);
    minQty = Math.min(minQty, qty);
    maxQty = Math.max(maxQty, qty);
  });

  // prevent divide-by-zero
  if (minHits === maxHits) maxHits++;
  if (minQty === maxQty) maxQty++;

  return { minHits, maxHits, minQty, maxQty };
}

function computeHeat(bin, stats) {
  const abcScore = abcToScore(bin.abc);
  const hitsScore = normalize(bin.hits || 0, stats.minHits, stats.maxHits);
  const qtyScore = normalize(bin.qty || 0, stats.minQty, stats.maxQty);

  return HEAT_WEIGHTS.abc * abcScore + HEAT_WEIGHTS.hits * hitsScore + HEAT_WEIGHTS.qty * qtyScore;
}
const HEAT_GRADIENT = [
  { t: 0.0, color: new THREE.Color("#1e3cff") }, // blue (cold)
  { t: 0.3, color: new THREE.Color("#00722fff") }, // green
  { t: 0.6, color: new THREE.Color("#f1c40f") }, // yellow
  { t: 0.8, color: new THREE.Color("#e67e22") }, // orange
  { t: 1.0, color: new THREE.Color("#e74c3c") }, // red (hot)
];

function ensureHeatData(bin) {
  if (!bin.abc) bin.abc = "C";
  if (bin.hits == null) bin.hits = 0;
  if (bin.qty == null) bin.qty = 0;
}

function heatToColor(t) {
  for (let i = 0; i < HEAT_GRADIENT.length - 1; i++) {
    const a = HEAT_GRADIENT[i];
    const b = HEAT_GRADIENT[i + 1];

    if (t >= a.t && t <= b.t) {
      const localT = (t - a.t) / (b.t - a.t);
      return a.color.clone().lerp(b.color, localT);
    }
  }
  return HEAT_GRADIENT.at(-1).color.clone();
}

// bins and zones
let flattenedBins = [];
let zones = [];

// endpoints (placeholders)
// const API_GET = "/api/bins/";
// const API_GET = "/static/mock/bins.json";
const API_GET = "/api/bin-heatmap/";

const API_SAVE_POSITION = "/api/bins/update-position/";
const GRID_SIZE = 1.0; // 2m grid (your choice C)

function createBinGroup(binMeta) {
  const group = new THREE.Group();
  group.userData.bin = binMeta;
  group.userData.isBinGroup = true;
  group.isBinGroup = true;
  return group;
}

// ---------------- init ----------------
async function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 50, 200);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(30, 25, 30);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.getElementById("container").appendChild(renderer.domElement);

  setupLighting();
  setupUI();
  setupControls();

  const loadingEl = document.getElementById("loading");
  if (loadingEl) loadingEl.style.display = "flex";

  try {
    const res = await fetch("/api/warehouse-heatmap-api/");
    if (!res.ok) throw new Error("No DB data");

    const payload = await res.json();

    if (!payload.bins || payload.bins.length === 0) {
      alert("No bins in database. Please upload Excel.");
      return;
    }

    renderBinsFromDB(payload); // ✅ ONLY DB RENDER
    createZones();
    animate();
  } catch (err) {
    console.error("Failed to load bins from DB:", err);
    alert("Failed to load bins from database.");
  } finally {
    if (loadingEl) loadingEl.style.display = "none";
  }
}

function setupLighting() {
  const ambient = new THREE.AmbientLight(0x404040, 0.7);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(50, 50, 25);
  dir.castShadow = true;
  scene.add(dir);
  const p1 = new THREE.PointLight(0xffffff, 0.4, 100);
  p1.position.set(-25, 15, -25);
  scene.add(p1);
  const p2 = new THREE.PointLight(0xffffff, 0.4, 100);
  p2.position.set(25, 15, 25);
  scene.add(p2);
}
function placeOnFloor(mesh) {
  const bbox = new THREE.Box3().setFromObject(mesh);
  const height = bbox.max.y - bbox.min.y;
  mesh.position.y = height / 2; // exact ground placement
}

function setupUI() {
  const rows = document.getElementById("rows"),
    shelves = document.getElementById("shelves"),
    height = document.getElementById("height");
  const rowsValue = document.getElementById("rowsValue"),
    shelvesValue = document.getElementById("shelvesValue"),
    heightValue = document.getElementById("heightValue");
  rows.addEventListener("input", () => (rowsValue.textContent = rows.value));
  shelves.addEventListener("input", () => (shelvesValue.textContent = shelves.value));
  height.addEventListener("input", () => (heightValue.textContent = height.value));

  document.getElementById("btnRegenerate").addEventListener("click", () => {
    if (flattenedBins && flattenedBins.length) applyBinsDataAndRender(flattenedBins);
    else generateWarehouse();
    clearSelection();
    hideHoverLabel();
    createZones();
  });
  document.getElementById("btnToggleAnim").addEventListener("click", () => {
    isAnimating = !isAnimating;
    if (isAnimating) animate();
    else cancelAnimationFrame(animationId);
  });
  document.getElementById("btnResetCam").addEventListener("click", () => {
    camera.position.set(30, 25, 30);
    camera.lookAt(0, 0, 0);
  });

  document.getElementById("pm_cancel").addEventListener("click", closeProductModal);
  document.getElementById("pm_save").addEventListener("click", saveProductModal);
}

// ---------------- API loader ----------------
// async function loadNestedBinsFromApi() {
//   try {
//     const res = await fetch(API_GET, { cache: "no-store" });
//     if (!res.ok) throw new Error("HTTP " + res.status);
//     const payload = await res.json();
//     if (!payload || !payload.rows) {
//       console.warn("unexpected payload");
//       return false;
//     }
//     flattenedBins = [];
//     payload.rows.forEach((row) => {
//       const rId = row.row_id || row.id || 0;
//       if (!Array.isArray(row.shelves)) return;
//       row.shelves.forEach((shelf) => {
//         const sId = shelf.shelf_id || shelf.id || 0;
//         if (!Array.isArray(shelf.levels)) return;
//         shelf.levels.forEach((levelObj) => {
//           const lvl = levelObj.level || levelObj.id || 0;
//           const binData = levelObj.bin || levelObj;
//           const product = binData.product || null;
//           const label = binData.label || `R${rId}-S${sId}-L${lvl}`;
//           flattenedBins.push({
//             row_id: rId,
//             shelf_id: sId,
//             level: lvl,
//             product: product,
//             label: label,
//             type: binData.type || "generic",
//             qty: binData.qty || (product ? product.quantity || 1 : 0),
//             occupied: !!product,
//             width: binData.width || 1.2,
//             depth: binData.depth || 1.2,
//             height: binData.height || 0.7,
//             zone: binData.zone || null,
//           });
//         });
//       });
//     });
//     if (flattenedBins.length) {
//       applyBinsDataAndRender(flattenedBins);
//       return true;
//     }
//     return false;
//   } catch (err) {
//     console.warn("API error", err);
//     return false;
//   }
// }
function renderBinsFromDB(payload) {
  if (warehouse) scene.remove(warehouse);
  warehouse = new THREE.Group();

  createFloor();

  const PALLET_W = 1.2;
  const LEVEL_H = 2.0;
  const ROW_SPACING = 5;
  const RACK_DEPTH = 1.2;
  const PALLET_H = 0.18;
  const BEAM_Y_OFFSET = 1.0;

  Object.assign(stats, calculateHeatStats(payload.bins));

  // group bins by row
  const rows = {};
  payload.bins.forEach((b) => {
    if (!rows[b.row]) rows[b.row] = [];
    rows[b.row].push(b);
  });

  Object.entries(rows).forEach(([rowIndex, bins]) => {
    const z = (rowIndex - payload.config.rows / 2) * ROW_SPACING;

    const maxShelf = Math.max(...bins.map((b) => b.shelf));
    const rack = createPalletRack(maxShelf, RACK_DEPTH, payload.config.max_levels);

    rack.position.set(-(maxShelf * PALLET_W) / 2, 0, z);
    warehouse.add(rack);

    bins.forEach((bin) => {
      const group = new THREE.Group();
      group.userData.bin = bin;
      group.userData.isBinGroup = true;

      /* ---------- PALLET ---------- */
      const pallet = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 1.2), new THREE.MeshLambertMaterial({ color: 0x8b4513 }));
      pallet.position.set(0, 0, 0);
      pallet.castShadow = true;
      group.add(pallet);

      /* ---------- LOAD ---------- */
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(bin.width, bin.height, bin.depth),
        new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.95 })
      );

      box.position.set(0, 0.18 + bin.height / 2, 0);
      box.userData.bin = bin;
      box.userData._baseColor = new THREE.Color(0x4fa3ff); // neutral blue
      box.material.color.copy(box.userData._baseColor);

      // color overlay
      if (overlayMode === "ABC") {
        const c = abcDirectColor(bin.abc);
        box.material.color.copy(c);
        box.material.emissive.copy(c);
        box.material.emissiveIntensity = 0.6;
      }

      group.add(box);

      /* ---------- PERFECT PLACEMENT ---------- */
      group.position.set((bin.shelf - 0.5) * PALLET_W - (maxShelf * PALLET_W) / 2, bin.level * LEVEL_H + 1.0, z);

      warehouse.add(group);
    });
  });

  createCeiling();
  scene.add(warehouse);
}

function createBinGroupFromDB(bin) {
  const group = new THREE.Group();
  group.userData.bin = bin;
  group.userData.isBinGroup = true;
  return group;
}

function createPalletVisual() {
  const pallet = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });

  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 1.2), mat);
  deck.position.y = 0.09;
  pallet.add(deck);

  return pallet;
}

// Replace your existing loadNestedBinsFromApi
// ---------------- API loader ----------------
async function loadNestedBinsFromApi() {
  const loadingEl = document.getElementById("loading");
  if (loadingEl) loadingEl.style.display = "flex";

  try {
    // 1. Fetch from Django
    const res = await fetch("/api/warehouse-heatmap-api/");
    if (!res.ok) throw new Error("API Failed");

    const payload = await res.json();

    // 2. Render using DB coordinates
    renderBinsFromDB(payload);

    return true;
  } catch (err) {
    console.warn("API load failed, falling back to generator:", err);
    return false; // This triggers the fallback in init()
  } finally {
    if (loadingEl) loadingEl.style.display = "none";
  }
}

function assignMockHeatData(bin) {
  // ABC distribution (realistic)
  const r = Math.random();
  if (r < 0.15) bin.abc = "A";
  else if (r < 0.45) bin.abc = "B";
  else bin.abc = "C";

  // Hits based on ABC
  if (bin.abc === "A") bin.hits = 800 + Math.floor(Math.random() * 400);
  else if (bin.abc === "B") bin.hits = 300 + Math.floor(Math.random() * 300);
  else bin.hits = 20 + Math.floor(Math.random() * 100);

  // Qty safety
  bin.qty = bin.qty ?? Math.floor(Math.random() * 50 + 10);
}

// ---------------- unified placement helper ----------------
// shelfY is computed as level * 2 (this is the convention across the app)
function shelfYForLevel(level) {
  // level may be 0-based or 1-based depending on data; caller supplies the level number used in generation
  return level * 2;
}

function placeBinOnShelf(mesh, level, height) {
  // place mesh so its bottom rests exactly at the shelf surface
  const shelfY = shelfYForLevel(level);
  mesh.position.y = shelfY + height / 2;
}

// ---------------- bin visual ----------------
function createBinVisual(rackX, rackZ, bin) {
  const w = bin.width || 5.0;
  const h = bin.height || 0.6;
  const d = bin.depth || 1.0;

  const occupied = !!bin.occupied;
  const baseColor = occupied ? 0xffb86b : 0x999999;

  const mat = new THREE.MeshLambertMaterial({
    color: baseColor,
    transparent: true,
    opacity: occupied ? 0.95 : 0.6,
  });

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // ✅ REQUIRED for overlays
  mesh.userData._baseColor = mat.color.clone();

  // positioning (unchanged)
  const offsetX = (bin.shelf || 1) % 2 === 0 ? -0.45 : 0.45;
  mesh.position.x = rackX + offsetX;
  mesh.position.z = rackZ + (Math.random() - 0.5) * 0.12;

  placeBinOnShelf(mesh, bin.level || 0, h);

  // ✅ BIN IDENTITY FROM DB
  mesh.userData.bin = {
    bin_code: bin.bin_code,
    row_id: bin.row,
    shelf_id: bin.shelf,
    level: bin.level,
    occupied: bin.occupied,
    qty: bin.qty || 0,
    hits: bin.hits || 0,
    abc: bin.abc || "C",
    product: bin.product || null,
    label: bin.bin_code,
  };

  warehouse.add(mesh);
}

function applyOverlayMode(mode) {
  overlayMode = mode;

  warehouse.traverse((obj) => {
    if (!obj.isMesh || !obj.userData?.bin || !obj.userData._baseColor) return;

    if (mode === "ABC") {
      const c = abcDirectColor(obj.userData.bin.abc);
      obj.material.color.copy(c);
      obj.material.emissive.copy(c);
      obj.material.emissiveIntensity = 0.8;
    }

    if (mode === "HEAT") {
      const heat = computeHeat(obj.userData.bin, stats);
      const c = heatToColor(heat);
      obj.material.color.copy(c);
      obj.material.emissive.copy(c);
      obj.material.emissiveIntensity = 0.9;
    }

    if (mode === "NONE") {
      obj.material.color.copy(obj.userData._baseColor);
      obj.material.emissive.set(0x000000);
      obj.material.emissiveIntensity = 0;
    }
  });
}

// ---------------- procedural generator ----------------
function generateWarehouse() {
  if (warehouse) scene.remove(warehouse);
  warehouse = new THREE.Group();
  const rows = parseInt(document.getElementById("rows").value);
  const shelvesPerRow = parseInt(document.getElementById("shelves").value);
  const shelfHeight = parseInt(document.getElementById("height").value);
  document.getElementById("rowsValue").textContent = rows;
  document.getElementById("shelvesValue").textContent = shelvesPerRow;
  document.getElementById("heightValue").textContent = shelfHeight;
  createFloor();
  const usePallet = document.getElementById("palletRacking").checked;
  createStorageRacks(rows, shelvesPerRow, shelfHeight, usePallet);
  createCeiling();
  scene.add(warehouse);
}

// ---------------- floor, racks, pallets, containers ----------------
function createFloor() {
  const floorGeometry = new THREE.PlaneGeometry(200, 200);
  const floorMaterial = new THREE.MeshLambertMaterial({ color: 0x808080, transparent: true, opacity: 0.85 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0; // anchor
  floor.receiveShadow = true;
  warehouse.add(floor);

  const gridHelper = new THREE.GridHelper(200, 40, 0xffffff, 0xffffff);
  gridHelper.position.y = 0.01;
  gridHelper.material.opacity = 0.12;
  gridHelper.material.transparent = true;
  warehouse.add(gridHelper);
}

function createStorageRacks(rows, shelvesPerRow, shelfHeight, usePalletRacking) {
  const rackWidth = 4,
    rackDepth = 2,
    rackSpacing = 3,
    rowSpacing = 5;
  for (let row = 0; row < rows; row++) {
    for (let shelf = 0; shelf < shelvesPerRow; shelf++) {
      const x = (shelf - shelvesPerRow / 2) * rackSpacing;
      const z = (row - rows / 2) * rowSpacing;
      const rack = usePalletRacking ? createPalletRack(2.7, 1.2, shelfHeight) : createBasicRack(rackWidth, rackDepth, shelfHeight);
      rack.position.set(x, 0, z);
      warehouse.add(rack);
      if (usePalletRacking) {
        addPallets(x, z, rackWidth, rackDepth, shelfHeight, row, shelf);
      } else {
        addStorageContainers(x, z, rackWidth, rackDepth, shelfHeight, row, shelf);
      }
    }
  }
}

function createBasicRack(width, depth, height) {
  const rack = new THREE.Group();
  const rackMat = new THREE.MeshLambertMaterial({
    color: 0x333333,
    transparent: true,
    opacity: 0.35, // 👈 dim rack
  });
  const supportGeom = new THREE.BoxGeometry(0.2, height * 2, 0.2);
  const positions = [
    [-width / 2, height, -depth / 2],
    [width / 2, height, -depth / 2],
    [-width / 2, height, depth / 2],
    [width / 2, height, depth / 2],
  ];
  positions.forEach((pos) => {
    const support = new THREE.Mesh(supportGeom, rackMat);
    // support center at 'height' will have bottom at y = 0
    support.position.set(pos[0], pos[1], pos[2]);
    support.castShadow = true;
    rack.add(support);
  });

  const shelfGeom = new THREE.BoxGeometry(width, 0.1, depth);
  const shelfMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
  for (let level = 0; level <= height; level++) {
    const shelf = new THREE.Mesh(shelfGeom, shelfMat);
    shelf.position.y = level * 2; // shelf surface Y
    shelf.castShadow = true;
    shelf.receiveShadow = true;
    rack.add(shelf);
  }
  return rack;
}

function createPalletRack(bays, depth, levels) {
  const rack = new THREE.Group();

  /* =========================
     REALISTIC CONSTANTS
  ========================= */
  const PALLET_W = 1.2;
  const LEVEL_H = 2.0;
  const FIRST_BEAM_Y = 0.95; // 🔑 first load level (NO beam at floor)
  const TOP_MARGIN = 0.25;

  /* =========================
     MATERIALS
  ========================= */
  const uprightMat = new THREE.MeshLambertMaterial({ color: 0x2f5f3a });
  const beamMat = new THREE.MeshLambertMaterial({ color: 0xff6a00 });

  /* =========================
     HEIGHT CALCULATION
  ========================= */
  const topBeamY = FIRST_BEAM_Y + (levels - 1) * LEVEL_H;
  const uprightHeight = topBeamY + TOP_MARGIN;

  /* =========================
     UPRIGHTS (CLEAN START & END)
  ========================= */
  const uprightGeom = new THREE.BoxGeometry(0.14, uprightHeight, 0.14);

  for (let i = 0; i <= bays; i++) {
    const x = i * PALLET_W;

    [-depth / 2, depth / 2].forEach((z) => {
      // Upright
      const upright = new THREE.Mesh(uprightGeom, uprightMat);
      upright.position.set(x, uprightHeight / 2, z);
      upright.castShadow = true;
      rack.add(upright);

      // Base plate ONLY (no beam)
      const basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.34), uprightMat);
      basePlate.position.set(x, 0.02, z);
      rack.add(basePlate);
    });
  }

  /* =========================
     BEAMS (START FROM FIRST LEVEL ONLY)
  ========================= */
  const beamGeom = new THREE.BoxGeometry(bays * PALLET_W, 0.14, 0.12);

  for (let level = 0; level < levels; level++) {
    const y = FIRST_BEAM_Y + level * LEVEL_H;

    [-depth / 2, depth / 2].forEach((z) => {
      const beam = new THREE.Mesh(beamGeom, beamMat);
      beam.position.set((bays * PALLET_W) / 2, y, z);
      beam.castShadow = true;
      rack.add(beam);
    });
  }

  return rack;
}

function assignPalletHeat(bin) {
  const r = Math.random();

  if (r < 0.15) {
    bin.abc = "A";
    bin.hits = 800 + Math.floor(Math.random() * 400);
    bin.qty = 60 + Math.floor(Math.random() * 40);
  } else if (r < 0.45) {
    bin.abc = "B";
    bin.hits = 300 + Math.floor(Math.random() * 300);
    bin.qty = 30 + Math.floor(Math.random() * 20);
  } else {
    bin.abc = "C";
    bin.hits = 40 + Math.floor(Math.random() * 80);
    bin.qty = 5 + Math.floor(Math.random() * 15);
  }
}

function assignDemoABCByOrder(bins) {
  const total = bins.length;

  const aLimit = Math.floor(total * 0.2); // first 20% → A
  const bLimit = Math.floor(total * 0.5); // next 30% → B

  bins.forEach((bin, index) => {
    if (index < aLimit) {
      // 🔴 HOT
      bin.abc = "A";
      bin.hits = 900;
      bin.qty = 80;
    } else if (index < bLimit) {
      // 🟢 MEDIUM
      bin.abc = "B";
      bin.hits = 350;
      bin.qty = 40;
    } else {
      // 🔵 COLD
      bin.abc = "C";
      bin.hits = 60;
      bin.qty = 10;
    }
  });
}
function applyBinsDataAndRender(bins) {
  if (warehouse) scene.remove(warehouse);
  warehouse = new THREE.Group();
  createFloor();

  // ✅ 2️⃣ CALCULATE HEAT RANGE AFTER ASSIGNMENT
  Object.assign(stats, calculateHeatStats(bins));

  const rackSpacing = 3;
  const rowSpacing = 5;
  const shelvesMax = parseInt(document.getElementById("shelves").value);
  const rowsMax = parseInt(document.getElementById("rows").value);

  const groups = {};

  bins.forEach((bin) => {
    const key = `r${bin.row_id}_s${bin.shelf_id}`;
    if (!groups[key]) {
      groups[key] = {
        row: bin.row_id,
        shelf: bin.shelf_id,
        bins: [],
      };
    }
    groups[key].bins.push(bin);
  });

  Object.values(groups).forEach((entry) => {
    const x = (entry.shelf - shelvesMax / 2) * rackSpacing;
    const z = (entry.row - rowsMax / 2) * rowSpacing;

    const rackHeight = Math.max(...entry.bins.map((b) => b.level || 0), 1);
    const rack = createBasicRack(4, 2, rackHeight);
    rack.position.set(x, 0, z);
    warehouse.add(rack);

    entry.bins.forEach((bin) => {
      createBinVisual(x, z, bin);
    });
  });

  createCeiling();
  scene.add(warehouse);
  createZones();
}

function addPallets(rackX, rackZ, rackWidth, rackDepth, shelfHeight, rowIndex, shelfIndex) {
  const palletWidth = 1.2;
  const palletLength = 1.2;
  const palletHeight = 0.2;

  // total usable bin height (pallet + goods)
  const BIN_TOTAL_HEIGHT = 1.6;

  for (let level = 0; level <= shelfHeight; level++) {
    const palletsPerLevel = 2;

    for (let i = 0; i < palletsPerLevel; i++) {
      const offsetX = (i - palletsPerLevel / 2 + 0.5) * 1.5;
      const shelfY = shelfYForLevel(level);
      const palletY = shelfY + palletHeight / 2;

      /* =========================
         BIN META (NO HARD CODING)
      ========================= */
      const binMeta = {
        row_id: rowIndex + 1,
        shelf_id: shelfIndex + 1,
        level,
        type: "pallet",
        qty: 1,
        occupied: true,
        label: `R${rowIndex + 1}-S${shelfIndex + 1}-L${level}`,
        product: null,
        zone: null,
      };

      // ✅ Assign realistic ABC / hits / qty
      assignPalletHeat(binMeta);

      /* =========================
         BIN GROUP (LOGICAL BIN)
      ========================= */
      const binGroup = createBinGroup(binMeta);
      binGroup.position.set(rackX + offsetX, palletY, rackZ);

      // base color for overlay reset
      binGroup.userData._baseColor = new THREE.Color(0x999999);

      /* =========================
         HEATMAP BIN VOLUME
      ========================= */
      const binGeom = new THREE.BoxGeometry(palletWidth, BIN_TOTAL_HEIGHT, palletLength);
      const binMat = new THREE.MeshLambertMaterial({
        color: 0x999999,
        transparent: true,
        opacity: 1.0,
      });

      const binVolume = new THREE.Mesh(binGeom, binMat);
      binVolume.position.y = palletHeight + BIN_TOTAL_HEIGHT / 2;

      binVolume.userData.bin = binMeta;
      binVolume.userData._baseColor = binMat.color.clone();

      // apply ABC coloring if enabled
      if (overlayMode === "ABC") {
        const color = abcDirectColor(binMeta.abc);
        binMat.color.copy(color);
        binMat.emissive.copy(color);
        binMat.emissiveIntensity = 0.6;
      }

      binGroup.add(binVolume);

      /* =========================
         PALLET (VISUAL ONLY)
      ========================= */
      const pallet = createPallet(palletWidth, palletLength, palletHeight);
      pallet.userData.bin = binMeta;
      binGroup.add(pallet);

      /* =========================
         GOODS (VISUAL ONLY)
      ========================= */
      addGoodsOnPalletGrouped(binGroup, palletHeight / 2, palletWidth, palletLength, binMeta);

      warehouse.add(binGroup);
    }
  }
}

function createPallet(width, length, height) {
  const pallet = new THREE.Group();
  const palletMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
  const slatGeom = new THREE.BoxGeometry(width, height * 0.3, 0.1);
  const numSlats = 7;
  for (let i = 0; i < numSlats; i++) {
    const slat = new THREE.Mesh(slatGeom, palletMat);
    slat.position.z = (i - (numSlats - 1) / 2) * (length / numSlats);
    slat.castShadow = true;
    pallet.add(slat);
  }
  const runnerGeom = new THREE.BoxGeometry(0.1, height, length);
  [-width / 3, 0, width / 3].forEach((x) => {
    const runner = new THREE.Mesh(runnerGeom, palletMat);
    runner.position.x = x;
    runner.position.y = -height * 0.35;
    runner.castShadow = true;
    pallet.add(runner);
  });
  const bbox = new THREE.Mesh(new THREE.BoxGeometry(width, height * 1.2, length), new THREE.MeshBasicMaterial({ visible: false }));
  bbox.position.y = 0.1;
  pallet.add(bbox);
  pallet.userData.pickMesh = bbox;
  return pallet;
}

function addGoodsOnPallet(x, y, z, palletWidth, palletLength, binMeta) {
  const goodsTypes = [{ color: 0x8b4513 }, { color: 0x2e8b57 }, { color: 0x4682b4 }, { color: 0x696969 }];
  const goodsType = goodsTypes[Math.floor(Math.random() * goodsTypes.length)];
  const stackHeight = 1;
  for (let s = 0; s < stackHeight; s++) {
    const goodsGeom = new THREE.BoxGeometry(palletWidth * 0.8, 1.2, palletLength * 0.8);
    const goodsMat = new THREE.MeshLambertMaterial({ color: goodsType.color, transparent: true, opacity: 0.9 });
    const goods = new THREE.Mesh(goodsGeom, goodsMat);
    // y is pallet top; goods center = y + half goods height + small offset
    goods.position.set(x + (Math.random() - 0.5) * palletWidth * 0.2, y + 0.6 + s * 0.6, z + (Math.random() - 0.5) * palletLength * 0.2);
    goods.castShadow = true;
    goods.receiveShadow = true;
    goods.userData.bin = binMeta;
    warehouse.add(goods);
  }
}

function addGoodsOnPalletGrouped(group, palletTopOffset, palletWidth, palletLength, binMeta) {
  const goodsGeom = new THREE.BoxGeometry(palletWidth * 0.8, 1.2, palletLength * 0.8);
  const goodsMat = new THREE.MeshLambertMaterial({ color: 0x4682b4, transparent: true, opacity: 0.9 });

  const goods = new THREE.Mesh(goodsGeom, goodsMat);
  goods.position.set((Math.random() - 0.5) * palletWidth * 0.2, palletTopOffset + 0.6, (Math.random() - 0.5) * palletLength * 0.2);

  goods.castShadow = true;
  goods.receiveShadow = true;
  goods.userData.bin = binMeta;

  group.add(goods);
}

function addStorageContainers(rackX, rackZ, rackWidth, rackDepth, shelfHeight, rowIndex, shelfIndex) {
  for (let level = 1; level <= shelfHeight; level++) {
    const containersPerLevel = Math.floor(Math.random() * 3) + 2;

    for (let i = 0; i < containersPerLevel; i++) {
      const cw = 0.8 + Math.random() * 0.4;
      const ch = 0.6 + Math.random() * 0.3;
      const cd = 0.6 + Math.random() * 0.3;

      const binMeta = {
        row_id: rowIndex + 1,
        shelf_id: shelfIndex + 1,
        level,
        type: "container",
        qty: Math.floor(Math.random() * 50) + 5,
        occupied: true,
        abc: ["A", "B", "C"][Math.floor(Math.random() * 3)],
        hits: Math.floor(Math.random() * 800),
        label: `R${rowIndex + 1}-S${shelfIndex + 1}-L${level}`,
        product: null,
        zone: null,
      };

      const mat = new THREE.MeshLambertMaterial({
        color: 0x999999, // neutral base
        transparent: true,
        opacity: 0.9,
      });

      const container = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, cd), mat);

      // store base color for overlay toggle
      container.userData._baseColor = mat.color.clone();
      container.userData.bin = binMeta;

      const shelfY = shelfYForLevel(level);
      container.position.set(rackX + (Math.random() - 0.5) * (rackWidth - 1), shelfY + ch / 2, rackZ + (Math.random() - 0.5) * (rackDepth - 0.5));

      container.castShadow = true;
      container.receiveShadow = true;

      // 🔥 APPLY ABC COLORING
      if (overlayMode === "ABC") {
        const color = abcDirectColor(binMeta.abc);

        mat.color.copy(color);
        mat.emissive.copy(color);
        mat.emissiveIntensity = 0.6;
      }

      warehouse.add(container);
    }
  }
}

function createCeiling() {
  const ceilingHeight = 50;
  const ceilingGeometry = new THREE.PlaneGeometry(200, 160);
  const ceilingMaterial = new THREE.MeshLambertMaterial({ color: 0xcccccc, transparent: true, opacity: 0.3 });
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ceilingHeight;
  warehouse.add(ceiling);

  for (let i = 0; i < 6; i++) {
    const light = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.2, 8),
      new THREE.MeshLambertMaterial({ color: 0xffffcc, emissive: 0x444400 })
    );
    light.position.set((Math.random() - 0.5) * 180, ceilingHeight - 1, (Math.random() - 0.5) * 140);
    warehouse.add(light);
  }
}

// ---------------- zones ----------------
function createZones() {
  // remove old zones
  zones.forEach((z) => {
    if (z.mesh && z.mesh.parent) z.mesh.parent.remove(z.mesh);
  });
  zones = [];

  const zoneWidth = 12;
  const zoneDepth = 10;
  const cellSize = 2.5; // size of each placement space

  const zonePositions = [
    { id: "ZONE_1", label: "Zone 1", x: -20, z: 22 },
    { id: "ZONE_2", label: "Zone 2", x: 0, z: 22 },
    { id: "ZONE_3", label: "Zone 3", x: 20, z: 22 },
  ];

  zonePositions.forEach((zp, i) => {
    const cols = Math.floor(zoneWidth / cellSize);
    const rows = Math.floor(zoneDepth / cellSize);

    for (let cx = 0; cx < cols; cx++) {
      for (let cz = 0; cz < rows; cz++) {
        // compute each cell's world position
        const posX = zp.x - zoneWidth / 2 + cx * cellSize + cellSize / 2;
        const posZ = zp.z - zoneDepth / 2 + cz * cellSize + cellSize / 2;

        const geom = new THREE.PlaneGeometry(cellSize, cellSize);
        const mat = new THREE.MeshLambertMaterial({
          color: i === 0 ? 0x4fc3f7 : i === 1 ? 0x6dd68a : 0xff8a80,
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide,
          depthWrite: false,
        });

        const mesh = new THREE.Mesh(geom, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(posX, 0.01, posZ);

        const spaceId = `${zp.id}_SPACE_${cx}_${cz}`;

        mesh.userData = {
          type: "zone_cell",
          id: spaceId,
          zone: zp.id,
          label: `${zp.label} Space ${cx}-${cz}`,
          width: cellSize,
          depth: cellSize,
        };

        const highlightMat = new THREE.MeshLambertMaterial({
          color: 0xffff99,
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
        });

        zones.push({
          mesh,
          id: spaceId, // unique space ID
          zone: zp.id, // parent zone
          label: `${zp.label} Space ${cx}-${cz}`,
          width: cellSize,
          depth: cellSize,
          normalMat: mat,
          highlightMat,
        });

        scene.add(mesh);
      }
    }
  });
}
function getZoneTopY(x, z, excludeMesh = null) {
  let maxY = 0;

  warehouse.traverse((obj) => {
    if (obj !== excludeMesh && obj.userData && obj.userData.bin && obj.userData.bin.zone) {
      const bbox = new THREE.Box3().setFromObject(obj);
      const posX = (bbox.min.x + bbox.max.x) / 2;
      const posZ = (bbox.min.z + bbox.max.z) / 2;

      // check if within small distance in X/Z (like inside the same cell)
      if (Math.abs(posX - x) < 1 && Math.abs(posZ - z) < 1) {
        if (bbox.max.y > maxY) maxY = bbox.max.y;
      }
    }
  });

  return maxY;
}

// ---------------- raycast & interactions ----------------
function setupControls() {
  const canvas = renderer.domElement;
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", (e) => onMouseUp(e));
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("click", onClick);
  window.addEventListener("resize", onWindowResize);

  // touch
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd, { passive: false });
}
function onMouseDown(event) {
  cameraControls.isMouseDown = true;
  cameraControls.isPanning = event.button === 2;
  cameraControls.mouseX = event.clientX;
  cameraControls.mouseY = event.clientY;

  startMouse.x = event.clientX;
  startMouse.y = event.clientY;
  dragStarted = false;

  const hit = getBinUnderCursor(event);
  if (!hit) return;

  dragging = true;
  draggedMesh = hit.userData.isBinGroup ? hit : hit.parent;

  draggedMesh.userData._origPosition = draggedMesh.position.clone();

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(draggedMesh, true); // check against object itself

  if (intersects.length > 0) {
    // offset from the point you clicked to the object's position
    dragOffset.copy(intersects[0].point).sub(draggedMesh.position);
  } else {
    dragOffset.set(0, 0, 0);
  }

  // disable camera when dragging bin
  cameraControls.isMouseDown = false;
  cameraControls.isPanning = false;
}

const DRAG_THRESHOLD = 3;

function onMouseMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  /* ================================
     BIN DRAGGING LOGIC
  ================================= */
  if (dragging && draggedMesh) {
    // 🔑 STEP 1: Check if mouse really moved
    const dx = Math.abs(event.clientX - startMouse.x);
    const dy = Math.abs(event.clientY - startMouse.y);

    if (!dragStarted) {
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
        return; // 🚫 ignore accidental click
      }

      // ✅ real drag starts HERE
      dragStarted = true;

      // lock original Y (prevents jump)
      if (draggedMesh.userData._origY === undefined) {
        draggedMesh.userData._origY = draggedMesh.position.y;
      }
    }

    // 🔑 STEP 2: Actual dragging (X/Z only)
    raycaster.setFromCamera(mouse, camera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersectPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersectPoint);

    if (intersectPoint) {
      draggedMesh.position.x = intersectPoint.x - dragOffset.x;
      draggedMesh.position.z = intersectPoint.z - dragOffset.z;
      draggedMesh.position.y = draggedMesh.userData._origY; // keep original height
    }

    // 🔑 STEP 3: Zone highlight
    zones.forEach((z) => {
      if (isInsideZone(draggedMesh.position, z.mesh)) {
        z.mesh.material = z.highlightMat;
      } else {
        z.mesh.material = z.normalMat;
      }
    });

    return; // ⛔ prevent camera movement while dragging
  }

  /* ================================
     HOVER (NO MOUSE DOWN)
  ================================= */
  if (!cameraControls.isMouseDown) {
    handleHover(event);
    return;
  }

  /* ================================
     CAMERA CONTROLS
  ================================= */
  const deltaX = event.clientX - cameraControls.mouseX;
  const deltaY = event.clientY - cameraControls.mouseY;

  if (cameraControls.isPanning) {
    const distance = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    camera.position.x -= deltaX * 0.01 * distance * 0.01;
    camera.position.y += deltaY * 0.01 * distance * 0.01;
  } else {
    const spherical = new THREE.Spherical();
    spherical.setFromVector3(camera.position);
    spherical.theta -= deltaX * 0.01;
    spherical.phi += deltaY * 0.01;
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
    camera.position.setFromSpherical(spherical);
    camera.lookAt(0, 5, 0);
  }

  cameraControls.mouseX = event.clientX;
  cameraControls.mouseY = event.clientY;
}
function onMouseUp(event) {
  if (!dragging || !draggedMesh) {
    cameraControls.isMouseDown = false;
    cameraControls.isPanning = false;
    return;
  }

  let droppedZone = null;

  // 🔍 detect zone
  for (let i = 0; i < zones.length; i++) {
    if (isInsideZone(draggedMesh.position, zones[i].mesh)) {
      droppedZone = zones[i];
      break;
    }
  }

  if (droppedZone) {
    // ✅ snap X/Z to zone cell center
    draggedMesh.position.x = droppedZone.mesh.position.x;
    draggedMesh.position.z = droppedZone.mesh.position.z;

    const targetY = findStackBaseY(draggedMesh.position, draggedMesh);
    snapGroupToY(draggedMesh, targetY);

    // save zone info
    if (draggedMesh.userData && draggedMesh.userData.bin) {
      draggedMesh.userData.bin.zone = droppedZone.zone;
    }
  } else {
    // ❌ not dropped in zone → revert
    draggedMesh.position.copy(draggedMesh.userData._origPosition);
  }

  // 🔄 reset visuals
  zones.forEach((z) => (z.mesh.material = z.normalMat));

  // 🔁 reset drag state
  dragging = false;
  draggedMesh = null;
  dragStarted = false;

  cameraControls.isMouseDown = false;
  cameraControls.isPanning = false;
}

function findStackBaseY(position, currentMesh) {
  const ray = new THREE.Raycaster(new THREE.Vector3(position.x, 100, position.z), new THREE.Vector3(0, -1, 0));

  const candidates = [];

  warehouse.traverse((obj) => {
    if (obj !== currentMesh && obj.isGroup && obj.userData && obj.userData.bin && obj.userData.bin.zone) {
      candidates.push(obj);
    }
  });

  const hits = ray.intersectObjects(candidates, true);

  if (hits.length > 0) {
    const bbox = new THREE.Box3().setFromObject(hits[0].object);
    return bbox.max.y;
  }

  // Zone floor level
  return 0;
}

function snapGroupToY(group, targetY) {
  const bbox = new THREE.Box3().setFromObject(group);
  const bottomY = bbox.min.y;
  const delta = targetY - bottomY;
  group.position.y += delta;
}

function onWheel(e) {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 1.1 : 0.9;
  camera.position.multiplyScalar(factor);
  camera.position.y = Math.max(2, camera.position.y);
}
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function snapGroupToFloor(group, floorY = 0) {
  const bbox = new THREE.Box3().setFromObject(group);
  const bottomY = bbox.min.y;
  const delta = floorY - bottomY;
  group.position.y += delta;
}
function onTouchStart(e) {
  e.preventDefault();
  const t = e.touches[0];
  onMouseDown({ clientX: t.clientX, clientY: t.clientY, button: 0 });
}
function onTouchMove(e) {
  e.preventDefault();
  const t = e.touches[0];
  onMouseMove({ clientX: t.clientX, clientY: t.clientY });
}
function onTouchEnd(e) {
  e.preventDefault();
  onMouseUp();
}

function handleHover(event) {
  raycaster.setFromCamera(mouse, camera);
  if (!warehouse) return;
  const intersects = raycaster.intersectObjects(warehouse.children, true);
  let hitMesh = null;
  for (let i = 0; i < intersects.length; i++) {
    const obj = intersects[i].object;
    if (obj.userData && obj.userData.bin) {
      hitMesh = obj;
      break;
    }
    if (obj.parent && obj.parent.userData && obj.parent.userData.bin) {
      hitMesh = obj.parent;
      break;
    }
  }
  if (hitMesh) {
    if (hoveredMesh !== hitMesh) {
      clearHover();
      hoveredMesh = hitMesh;
      applyHoverEffect(hoveredMesh);
    }
    showHoverLabel(event.clientX, event.clientY, hoveredMesh.userData.bin.label || hoveredMesh.userData.bin.type || "Bin");
  } else {
    clearHover();
    hideHoverLabel();
  }
}

function applyHoverEffect(mesh) {
  if (!mesh.userData._orig) mesh.userData._orig = {};
  if (mesh.material && mesh.material.emissive !== undefined) {
    mesh.userData._origEmissive = mesh.material.emissive ? mesh.material.emissive.clone() : null;
    mesh.material.emissive = new THREE.Color(0x222222);
  } else {
    mesh.scale.multiplyScalar(1.02);
  }
}
function clearHover() {
  if (!hoveredMesh) return;
  if (hoveredMesh.material && hoveredMesh.userData._origEmissive !== undefined)
    hoveredMesh.material.emissive = hoveredMesh.userData._origEmissive || new THREE.Color(0x000000);
  else hoveredMesh.scale.set(1, 1, 1);
  hoveredMesh = null;
}
function showHoverLabel(x, y, text) {
  const l = document.getElementById("hoverLabel");
  l.style.display = "block";
  l.style.left = x + 12 + "px";
  l.style.top = y + 12 + "px";
  l.textContent = text;
}
function hideHoverLabel() {
  const l = document.getElementById("hoverLabel");
  l.style.display = "none";
}

function onClick(event) {
  if (dragging) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(warehouse.children, true);
  let hitMesh = null;
  for (let i = 0; i < intersects.length; i++) {
    const obj = intersects[i].object;
    if (obj.userData && obj.userData.bin) {
      hitMesh = obj;
      break;
    }
    if (obj.parent && obj.parent.userData && obj.parent.userData.bin) {
      hitMesh = obj.parent;
      break;
    }
  }
  if (hitMesh) selectMesh(hitMesh);
  else clearSelection();
}

function selectMesh(mesh) {
  clearSelection();
  selectedMesh = mesh;

  if (mesh.material && mesh.material.emissive !== undefined) {
    mesh.userData._origEmissive = mesh.material.emissive.clone();
    mesh.material.emissive = new THREE.Color(0x33ccff);
    mesh.material.emissiveIntensity = 0.7;
  }

  const d = mesh.userData.bin || {};
  const details = document.getElementById("binDetails");

  const products = Array.isArray(d.products) ? d.products : [];

  let productHTML = "";

  if (products.length === 0) {
    productHTML = `
      <div style="margin-top:8px;padding:8px;background:rgba(255,255,255,0.03);border-radius:6px;">
        No products in this bin.
      </div>
    `;
  } else {
    productHTML = `
      <div style="margin-top:8px;max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;">
        ${products
          .map(
            (p, index) => `
          <div style="display:flex;gap:10px;padding:8px;background:rgba(255,255,255,0.05);
                      border-radius:6px;border:1px solid #2f3a42;">
            <img src="${escapeHtml(p.image || "https://via.placeholder.com/56")}"
                 style="width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid #2f3a42;">
            <div style="flex:1;">
              <div style="font-weight:bold">${escapeHtml(p.name || "Unnamed")}</div>
              <div style="font-size:12px">SKU: ${escapeHtml(p.sku || "-")}</div>
              <div style="font-size:12px">Batch: ${escapeHtml(p.batch || "-")}</div>
              <div style="font-size:12px">Expiry: ${escapeHtml(p.expiry || "-")}</div>
              <div style="font-size:12px">Qty: ${escapeHtml(String(p.quantity || 0))}</div>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    `;
  }

  details.innerHTML = `
    <div style="font-weight:bold;font-size:14px;">
      ${escapeHtml(d.bin_code || "Bin")}
    </div>

    <div style="margin-top:6px;font-size:13px">
      Row: ${d.row ?? "-"} |
      Shelf: ${d.shelf ?? "-"} |
      Level: ${d.level ?? "-"}
    </div>

    <div style="margin-top:6px;font-size:13px">
      Qty: ${d.qty ?? 0} |
      Hits: ${d.hits ?? 0} |
      ABC: ${d.abc ?? "C"}
    </div>

    ${productHTML}
  `;
}

function clearSelection() {
  if (!selectedMesh) return;
  const mesh = selectedMesh;
  if (mesh.material && mesh.userData._origEmissive !== undefined) mesh.material.emissive = mesh.userData._origEmissive || new THREE.Color(0x000000);
  else mesh.scale.set(1, 1, 1);
  selectedMesh = null;
  document.getElementById("binDetails").textContent = "None selected";
}

// ---------------- product modal ----------------
let modalBinMesh = null;
function openProductModalForSelected(createIfEmpty = false) {
  if (!selectedMesh) return;
  modalBinMesh = selectedMesh;
  const bin = modalBinMesh.userData.bin || {};
  if (!bin.product && createIfEmpty) bin.product = { sku: "", name: "", batch: "", expiry: "", quantity: 0, image: "" };
  const p = bin.product || { sku: "", name: "", batch: "", expiry: "", quantity: 0, image: "" };
  document.getElementById("pm_name").value = p.name || "";
  document.getElementById("pm_sku").value = p.sku || "";
  document.getElementById("pm_batch").value = p.batch || "";
  document.getElementById("pm_expiry").value = p.expiry || "";
  document.getElementById("pm_qty").value = p.quantity != null ? p.quantity : "";
  document.getElementById("pm_image").value = p.image || "";
  document.getElementById("pm_preview").src = p.image || "https://via.placeholder.com/72";
  document.getElementById("productModal").style.display = "flex";
}

function closeProductModal() {
  document.getElementById("productModal").style.display = "none";
  modalBinMesh = null;
}

async function saveProductModal() {
  if (!modalBinMesh) {
    closeProductModal();
    return;
  }
  const p = modalBinMesh.userData.bin.product || {};
  p.name = document.getElementById("pm_name").value;
  p.sku = document.getElementById("pm_sku").value;
  p.batch = document.getElementById("pm_batch").value;
  p.expiry = document.getElementById("pm_expiry").value;
  p.quantity = parseInt(document.getElementById("pm_qty").value || "0");
  p.image = document.getElementById("pm_image").value;
  modalBinMesh.userData.bin.product = p;
  modalBinMesh.userData.bin.occupied = true;
  selectMesh(modalBinMesh);
  // optional: POST to API_SAVE
  closeProductModal();
}

// ---------------- zone helpers ----------------
function isInsideZone(point, zoneMesh) {
  const pos = zoneMesh.position;
  const w = (zoneMesh.geometry.parameters.width || 10) / 2;
  const d = (zoneMesh.geometry.parameters.height || 10) / 2;
  return point.x >= pos.x - w && point.x <= pos.x + w && point.z >= pos.z - d && point.z <= pos.z + d;
}

function snapToZoneGrid(position, zone, grid = GRID_SIZE) {
  const zMesh = zone.mesh;
  const zonePos = zMesh.position;
  const halfW = zone.width / 2,
    halfD = zone.depth / 2;
  let localX = position.x - zonePos.x,
    localZ = position.z - zonePos.z;
  localX = Math.max(-halfW, Math.min(halfW, localX));
  localZ = Math.max(-halfD, Math.min(halfD, localZ));
  const snappedX = Math.round(localX / grid) * grid;
  const snappedZ = Math.round(localZ / grid) * grid;
  return { x: zonePos.x + snappedX, z: zonePos.z + snappedZ };
}

async function updateBinZone(mesh, zoneId, snappedPosition) {
  if (!mesh || !mesh.userData || !mesh.userData.bin) return;
  const bin = mesh.userData.bin;
  bin.zone = zoneId;
  const label = bin.label || "unknown";
  try {
    await fetch(API_SAVE_POSITION, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, new_zone: zoneId, position: snappedPosition || { x: mesh.position.x, z: mesh.position.z } }),
    });
  } catch (err) {
    console.warn("Failed to update position on server", err);
  }
  selectMesh(mesh);
}

function showMoveConfirmDialog(binMeta, zone) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmModal");
    const text = document.getElementById("confirmText");
    const details = document.getElementById("confirmDetails");
    const yesBtn = document.getElementById("confirmYes");
    const noBtn = document.getElementById("confirmNo");
    text.textContent = `Move ${binMeta.label || "Bin"} to ${zone.label}?`;
    details.textContent = `Zone: ${zone.id} — Snap grid: ${GRID_SIZE}m`;
    function cleanup(res) {
      yesBtn.removeEventListener("click", onYes);
      noBtn.removeEventListener("click", onNo);
      modal.style.display = "none";
      resolve(res);
    }
    function onYes() {
      cleanup(true);
    }
    function onNo() {
      cleanup(false);
    }
    yesBtn.addEventListener("click", onYes);
    noBtn.addEventListener("click", onNo);
    modal.style.display = "flex";
  });
}

// ---------------- animation ----------------
function animate() {
  if (isAnimating) animationId = requestAnimationFrame(animate);
  if (!cameraControls.isMouseDown && !dragging) camera.lookAt(0, 5, 0);
  renderer.render(scene, camera);
}

// ---------------- util ----------------
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function getBinUnderCursor(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(warehouse.children, true);
  for (let i = 0; i < intersects.length; i++) {
    const obj = intersects[i].object;
    if (obj.userData && obj.userData.bin) return obj;
    if (obj.parent && obj.parent.userData && obj.parent.userData.bin) return obj.parent;
  }
  return null;
}

// ---------------- start ----------------
window.addEventListener("load", init);
