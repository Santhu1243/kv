// scene basics
let scene, camera, renderer, warehouse, animationId;
let isAnimating = true;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// interaction state
let cameraControls = { mouseX: 0, mouseY: 0, isMouseDown: false, isPanning: false };
let hoveredMesh = null,
  selectedMesh = null;
let dragging = false,
  draggedMesh = null,
  dragOffset = new THREE.Vector3();

// bins and zones
let flattenedBins = [];
let zones = [];

// endpoints (placeholders)
const API_GET = "/api/bins/";
const API_SAVE_POSITION = "/api/bins/update-position/";
const GRID_SIZE = 1.0; // 2m grid (your choice C)

function createBinGroup(binMeta) {
  const group = new THREE.Group();
  group.userData.bin = binMeta; // IMPORTANT: metadata on group
  group.userData.isBinGroup = true; // identification
  return group;
}

// ---------------- init ----------------
function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 50, 200);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(30, 25, 30);
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
function alignGroupToBottom(group) {
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // move children so that group origin is at bottom center
  group.children.forEach((child) => {
    child.position.y -= box.min.y;
  });

  // reset group Y
  group.position.y += box.min.y;
}

// ---------------- API loader ----------------
async function loadNestedBinsFromApi() {
  try {
    const res = await fetch(API_GET, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const payload = await res.json();
    if (!payload || !payload.rows) {
      console.warn("unexpected payload");
      return false;
    }
    flattenedBins = [];
    payload.rows.forEach((row) => {
      const rId = row.row_id || row.id || 0;
      if (!Array.isArray(row.shelves)) return;
      row.shelves.forEach((shelf) => {
        const sId = shelf.shelf_id || shelf.id || 0;
        if (!Array.isArray(shelf.levels)) return;
        shelf.levels.forEach((levelObj) => {
          const lvl = levelObj.level || levelObj.id || 0;
          const binData = levelObj.bin || levelObj;
          const product = binData.product || null;
          const label = binData.label || `R${rId}-S${sId}-L${lvl}`;
          flattenedBins.push({
            row_id: rId,
            shelf_id: sId,
            level: lvl,
            product: product,
            label: label,
            type: binData.type || "generic",
            qty: binData.qty || (product ? product.quantity || 1 : 0),
            occupied: !!product,
            width: binData.width || 1.2,
            depth: binData.depth || 1.2,
            height: binData.height || 0.7,
            zone: binData.zone || null,
          });
        });
      });
    });
    if (flattenedBins.length) {
      applyBinsDataAndRender(flattenedBins);
      return true;
    }
    return false;
  } catch (err) {
    console.warn("API error", err);
    return false;
  }
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

// ---------------- apply flattened bins ----------------
function applyBinsDataAndRender(bins) {
  if (warehouse) scene.remove(warehouse);
  warehouse = new THREE.Group();
  createFloor();

  const rackSpacing = 3,
    rowSpacing = 5;
  const shelvesMax = parseInt(document.getElementById("shelves").max);
  const rowsMax = parseInt(document.getElementById("rows").max);

  const groups = {};
  bins.forEach((bin) => {
    const key = `r${bin.row_id}_s${bin.shelf_id}`;
    if (!groups[key]) groups[key] = { row: bin.row_id, shelf: bin.shelf_id, bins: [] };
    groups[key].bins.push(bin);
  });

  Object.keys(groups).forEach((key) => {
    const entry = groups[key];
    const r = entry.row,
      s = entry.shelf;
    const x = (s - shelvesMax / 2) * rackSpacing;
    const z = (r - rowsMax / 2) * rowSpacing;

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

// ---------------- bin visual ----------------
function createBinVisual(rackX, rackZ, bin) {
  const w = bin.width || 1.0,
    h = bin.height || 0.6,
    d = bin.depth || 1.0;
  const occupied = !!bin.occupied;
  const color = bin.product ? 0x6fa8ff : occupied ? 0xffb86b : 0x999999;
  const mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: occupied ? 0.95 : 0.6 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // choose X offset to visually separate bays
  const offsetX = (bin.shelf_id || 1) % 2 === 0 ? -0.45 : 0.45;
  mesh.position.x = rackX + offsetX;
  mesh.position.z = rackZ + (Math.random() - 0.5) * 0.12;

  // place using unified helper
  placeBinOnShelf(mesh, bin.level || 0, h);

  mesh.userData.bin = {
    row_id: bin.row_id,
    shelf_id: bin.shelf_id,
    level: bin.level,
    type: bin.type,
    qty: bin.qty,
    occupied: bin.occupied,
    label: bin.label,
    product: bin.product || null,
    zone: bin.zone || null,
  };

  // pick mesh
  const pickGeom = new THREE.BoxGeometry(w * 1.1, h * 1.2, d * 1.1);
  const pickMat = new THREE.MeshBasicMaterial({ visible: false });
  const pickMesh = new THREE.Mesh(pickGeom, pickMat);
  pickMesh.position.copy(mesh.position);
  pickMesh.userData = mesh.userData;
  warehouse.add(pickMesh);

  warehouse.add(mesh);
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
  const rackMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
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

function addPallets(rackX, rackZ, rackWidth, rackDepth, shelfHeight, rowIndex, shelfIndex) {
  const palletWidth = 1.2,
    palletLength = 1.2,
    palletHeight = 0.2;

  for (let level = 0; level <= shelfHeight; level++) {
    const palletsPerLevel = 2;

    for (let i = 0; i < palletsPerLevel; i++) {
      const offsetX = (i - palletsPerLevel / 2 + 0.5) * 1.5;
      const shelfY = shelfYForLevel(level);
      const palletY = shelfY + palletHeight / 2;

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

      // ✅ CREATE GROUP
      const binGroup = createBinGroup(binMeta);
      binGroup.position.set(rackX + offsetX, palletY, rackZ);

      // pallet
      const pallet = createPallet(palletWidth, palletLength, palletHeight);
      pallet.userData.bin = binMeta;
      binGroup.add(pallet);

      // goods
      addGoodsOnPalletGrouped(binGroup, palletHeight / 2, palletWidth, palletLength, binMeta);

      // AFTER adding pallet + goods
      alignGroupToBottom(binGroup);

      // set final position (ground / shelf correct now)
      binGroup.position.set(rackX + offsetX, shelfYForLevel(level), rackZ);

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
  const containerTypes = [
    { color: 0x3f51b5, name: "Electronics" },
    { color: 0xf44336, name: "Fragile" },
    { color: 0xffc107, name: "General" },
    { color: 0x4caf50, name: "Perishables" },
  ];
  for (let level = 1; level <= shelfHeight; level++) {
    const containersPerLevel = Math.floor(Math.random() * 3) + 2;
    for (let i = 0; i < containersPerLevel; i++) {
      const containerType = containerTypes[Math.floor(Math.random() * containerTypes.length)];
      const cw = 0.8 + Math.random() * 0.4;
      const ch = 0.6 + Math.random() * 0.3;
      const cd = 0.6 + Math.random() * 0.3;
      const container = new THREE.Mesh(
        new THREE.BoxGeometry(cw, ch, cd),
        new THREE.MeshLambertMaterial({ color: containerType.color, transparent: true, opacity: 0.9 })
      );
      // ensure bottom sits on shelf: shelfY + ch/2
      const shelfY = shelfYForLevel(level);
      container.position.set(rackX + (Math.random() - 0.5) * (rackWidth - 1), shelfY + ch / 2, rackZ + (Math.random() - 0.5) * (rackDepth - 0.5));
      container.castShadow = true;
      container.receiveShadow = true;
      container.userData.bin = {
        row_id: rowIndex + 1,
        shelf_id: shelfIndex + 1,
        level: level,
        type: containerType.name,
        qty: 1,
        occupied: Math.random() > 0.3,
        label: `R${rowIndex + 1}-S${shelfIndex + 1}-L${level}`,
        product: null,
        zone: null,
      };
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

  const hit = getBinUnderCursor(event);
  if (hit) {
    dragging = true;
    draggedMesh = hit.userData.isBinGroup ? hit : hit.parent;
    draggedMesh.userData._origPosition = draggedMesh.position.clone();
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersectPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersectPoint);
    if (intersectPoint) {
      dragOffset.copy(draggedMesh.position).sub(intersectPoint);
    } else {
      dragOffset.set(0, 0, 0);
    }
    draggedMesh.userData._origY = draggedMesh.position.y;
    draggedMesh.position.y = Math.max(draggedMesh.position.y, 1.2);
    cameraControls.isMouseDown = false;
    cameraControls.isPanning = false;
  }
}
function getRootBinGroup(mesh) {
  while (mesh && mesh.parent) {
    if (mesh.userData && mesh.userData.isBinGroup) return mesh;
    mesh = mesh.parent;
  }
  return null;
}

function onMouseMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  if (dragging && draggedMesh) {
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersectPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersectPoint);
    if (intersectPoint) {
      draggedMesh.position.x = intersectPoint.x + dragOffset.x;
      draggedMesh.position.y = Math.max(0, draggedMesh.userData._origY ?? draggedMesh.position.y);
      draggedMesh.position.z = intersectPoint.z + dragOffset.z;
    }

    zones.forEach((z) => {
      if (isInsideZone(draggedMesh.position, z.mesh)) z.mesh.material = z.highlightMat;
      else z.mesh.material = z.normalMat;
    });

    return;
  }

  if (!cameraControls.isMouseDown) {
    handleHover(event);
    return;
  }

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

async function onMouseUp(event) {
  if (dragging && draggedMesh) {
    let droppedInZone = null;
    for (let i = 0; i < zones.length; i++) {
      if (isInsideZone(draggedMesh.position, zones[i].mesh)) {
        droppedInZone = zones[i];
        break;
      }
    }

    if (droppedInZone) {
      const snapped = snapToZoneGrid(draggedMesh.position, droppedInZone, GRID_SIZE);
      const originalPos = draggedMesh.userData._origPosition ? draggedMesh.userData._origPosition.clone() : draggedMesh.position.clone();

      const confirmResult = await showMoveConfirmDialog(draggedMesh.userData.bin, droppedInZone);

      if (confirmResult) {
        draggedMesh.position.x = snapped.x;
        draggedMesh.position.z = snapped.z;

        // ---- STACKING LOGIC ----
        const bbox = new THREE.Box3().setFromObject(draggedMesh);
        const height = bbox.max.y - bbox.min.y;

        // find top-most object under this (bin or pallet or container)
        const baseY = findStackBaseY(snapped, draggedMesh);

        // place this bin exactly on top of ground or previous bin
        draggedMesh.position.y = baseY;

        // store zone + specific space ID
        draggedMesh.userData.bin.zone = droppedInZone.zone;
        draggedMesh.userData.bin.space = droppedInZone.id;

        await updateBinZone(draggedMesh, droppedInZone.id, snapped);
      } else {
        draggedMesh.position.copy(originalPos);
      }
    } else {
      // -----------------------------
      // NOT in a zone → restore shelf
      // -----------------------------
      const bbox = new THREE.Box3().setFromObject(draggedMesh);
      const height = bbox.max.y - bbox.min.y;

      draggedMesh.position.y = shelfYForLevel(draggedMesh.userData.bin.level || 0) + height / 2;
    }

    zones.forEach((z) => (z.mesh.material = z.normalMat));
    dragging = false;
    draggedMesh = null;
  }
  cameraControls.isMouseDown = false;
  cameraControls.isPanning = false;
}
function findStackBaseY(position, currentMesh) {
  const ray = new THREE.Raycaster(new THREE.Vector3(position.x, 50, position.z), new THREE.Vector3(0, -1, 0));

  const intersects = ray.intersectObjects(warehouse.children, true);

  for (let i = 0; i < intersects.length; i++) {
    const obj = intersects[i].object;

    if (obj === currentMesh) continue;
    if (!obj.userData || !obj.userData.bin) continue;

    const bbox = new THREE.Box3().setFromObject(obj);
    return bbox.max.y; // top of the object below
  }

  return 0; // ground level
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
