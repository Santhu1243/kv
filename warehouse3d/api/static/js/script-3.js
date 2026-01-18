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
  if (abc === "A") return new THREE.Color("#e74c3c"); // 🔴 A
  if (abc === "B") return new THREE.Color("#2ecc71"); // 🟢 B
  if (abc === "D") return new THREE.Color("#f1c40f"); // 🟡 D (yellow)
  return new THREE.Color("#1e3cff"); // 🔵 C
}

let shelfHeight = 3; // number of shelves
function createShelf() {
  console.log(shelfHeight); // now it’s defined
}
function shelfYForLevel(level) {
  return level * 2; // shelf surface
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
function ensureWarehouse() {
  if (!scene) throw new Error("Scene not initialized");
  if (!warehouse) {
    warehouse = new THREE.Group();
    scene.add(warehouse);
  }
}

function assignABDBottomLeftRight(bin, bottomLevels, shelfIndex, totalShelves) {
  if (bin.level < bottomLevels) {
    const third = Math.floor(totalShelves / 3);

    if (shelfIndex < third) {
      // LEFT 1/3 → A
      bin.abc = "A"; // 🔴
      bin.hits = 900;
      bin.qty = 80;
    } else if (shelfIndex < third * 2) {
      // MIDDLE 1/3 → D
      bin.abc = "D"; // 🟡
      bin.hits = 550;
      bin.qty = 60;
    } else {
      // RIGHT 1/3 → B
      bin.abc = "B"; // 🟢
      bin.hits = 350;
      bin.qty = 40;
    }
  } else {
    // Upper levels (keep as C or whatever you already use)
    bin.abc = "C"; // 🔵
    bin.hits = 50;
    bin.qty = 10;
  }
}

function abcOrder(abc) {
  if (abc === "A") return 0;
  if (abc === "B") return 1;
  if (abc === "D") return 2;
  return 3;
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
function assignABCForBottomGroup(bin, bottomLevels = 1) {
  if (bin.level <= bottomLevels) {
    // Bottom group → A, B, C mixed
    const r = Math.random();
    if (r < 0.15) {
      bin.abc = "A";
      bin.hits = 900;
      bin.qty = 80;
    } else if (r < 0.45) {
      bin.abc = "B";
      bin.hits = 350;
      bin.qty = 40;
    } else {
      bin.abc = "C";
      bin.hits = 60;
      bin.qty = 10;
    }
  } else {
    // Upper levels → all C
    bin.abc = "C";
    bin.hits = 50;
    bin.qty = 10;
  }
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
  { t: 0.3, color: new THREE.Color("#00722f") }, // valid
  { t: 0.6, color: new THREE.Color("#f1c40f") }, // yellow
  { t: 0.8, color: new THREE.Color("#e67e22") }, // orange
  { t: 1.0, color: new THREE.Color("#e74c3c") }, // red (hot)
];

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
  const geometry = new THREE.BoxGeometry(1, shelfHeight, 1); // width, height, depth
  const material = new THREE.MeshStandardMaterial({ color: abcDirectColor(binMeta.abc) });
  const mesh = new THREE.Mesh(geometry, material);

  // Position the mesh in 3D space
  mesh.position.set(
    binMeta.shelf_id, // x
    binMeta.level * shelfHeight + shelfHeight / 2, // y
    binMeta.row_id // z
  );

  return mesh;
}

// ---------------- init ----------------

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 50, 200);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(8, 6, 12);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById("container").appendChild(renderer.domElement);

  setupLighting();
  setupUI();
  setupControls();

  // load API (fallback to generate)
  loadNestedBinsFromApi()
    .then((ok) => {
      if (!ok) generateWarehouse();
      createZones();
      animate();
      document.getElementById("loading").style.display = "none";
    })
    .catch((err) => {
      console.warn("API load failed", err);
      generateWarehouse();
      createZones();
      animate();
      document.getElementById("loading").style.display = "none";
    });
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
window.addEventListener("DOMContentLoaded", () => {
  const palletToggle = document.getElementById("palletRacking");
  if (palletToggle) palletToggle.checked = true;
});

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
  // 1. Clear previous warehouse
  if (warehouse) scene.remove(warehouse);
  warehouse = new THREE.Group();

  // ✅ READ UI CHECKBOX FIRST
  const usePalletRacking = document.getElementById("palletRacking")?.checked ?? payload.config?.rack_type === "pallet";

  createFloor();

  // 2. Draw the Rack Structure (Visual Only)
  // We use the 'config' from the DB to draw the metal frames so they match the bins
  if (payload.config) {
    createStorageRacks(payload.config.rows, payload.config.racks_per_row, payload.config.max_levels, payload.config.rack_type === "pallet");
  }

  // 3. Update Statistics for Heatmap Colors
  Object.assign(stats, calculateHeatStats(payload.bins));

  // 4. Loop through every single bin from the DB
  payload.bins.forEach((bin) => {
    // --- GEOMETRY ---
    // Use the exact dimensions from the database
    const geometry = new THREE.BoxGeometry(bin.width, bin.height, bin.depth);

    // --- MATERIAL ---
    const material = new THREE.MeshLambertMaterial({
      color: 0x999999, // Default grey
      transparent: true,
      opacity: bin.occupied ? 0.9 : 0.4, // Ghostly if empty, solid if full
    });

    const mesh = new THREE.Mesh(geometry, material);

    // --- POSITIONING ---
    // IMPORTANT: Three.js draws boxes from the CENTER.
    // If your DB coordinates represent the "Floor/Shelf level" of the bin:
    // We must add half the height to Y to make it sit ON the shelf, not cut through it.
    mesh.position.set(bin.x, bin.y + bin.height / 2, bin.z);

    // --- METADATA (For Raycaster/Clicking) ---
    mesh.userData.bin = bin;
    mesh.userData._baseColor = material.color.clone();

    // --- COLORING (Heatmap/ABC) ---
    if (overlayMode === "ABC") {
      const c = abcDirectColor(bin.abc);
      material.color.copy(c);
      material.emissive.copy(c);
      material.emissiveIntensity = 0.5;
    } else if (overlayMode === "HEAT") {
      const heat = computeHeat(bin, stats);
      const c = heatToColor(heat);
      material.color.copy(c);
    }

    warehouse.add(mesh);
  });

  // 5. Add Ceiling/Lights and finish
  createCeiling();
  scene.add(warehouse);
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
  mesh.position.z = rackZ;

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
const abcCounters = { A: 0, B: 0, C: 0 };

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
function groupBinsByABC(bins) {
  return {
    A: bins.filter((b) => b.abc === "A"),
    B: bins.filter((b) => b.abc === "B"),
    C: bins.filter((b) => b.abc === "C"),
  };
}
const ABC_ZONES = {
  A: { startZ: -15 },
  B: { startZ: -5 },
  C: { startZ: 5 },
};
function placeBinsByABC(bins) {
  const grouped = groupBinsByABC(bins);

  let index = { A: 0, B: 0, C: 0 };
  const rowGap = 2;
  const rackGap = 2;

  ["A", "B", "C"].forEach((abc) => {
    grouped[abc].forEach((bin) => {
      const i = index[abc]++;

      const row = Math.floor(i / 10);
      const col = i % 10;

      bin.mesh.position.set(col * rackGap, bin.level * 1.5, ABC_ZONES[abc].startZ + row * rowGap);
    });
  });
}

function createPalletRack(width, depth, height) {
  const rack = new THREE.Group();
  const uprightMat = new THREE.MeshLambertMaterial({ color: 0x2c5530 });
  const beamMat = new THREE.MeshLambertMaterial({ color: 0xff6600 });
  const framePositions = [
    [-width / 2, 0, 0],
    [width / 2, 0, 0],
  ];
  framePositions.forEach((pos) => {
    for (let side = 0; side < 2; side++) {
      const zOffset = side === 0 ? -depth / 2 : depth / 2;
      const uprightGeom = new THREE.BoxGeometry(0.15, height * 2, 0.1);
      const upright = new THREE.Mesh(uprightGeom, uprightMat);
      upright.position.set(pos[0], height, pos[2] + zOffset);
      upright.castShadow = true;
      rack.add(upright);
    }
  });
  const beamGeom = new THREE.BoxGeometry(width, 0.12, 0.08);
  for (let level = 1; level <= height; level++) {
    const front = new THREE.Mesh(beamGeom, beamMat);
    front.position.set(0, level * 2, -depth / 2);
    front.castShadow = true;
    rack.add(front);
    const back = new THREE.Mesh(beamGeom, beamMat);
    back.position.set(0, level * 2, depth / 2);
    back.castShadow = true;
    rack.add(back);
    const deckingGeom = new THREE.PlaneGeometry(width * 0.9, depth * 0.9);
    const deckingMat = new THREE.MeshLambertMaterial({ color: 0x888888, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    const decking = new THREE.Mesh(deckingGeom, deckingMat);
    decking.rotation.x = -Math.PI / 2;
    decking.position.set(0, level * 2 + 0.1, 0);
    decking.receiveShadow = true;
    rack.add(decking);
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
function abcRank(abc) {
  if (abc === "A") return 0;
  if (abc === "B") return 1;
  return 2; // C
}

function assignABCByRowAndLevel(bin, config = {}) {
  const FIRST_ROW = 1;
  const LAST_ROW = config.totalRows; // pass this in
  const A_LEVEL = 3;

  // 🔴 RULE 1: First row, level 3 → A
  if (bin.row_id === FIRST_ROW && bin.level === A_LEVEL) {
    bin.abc = "B";
    bin.hits = 900;
    bin.qty = 80;
    return;
  }

  // 🔵 RULE 2: Last row → C
  if (bin.row_id === LAST_ROW) {
    bin.abc = "A";
    bin.hits = 50;
    bin.qty = 10;
    return;
  }

  // 🟢 RULE 3: Remaining bins → B
  bin.abc = "C";
  bin.hits = 300;
  bin.qty = 40;
}
function assignABCByRack(bin, config = {}) {
  const FIRST_RACK = 1;
  const A_LEVEL = 3;

  // 🔴 First rack logic
  if (bin.rack_id === FIRST_RACK) {
    if (bin.level === A_LEVEL) {
      bin.abc = "A";
      bin.hits = 900;
      bin.qty = 80;
    } else {
      bin.abc = "B";
      bin.hits = 300;
      bin.qty = 40;
    }
    return;
  }

  // 🔵 All other racks
  bin.abc = "C";
  bin.hits = 50;
  bin.qty = 10;
}

function applyBinsDataAndRender(bins) {
  if (warehouse) scene.remove(warehouse);
  warehouse = new THREE.Group();
  createFloor();

  Object.assign(stats, calculateHeatStats(bins));

  const rackSpacing = 3;
  const rowSpacing = 5;
  const shelvesMax = parseInt(document.getElementById("shelves").value);

  // 🔑 ABC counters (GLOBAL positioning)
  const abcCounters = { A: 0, B: 0, C: 0 };

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
    const z = (entry.row - 1) * rowSpacing; // 👈 NORMAL GRID

    const rackHeight = Math.max(...entry.bins.map((b) => b.level || 1), 1);
    const rack = createBasicRack(4, 2, rackHeight);
    rack.position.set(x, 0, z);
    warehouse.add(rack);

    entry.bins.forEach((bin) => {
      const abc = bin.abc || "C";
      const index = abcCounters[abc]++;
      const abcZ = zBandByABC(abc, index);

      createBinVisual(x, abcZ, bin);
    });
  });

  createCeiling();
  scene.add(warehouse);
  createZones();
}
function assignABCByLevel(bin, maxHotLevel = 2) {
  // maxHotLevel = number of bottom levels to have mixed ABC
  if (bin.level <= maxHotLevel) {
    // bottom levels → assign realistic A/B/C randomly or by your rules
    const r = Math.random();
    if (r < 0.15) {
      bin.abc = "A";
      bin.hits = 900;
      bin.qty = 80;
    } else if (r < 0.45) {
      bin.abc = "B";
      bin.hits = 350;
      bin.qty = 40;
    } else {
      bin.abc = "C";
      bin.hits = 60;
      bin.qty = 10;
    }
  } else {
    // upper levels → all C (cold)
    bin.abc = "C";
    bin.hits = 50;
    bin.qty = 10;
  }
}

function sortBinsByABC(bins) {
  return bins.sort((a, b) => {
    const rank = { A: 0, B: 1, C: 2 };
    return (rank[a.abc] ?? 3) - (rank[b.abc] ?? 3);
  });
}
function organizeByABC() {
  applyBinsDataAndRender(flattenedBins);
}

function organizeByABC() {
  applyBinsDataAndRender(flattenedBins);
}

function zBandByABC(abc, index) {
  const BASE_Z = -20; // A closest
  const GAP = 12; // distance between A/B/C
  const ROW_GAP = 2.5; // spacing inside band

  if (abc === "A") return BASE_Z + index * ROW_GAP;
  if (abc === "B") return BASE_Z + GAP + index * ROW_GAP;
  return BASE_Z + GAP * 2 + index * ROW_GAP;
}

function rowByABC(abc, index, totalRows) {
  const band = Math.floor(totalRows / 3);

  if (abc === "A") return index % band; // front rows
  if (abc === "B") return band + (index % band); // middle rows
  return band * 2 + (index % band); // far rows
}

function addPallets(rackX, rackZ, rackWidth, rackDepth, shelfHeight, rowIndex, shelfIndex) {
  const palletWidth = 1.2;
  const palletLength = 1.2;
  const palletHeight = 0.2;
  const BIN_TOTAL_HEIGHT = 1.6;

  const totalShelves = parseInt(document.getElementById("shelves").value);

  for (let level = 0; level <= shelfHeight; level++) {
    const palletsPerLevel = 2;

    for (let i = 0; i < palletsPerLevel; i++) {
      const offsetX = (i - palletsPerLevel / 2 + 0.5) * 1.5;
      const shelfY = shelfYForLevel(level);
      const palletY = shelfY + palletHeight / 2;

      /* =========================
         BIN META
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

      /* =========================
         ✅ ASSIGN ABC FIRST (ONCE)
      ========================= */
      assignABDBottomLeftRight(
        binMeta,
        2, // bottomLevels → level 0 only
        shelfIndex,
        totalShelves
      );

      /* =========================
         BIN GROUP
      ========================= */
      const binGroup = createBinGroup(binMeta);
      binGroup.position.set(rackX + offsetX, palletY, rackZ);
      binGroup.userData._baseColor = new THREE.Color(0x999999);

      /* =========================
         BIN VOLUME (HEAT / ABC)
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

      // ✅ COLOR AFTER ABC
      if (overlayMode === "ABC") {
        const color = abcDirectColor(binMeta.abc);
        binMat.color.copy(color);
        binMat.emissive.copy(color);
        binMat.emissiveIntensity = 0.6;
      }

      binGroup.add(binVolume);

      /* =========================
         PALLET (VISUAL)
      ========================= */
      const pallet = createPallet(palletWidth, palletLength, palletHeight);
      pallet.userData.bin = binMeta;
      binGroup.add(pallet);

      /* =========================
         GOODS (VISUAL)
      ========================= */
      addGoodsOnPalletGrouped(binGroup, palletHeight / 2, palletWidth, palletLength, binMeta);

      warehouse.add(binGroup);
    }
  }
}

function assignABCForBottomTwoRows(bin, bottomRows = 2) {
  if (bin.level < bottomRows) {
    // Bottom 2 rows → only A or B
    const r = Math.random();
    if (r < 0.3) {
      bin.abc = "A";
      bin.hits = 900;
      bin.qty = 80;
    } else {
      bin.abc = "B";
      bin.hits = 350;
      bin.qty = 40;
    }
  } else {
    // Upper racks → all C
    bin.abc = "C";
    bin.hits = 50;
    bin.qty = 10;
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
  const totalShelves = parseInt(document.getElementById("shelves").value);

  assignABDBottomLeftRight(
    binMeta,
    1, // bottomLevels
    shelfIndex,
    totalShelves
  );

  for (let level = 0; level <= shelfHeight; level++) {
    const binMeta = {
      row_id: rowIndex + 1,
      shelf_id: shelfIndex + 1,
      level,
      type: "container",
      qty: 1,
      occupied: true,
      label: `R${rowIndex + 1}-S${shelfIndex + 1}-L${level}`,
      product: null,
      zone: null,
    };

    // ✅ LEFT = A, RIGHT = B, UPPER = C
    assignABDBottomLeftRight(
      binMeta,
      1, // bottomLevels (level 0 only)
      shelfIndex,
      totalShelves
    );

    const cw = 0.9;
    const ch = 0.7;
    const cd = 0.8;

    const mat = new THREE.MeshLambertMaterial({
      color: 0x999999,
      transparent: true,
      opacity: 0.9,
    });

    const container = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, cd), mat);

    // metadata for overlays / interaction
    container.userData.bin = binMeta;
    container.userData._baseColor = mat.color.clone();

    const shelfY = shelfYForLevel(level);
    container.position.set(rackX, shelfY + ch / 2, rackZ);

    container.castShadow = true;
    container.receiveShadow = true;

    // 🔥 ABC overlay
    if (overlayMode === "ABC") {
      const color = abcDirectColor(binMeta.abc);
      mat.color.copy(color);
      mat.emissive.copy(color);
      mat.emissiveIntensity = 0.6;
    }

    warehouse.add(container);
  }
}

function assignABCForBottomRack(bin, bottomLevels = 2) {
  if (bin.level <= bottomLevels) {
    // Bottom racks → mix A, B, C
    const r = Math.random();
    if (r < 0.15) {
      bin.abc = "A";
      bin.hits = 900;
      bin.qty = 80;
    } else if (r < 0.45) {
      bin.abc = "B";
      bin.hits = 350;
      bin.qty = 40;
    } else {
      bin.abc = "C";
      bin.hits = 60;
      bin.qty = 10;
    }
  } else {
    // Upper racks → all C
    bin.abc = "C";
    bin.hits = 50;
    bin.qty = 10;
  }
}

function assignABCByRowRackLevel(bin) {
  const FIRST_ROW = 1;
  const FIRST_RACKS = [1, 2];
  const BOTTOM_LEVELS = [1, 2];

  // Default → C
  bin.abc = "C";
  bin.hits = 40;
  bin.qty = 10;

  // 🎯 Only first row + first 2 racks + bottom 2 levels
  if (bin.row_id === FIRST_ROW && FIRST_RACKS.includes(bin.rack_id) && BOTTOM_LEVELS.includes(bin.level)) {
    if (bin.level === 1) {
      bin.abc = "A";
      bin.hits = 900;
      bin.qty = 80;
    } else if (bin.level === 2) {
      bin.abc = "B";
      bin.hits = 300;
      bin.qty = 40;
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
    mesh.userData._origEmissive = mesh.material.emissive ? mesh.material.emissive.clone() : null;
    mesh.material.emissive = new THREE.Color(0x33ccff);
    mesh.material.emissiveIntensity = 0.7;
  } else {
    mesh.scale.multiplyScalar(1.05);
  }

  const d = mesh.userData.bin || {};
  const details = document.getElementById("binDetails");

  const p = d.product || null;
  let productHTML = "";
  if (p) {
    productHTML = `<div style="display:flex;gap:10px;align-items:flex-start;margin-top:8px;">
          <img src="${escapeHtml(
            p.image || "https://via.placeholder.com/72"
          )}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid #2f3a42;">
          <div style="flex:1;"><div style="font-weight:bold">${escapeHtml(p.name || "Unnamed")}</div>
          <div style="font-size:12px">SKU: ${escapeHtml(p.sku || "-")}</div>
          <div style="font-size:12px">SKU: ${escapeHtml(p.HU || "-")}</div>
          <div style="font-size:12px">Batch: ${escapeHtml(p.batch || "-")}</div>
          <div style="font-size:12px">Expiry: ${escapeHtml(p.expiry || "-")}</div>
          <div style="font-size:12px">Qty: ${escapeHtml(String(p.quantity || "-"))}</div>
          <div style="margin-top:8px"><button id="btnEditProduct">Edit Product</button></div></div></div>`;
  } else {
    productHTML = `<div style="margin-top:8px;padding:8px;background:rgba(255,255,255,0.02);border-radius:6px;">No product in this bin.<div style="margin-top:8px"><button id="btnAddProduct">Add Product</button></div></div>`;
  }

  details.innerHTML = `<div style="font-weight:bold;font-size:14px;">${escapeHtml(d.label || "Bin")}</div>
        <div style="margin-top:6px;font-size:13px">Row: ${escapeHtml(String(d.row_id || "-"))} &nbsp; Shelf: ${escapeHtml(
    String(d.shelf_id || "-")
  )} &nbsp; Level: ${escapeHtml(String(d.level || "-"))}</div>
        <div style="margin-top:6px;font-size:13px">Type: ${escapeHtml(d.type || "-")} &nbsp; Qty slots: ${escapeHtml(
    String(d.qty || "-")
  )} &nbsp; Occupied: ${d.occupied ? "Yes" : "No"}</div>
        ${productHTML}`;

  setTimeout(() => {
    const editBtn = document.getElementById("btnEditProduct");
    if (editBtn) editBtn.addEventListener("click", () => openProductModalForSelected(false));
    const addBtn = document.getElementById("btnAddProduct");
    if (addBtn) addBtn.addEventListener("click", () => openProductModalForSelected(true));
  }, 0);
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
