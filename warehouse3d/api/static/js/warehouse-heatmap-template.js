/* =========================================================
   3D WAREHOUSE – RACKS + BINS + ABC HEAT MAP
   ========================================================= */

/* ---------------- GLOBALS ---------------- */
let scene, camera, renderer, warehouse;

/* ---------------- CONFIG ---------------- */
const ABC_COLORS = {
  A: 0xff0000, // Red
  B: 0xffeb3b, // Yellow
  C: 0x4caf50, // Green
  DD: 0x9e9e9e, // Grey
};

const RACK = {
  width: 4.0,
  depth: 1.2,
  levelHeight: 1.6,
  uprightWidth: 0.12,
  beamHeight: 0.12,
};

let HEATMAP_ENABLED = true;
let CURRENT_ABC_UOM = "EA";

/* =========================================================
   ABC + HEAT MAP LOGIC
   ========================================================= */
function ensureABC(product = {}) {
  if (!product.metrics) {
    product.metrics = {
      annual_picks: Math.floor(Math.random() * 1000),
    };
  }
  product.abc = calculateABC(product.metrics);
  return product;
}

function calculateABC(metrics) {
  const p = metrics.annual_picks;
  if (p >= 800) return { EA: "A" };
  if (p >= 400) return { EA: "B" };
  if (p > 0) return { EA: "C" };
  return { EA: "DD" };
}

function getHeatIntensity(bin) {
  const picks = bin.product.metrics.annual_picks;
  if (picks >= 800) return 1.0;
  if (picks >= 400) return 0.75;
  if (picks >= 100) return 0.5;
  return 0.25;
}

function applyABCColor(mesh) {
  if (!mesh.userData.bin) return;

  const bin = mesh.userData.bin;
  const cls = bin.product.abc[CURRENT_ABC_UOM] || "DD";
  const intensity = getHeatIntensity(bin);
  const color = ABC_COLORS[cls];

  mesh.material.color.setHex(color);
  mesh.material.opacity = 0.35 + intensity * 0.65;

  if (cls === "A") {
    mesh.material.emissive.setHex(color);
    mesh.material.emissiveIntensity = intensity * 0.6;
  } else {
    mesh.material.emissive.setHex(0x000000);
  }
}

/* =========================================================
   RACK FRAME
   ========================================================= */
function createRackFrame(levels) {
  const rack = new THREE.Group();

  const uprightMat = new THREE.MeshLambertMaterial({ color: 0x1e3d2f });
  const beamMat = new THREE.MeshLambertMaterial({ color: 0xff6f00 });

  const uprightGeom = new THREE.BoxGeometry(RACK.uprightWidth, levels * RACK.levelHeight + 0.3, RACK.uprightWidth);

  const positions = [
    [-RACK.width / 2, -RACK.depth / 2],
    [RACK.width / 2, -RACK.depth / 2],
    [-RACK.width / 2, RACK.depth / 2],
    [RACK.width / 2, RACK.depth / 2],
  ];

  positions.forEach(([x, z]) => {
    const u = new THREE.Mesh(uprightGeom, uprightMat);
    u.position.set(x, (levels * RACK.levelHeight) / 2, z);
    u.castShadow = true;
    rack.add(u);
  });

  const beamGeom = new THREE.BoxGeometry(RACK.width, RACK.beamHeight, 0.08);

  for (let l = 0; l < levels; l++) {
    const y = (l + 1) * RACK.levelHeight;
    const front = new THREE.Mesh(beamGeom, beamMat);
    front.position.set(0, y, -RACK.depth / 2);
    rack.add(front);

    const back = front.clone();
    back.position.z = RACK.depth / 2;
    rack.add(back);
  }

  return rack;
}

/* =========================================================
   BIN
   ========================================================= */
function createBin(width, height, depth, binMeta) {
  const mat = new THREE.MeshLambertMaterial({
    transparent: true,
  });

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.bin = binMeta;

  applyABCColor(mesh);
  return mesh;
}

/* =========================================================
   RACK + BINS ASSEMBLY
   ========================================================= */
function createRackWithBins(rowIndex, levels, binsPerLevel) {
  const group = new THREE.Group();

  group.add(createRackFrame(levels));

  const binWidth = (RACK.width / binsPerLevel) * 0.9;
  const binHeight = 1.2;
  const binDepth = RACK.depth * 0.85;

  for (let l = 0; l < levels; l++) {
    for (let i = 0; i < binsPerLevel; i++) {
      const product = ensureABC({});
      const bin = createBin(binWidth, binHeight, binDepth, {
        row: rowIndex,
        level: l + 1,
        product,
      });

      const x = -RACK.width / 2 + binWidth / 2 + i * (RACK.width / binsPerLevel);

      const y = l * RACK.levelHeight + binHeight / 2 + 0.05;

      bin.position.set(x, y, 0);
      group.add(bin);
    }
  }

  return group;
}

/* =========================================================
   WAREHOUSE LAYOUT
   ========================================================= */
function createWarehouse() {
  warehouse = new THREE.Group();

  const rows = 7;
  const rowSpacing = 3.5;

  for (let r = 0; r < rows; r++) {
    const rackRow = createRackWithBins(r + 1, 4, 4);
    rackRow.position.set(0, 0, r * rowSpacing);
    warehouse.add(rackRow);
  }

  scene.add(warehouse);
}

/* =========================================================
   INIT + SCENE
   ========================================================= */
function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfd1e5);

  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(18, 18, 22);
  camera.lookAt(0, 6, 8);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0x404040, 0.9);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 1);
  dir.position.set(20, 40, 20);
  dir.castShadow = true;
  scene.add(dir);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshLambertMaterial({ color: 0x808080 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  createWarehouse();
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* =========================================================
   START
   ========================================================= */
window.addEventListener("load", init);
