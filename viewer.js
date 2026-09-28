import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";

const $ = (selector) => document.querySelector(selector);
const canvas = $("#stage-canvas");
const viewport = $("#viewport");
const loading = $("#loading");
const loadingText = $("#loading-text");
const webglError = $("#webgl-error");
const fallbackTitle = $("#fallback-title");
const fallbackText = $("#fallback-text");
const previewImage = $("#preview-image");
const status = $("#stage-status");
const modelCount = $("#model-count");
const selectedHud = $("#selected-hud");
const layerControls = $("#layer-controls");
const presetControls = $("#preset-controls");
const stageMarkers = $("#stage-markers");
const stageRange = $("#stage-range");
const timelineLabel = $("#timeline-label");
const playToggle = $("#play-toggle");
const playbackSpeed = $("#playback-speed");
const selectionEmpty = $("#selection-empty");
const selectionDetails = $("#selection-details");
const sectionControls = $("#section-controls");
const sectionRange = $("#section-range");
const sectionValue = $("#section-value");
const toggleConnectionsInput = $("#toggle-connections");
const toggleMaterialLabelsInput = $("#toggle-material-labels");
const materialLabels = $("#material-labels");

const detailFields = {
  name: $("#detail-name"),
  id: $("#detail-id"),
  discipline: $("#detail-discipline"),
  floor: $("#detail-floor"),
  stage: $("#detail-stage"),
  role: $("#detail-role"),
  material: $("#detail-material"),
  section: $("#detail-section"),
  installation: $("#detail-installation"),
  connection: $("#detail-connection"),
  related: $("#detail-related"),
};

let manifest;
let model;
let mixer;
let currentStage = 8;
let currentMode = "structure";
let playheadFrame = 480;
let isPlaying = false;
let selectedObject;
let selectedRelated = [];
let modelNodes = [];
let nodeById = new Map();
let categoryState = {};
let categoryLabels = {};
let presetViews = {};
let overallBox;
let sectionBounds;
let sectionEnabled = false;
let sectionAxis = "x";
let sectionPlane;
let sectionPlaneMesh;
let materialAnchors = [];

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const scene = new THREE.Scene();
const connectionGroup = new THREE.Group();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 250);
const loader = new GLTFLoader();

const ROLE_COLORS = {
  foundation: 0x9b7a52,
  column: 0x8d9aa0,
  beam: 0xd6dde1,
  slab: 0x6f8f99,
  core: 0xaeb7bc,
  truss: 0x4ca7b0,
  brace: 0xefb24f,
  audience: 0xd8a34b,
  joint: 0xff7a3c,
  slipform: 0xf28a3d,
  enclosure: 0x80a5d2,
  mep: 0xdf7458,
  equipment: 0xd7b74b,
  environment: 0x75aa68,
  engineering: 0xa58dd6,
  structure: 0xc8d0d1,
};

const ROLE_LABELS = {
  foundation: "基础",
  column: "柱",
  beam: "梁",
  slab: "楼板",
  core: "核心筒",
  truss: "桁架",
  brace: "支撑",
  audience: "观众厅结构",
  joint: "节点 / 施工缝",
  slipform: "滑模施工",
  enclosure: "围护",
  mep: "机电",
  equipment: "设备",
  environment: "环境",
  engineering: "轴网标高",
  structure: "结构",
};

const MATERIAL_COLORS = {
  "钢筋混凝土": 0x96a2a4,
  "结构钢": 0x4ca7b0,
  "玻璃 / 铝合金": 0x80a5d2,
  "机电管线": 0xdf7458,
  "施工设备": 0xd7b74b,
  "场地环境": 0x75aa68,
  "工程标注": 0xa58dd6,
  "概念构件": 0xc8d0d1,
};

const STRUCTURE_CATEGORIES = new Set(["foundation", "structure", "audience", "steel", "slipform"]);
const DEFAULT_STRUCTURE_CATEGORIES = new Set(["foundation", "structure", "audience", "steel", "engineering", "slipform"]);
const DEFAULT_CONSTRUCTION_CATEGORIES = new Set([
  "foundation",
  "structure",
  "audience",
  "steel",
  "facade",
  "mep",
  "engineering",
  "slipform",
]);

scene.background = new THREE.Color(0x0b0f0f);
scene.fog = new THREE.Fog(0x0b0f0f, 120, 320);
connectionGroup.name = "StructureConnectionOverlay";
scene.add(connectionGroup);
camera.position.set(43, 35, 55);

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
} catch (error) {
  console.warn("WebGL unavailable", error);
}

function createStudioEnvironment() {
  const environment = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const shell = new THREE.Mesh(box, new THREE.MeshStandardMaterial({
    color: 0x232a2e,
    roughness: 1,
    side: THREE.BackSide,
  }));
  shell.scale.set(26, 16, 26);
  shell.position.y = 6;
  environment.add(shell);
  const panel = (color, intensity, scale, position) => {
    const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    material.color.multiplyScalar(intensity);
    const mesh = new THREE.Mesh(box, material);
    mesh.scale.set(...scale);
    mesh.position.set(...position);
    environment.add(mesh);
  };
  panel(0xfff4e2, 7.5, [7, 0.4, 14], [0, 13.6, 0]);
  panel(0xffd9b0, 2.6, [16, 5, 0.4], [0, 7, -12.8]);
  panel(0xa9c8e6, 1.8, [0.4, 5, 14], [12.8, 7, 0]);
  panel(0x6f6558, 1.5, [26, 0.2, 26], [0, -1.6, 0]);
  return environment;
}

function applyStudioEnvironment(activeRenderer) {
  const pmrem = new THREE.PMREMGenerator(activeRenderer);
  const environment = createStudioEnvironment();
  const target = pmrem.fromScene(environment, 0.04);
  scene.environment = target.texture;
  scene.environmentIntensity = 0.5;
  environment.traverse((object) => {
    if (object.isMesh) {
      object.geometry?.dispose();
      object.material?.dispose();
    }
  });
  pmrem.dispose();
}

if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  applyStudioEnvironment(renderer);
}

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 5;
controls.maxDistance = 115;
controls.target.set(1, 8, 6);

const ambientLight = new THREE.HemisphereLight(0xaec4bb, 0x443d36, 0.45);
scene.add(ambientLight);
const keyLight = new THREE.DirectionalLight(0xfff2dd, 2.4);
const KEY_LIGHT_DIRECTION = new THREE.Vector3(38, 30, 22).normalize();
keyLight.position.copy(KEY_LIGHT_DIRECTION).multiplyScalar(80);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.bias = -0.0006;
keyLight.shadow.normalBias = 0.06;
scene.add(keyLight);
scene.add(keyLight.target);
const fillLight = new THREE.DirectionalLight(0x9cc2dd, 0.5);
fillLight.position.set(-28, 22, -18);
scene.add(fillLight);

function normalizeMeta(meta) {
  if (!meta) return null;
  return {
    id: meta.id || meta.component_id,
    name: meta.name || meta.component_name,
    discipline: meta.discipline || meta.category,
    structuralRole: meta.structuralRole || meta.structural_role,
    stageStart: meta.stageStart ?? meta.stage_start,
    floor: meta.floor,
    material: meta.material,
    section: meta.section,
    installationStatus: meta.installationStatus || meta.installation_status,
    relatedIds: meta.relatedIds || meta.related_ids || [],
    connectionType: meta.connectionType || meta.connection_type,
    selectable: meta.selectable,
    sectionVisible: meta.sectionVisible ?? meta.section_visible,
    cameraRelevant: meta.cameraRelevant ?? meta.camera_relevant,
  };
}

function inferRole(name, discipline) {
  const lower = (name || "").toLowerCase();
  if (discipline === "foundation" || /pile|pilecap|raft|fnd/.test(lower)) return "foundation";
  if (discipline === "slipform" || /slipform|climbing/.test(lower)) return "slipform";
  if (/column|rc_col/.test(lower)) return "column";
  if (/beam|girder|transfer/.test(lower)) return "beam";
  if (/slab|floorplate/.test(lower)) return "slab";
  if (/core|shearwall|stagetower/.test(lower)) return "core";
  if (/brace|web|diagonal/.test(lower)) return "brace";
  if (/truss|roofring|roof/.test(lower) || discipline === "steel") return "truss";
  if (discipline === "audience") return "audience";
  if (discipline === "facade") return "enclosure";
  if (discipline === "mep") return "mep";
  if (discipline === "equipment") return "equipment";
  if (discipline === "environment") return "environment";
  if (discipline === "engineering") return "engineering";
  return "structure";
}

function connectionTypeForRole(role) {
  return {
    foundation: "基础连接",
    column: "梁柱节点",
    beam: "梁柱节点",
    slab: "梁板连接",
    core: "核心筒连接",
    truss: "桁架支座",
    brace: "支撑节点",
    audience: "观众厅结构节点",
    slipform: "滑模施工连接",
    enclosure: "围护连接",
    mep: "专业协同节点",
  }[role] || "";
}

function materialForRole(role, discipline) {
  if (["foundation", "column", "beam", "slab", "core", "audience"].includes(role)) return "钢筋混凝土";
  if (["truss", "brace", "slipform"].includes(role)) return "结构钢";
  if (discipline === "facade") return "玻璃 / 铝合金";
  if (discipline === "mep") return "机电管线";
  if (discipline === "equipment") return "施工设备";
  if (discipline === "environment") return "场地环境";
  return "概念构件";
}

function metaFor(node) {
  const listed = normalizeMeta(manifest?.objects?.[node.name]);
  const extras = normalizeMeta(node.userData?.gltfExtensions?.extras || node.userData);
  const meta = listed || extras;
  if (!meta?.discipline && !meta?.id && !meta?.stageStart) return null;
  const discipline = meta.discipline || "environment";
  const structuralRole = meta.structuralRole || inferRole(node.name, discipline);
  const stageStart = Number(meta.stageStart || (discipline === "equipment" ? 8 : 1));
  return {
    ...meta,
    id: meta.id || node.name,
    name: meta.name || node.name,
    discipline,
    structuralRole,
    stageStart,
    material: meta.material || materialForRole(structuralRole, discipline),
    section: meta.section || "概念截面",
    installationStatus: meta.installationStatus || `第 ${stageStart} 阶段安装`,
    relatedIds: Array.isArray(meta.relatedIds) ? meta.relatedIds : [],
    connectionType: meta.connectionType || connectionTypeForRole(structuralRole),
    selectable: meta.selectable !== false,
    sectionVisible: meta.sectionVisible !== false && !["equipment", "environment"].includes(discipline),
    cameraRelevant: meta.cameraRelevant !== false && !["equipment", "environment", "engineering"].includes(discipline),
  };
}

function stageForMeta(meta) {
  return Number(meta?.stageStart || 1);
}

function isEquipmentVisible(meta) {
  return meta.discipline !== "equipment" || currentStage >= 8;
}

function isSlipformVisible(meta) {
  if (meta.discipline !== "slipform" && meta.structuralRole !== "slipform") return true;
  return currentMode === "construction" && currentStage >= 4 && currentStage <= 5;
}

function visibleByState(node, meta = metaFor(node)) {
  if (node === model || !meta) return true;
  const category = meta.discipline || "environment";
  if (categoryState[category] === false) return false;
  if (!isEquipmentVisible(meta) || !isSlipformVisible(meta)) return false;
  if (currentMode === "structure" || currentMode === "section") {
    return DEFAULT_STRUCTURE_CATEGORIES.has(category);
  }
  if (currentMode === "construction") {
    if (category === "environment") return currentStage === 1;
    return stageForMeta(meta) <= currentStage;
  }
  return stageForMeta(meta) <= currentStage;
}

function roleColor(meta) {
  return ROLE_COLORS[meta?.structuralRole] || ROLE_COLORS[meta?.discipline] || ROLE_COLORS.structure;
}

function forEachMaterial(node, callback) {
  node.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => callback(material));
  });
}

function cloneMeshMaterials(root) {
  root.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    node.material = Array.isArray(node.material)
      ? node.material.map((material) => material.clone())
      : node.material.clone();
  });
}

function rememberMaterial(material) {
  if (material.userData.twinOriginal) return;
  material.userData.twinOriginal = {
    color: material.color?.clone?.(),
    emissive: material.emissive?.clone?.(),
    emissiveIntensity: material.emissiveIntensity || 0,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    envMapIntensity: material.envMapIntensity,
  };
}

function restoreMaterial(material) {
  const original = material.userData.twinOriginal;
  if (!original) return;
  if (original.color && material.color) material.color.copy(original.color);
  if (original.emissive && material.emissive) material.emissive.copy(original.emissive);
  material.emissiveIntensity = original.emissiveIntensity;
  material.opacity = original.opacity;
  material.transparent = original.transparent;
  material.depthWrite = original.depthWrite;
  material.envMapIntensity = original.envMapIntensity;
}

function setMaterialState(material, color, opacity, emissive) {
  rememberMaterial(material);
  if (material.color) material.color.setHex(color);
  material.opacity = opacity;
  material.transparent = opacity < 1;
  material.depthWrite = opacity >= 0.72;
  if (material.emissive) {
    material.emissive.setHex(color);
    material.emissiveIntensity = emissive;
  }
}

function applyObjectVisual(node, meta) {
  forEachMaterial(node, restoreMaterial);
  if (!meta) return;
  let opacity = 1;
  let emissive = currentMode === "structure" || currentMode === "section" ? 0.08 : 0;
  if (meta.discipline === "environment") opacity = currentMode === "coordination" ? 0.18 : 0.1;
  if (meta.discipline === "equipment") opacity = 0.84;
  if (meta.discipline === "facade" && currentMode === "coordination") opacity = 0.45;
  if (meta.discipline === "mep") emissive = 0.1;
  if (currentMode === "construction" && stageForMeta(meta) === currentStage) emissive = 0.2;
  forEachMaterial(node, (material) => setMaterialState(material, roleColor(meta), opacity, emissive));
}

function applyHighlight(node, color, intensity) {
  if (!node) return;
  forEachMaterial(node, (material) => {
    rememberMaterial(material);
    if (material.emissive) {
      material.emissive.setHex(color);
      material.emissiveIntensity = intensity;
    }
  });
}

function clearHighlights() {
  if (selectedObject) applyObjectVisual(selectedObject, metaFor(selectedObject));
  selectedRelated.forEach((node) => applyObjectVisual(node, metaFor(node)));
  selectedRelated = [];
}

function updateVisibility() {
  modelNodes.forEach(({ node, meta }) => {
    node.visible = visibleByState(node, meta);
    applyObjectVisual(node, meta);
  });
  selectedRelated.forEach((node) => applyHighlight(node, 0x4ca7b0, 0.45));
  applyHighlight(selectedObject, 0xff8a32, 0.75);
  syncSectionPlane();
  updateConnectionOverlay();
  updateMaterialLabels();
  if (renderer) renderer.shadowMap.needsUpdate = true;
}

function setStage(value, movePlayhead = true) {
  currentStage = Math.max(1, Math.min(8, Number(value)));
  const stage = manifest.stages[currentStage - 1];
  stageRange.value = String(currentStage);
  timelineLabel.textContent = stage.label;
  document.querySelectorAll(".stage-marker").forEach((item) => {
    item.classList.toggle("is-active", Number(item.dataset.stage) === currentStage);
  });
  if (movePlayhead) {
    playheadFrame = stage.end;
    mixer?.setTime(playheadFrame / manifest.fps);
  }
  updateVisibility();
}

function setPlayback(playing) {
  isPlaying = playing;
  playToggle.textContent = playing ? "暂停" : "播放";
  playToggle.setAttribute("aria-pressed", String(playing));
}

function syncLayerInputs() {
  manifest.categories.forEach((category) => {
    const input = layerControls.querySelector(`[data-category="${category.key}"]`);
    if (input) input.checked = categoryState[category.key] !== false;
  });
}

function setMode(mode, fit = false) {
  currentMode = mode;
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  const defaults = mode === "construction"
    ? DEFAULT_CONSTRUCTION_CATEGORIES
    : mode === "coordination"
      ? null
      : DEFAULT_STRUCTURE_CATEGORIES;
  if (defaults) {
    manifest.categories.forEach((category) => {
      categoryState[category.key] = defaults.has(category.key);
    });
  }
  sectionControls.hidden = mode !== "section";
  if (mode === "section") toggleSection(true);
  else if (sectionEnabled) toggleSection(false);
  syncLayerInputs();
  updateVisibility();
  if (fit) fitView();
}

function applyLayerMode(preset) {
  if (preset.mode) setMode(preset.mode);
  if (preset.layers === "keep") return;
  manifest.categories.forEach((category) => {
    const keep = (preset.scope || []).includes(category.key)
      || (preset.context || []).includes(category.key)
      || category.key === "engineering";
    categoryState[category.key] = preset.layers === "all"
      ? true
      : preset.layers === "structure"
        ? DEFAULT_STRUCTURE_CATEGORIES.has(category.key)
        : keep;
  });
  syncLayerInputs();
  updateVisibility();
}

function markActivePreset(key) {
  document.querySelectorAll(".preset-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.preset === key);
  });
}

function setCameraPreset(key) {
  const preset = manifest?.cameraPresets?.[key];
  if (!preset) return;
  applyLayerMode(preset);
  if (preset.axis) setSectionAxis(preset.axis);
  const position = new THREE.Vector3().fromArray(preset.position);
  const target = new THREE.Vector3().fromArray(preset.target);
  applyView(presetViews[key] || { position, target, distance: position.distanceTo(target) });
  markActivePreset(key);
}

function boxForMode() {
  const box = new THREE.Box3();
  modelNodes.forEach(({ node, meta }) => {
    if (!node.visible || (currentMode !== "coordination" && !meta.cameraRelevant)) return;
    const nodeBox = new THREE.Box3().setFromObject(node);
    if (!nodeBox.isEmpty()) box.union(nodeBox);
  });
  return box.isEmpty() ? (overallBox || new THREE.Box3().setFromObject(model)) : box;
}

function fitView() {
  if (!model) return;
  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() < 1e-6) direction.set(0.85, 0.55, 1);
  applyView(frameBox(boxForMode(), direction.normalize().toArray(), 1.06));
  markActivePreset(null);
}

function applyView(view) {
  camera.position.copy(view.position);
  controls.target.copy(view.target);
  controls.minDistance = Math.max(2, view.distance * 0.15);
  controls.maxDistance = Math.max(view.distance * 1.9, 150);
  camera.far = Math.max(250, view.distance * 3.2);
  camera.updateProjectionMatrix();
  scene.fog.near = Math.max(60, view.distance * 0.9);
  scene.fog.far = Math.max(240, view.distance * 2.8);
  controls.update();
}

function frameBox(box, directionArray, padding = 1.08) {
  const center = box.getCenter(new THREE.Vector3());
  const direction = new THREE.Vector3().fromArray(directionArray).normalize();
  const forward = direction.clone().negate();
  const reference = Math.abs(forward.y) > 0.98 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(reference, forward).normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const tanH = tanV * (camera.aspect > 0.1 ? camera.aspect : 1.4);
  let distance = 1;
  for (let index = 0; index < 8; index += 1) {
    const corner = new THREE.Vector3(
      index & 1 ? box.max.x : box.min.x,
      index & 2 ? box.max.y : box.min.y,
      index & 4 ? box.max.z : box.min.z,
    ).sub(center);
    const depth = corner.dot(forward);
    distance = Math.max(
      distance,
      (Math.abs(corner.dot(right)) * padding) / tanH - depth,
      (Math.abs(corner.dot(up)) * padding) / tanV - depth,
    );
  }
  return { position: center.clone().addScaledVector(direction, distance), target: center, distance };
}

function buildPresetViews() {
  overallBox = new THREE.Box3();
  const disciplineBoxes = new Map();
  modelNodes.forEach(({ node, meta }) => {
    if (meta.cameraRelevant) overallBox.union(new THREE.Box3().setFromObject(node));
    const box = disciplineBoxes.get(meta.discipline) || new THREE.Box3();
    box.union(new THREE.Box3().setFromObject(node));
    disciplineBoxes.set(meta.discipline, box);
  });
  if (overallBox.isEmpty()) overallBox.setFromObject(model);
  sectionBounds = overallBox.clone();
  updateSectionRange();
  Object.entries(manifest.cameraPresets).forEach(([key, preset]) => {
    const box = new THREE.Box3();
    (preset.scope || []).forEach((discipline) => {
      const scoped = disciplineBoxes.get(discipline);
      if (scoped) box.union(scoped);
    });
    if (box.isEmpty()) box.copy(overallBox);
    const direction = new THREE.Vector3()
      .fromArray(preset.position)
      .sub(new THREE.Vector3().fromArray(preset.target));
    presetViews[key] = frameBox(box, direction.toArray(), preset.padding || 1.08);
  });
}

function configureShadows() {
  if (!renderer || !model) return;
  const box = overallBox || new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.62;
  const distance = radius * 2.6;
  keyLight.target.position.copy(center);
  keyLight.target.updateMatrixWorld();
  keyLight.position.copy(center).addScaledVector(KEY_LIGHT_DIRECTION, distance);
  const shadowCamera = keyLight.shadow.camera;
  shadowCamera.left = -radius;
  shadowCamera.right = radius;
  shadowCamera.top = radius;
  shadowCamera.bottom = -radius;
  shadowCamera.near = Math.max(0.5, distance - radius * 3);
  shadowCamera.far = distance + radius * 3;
  shadowCamera.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;
}

function makeLayerControls() {
  layerControls.replaceChildren();
  manifest.categories.forEach((category) => {
    categoryLabels[category.key] = category.label;
    categoryState[category.key] = true;
    const count = Object.values(manifest.objects || {}).filter((item) => item.discipline === category.key).length;
    const row = document.createElement("div");
    row.className = "layer-row";
    row.innerHTML = `
      <label>
        <input type="checkbox" checked data-category="${category.key}">
        <span class="swatch" style="background:${category.color}"></span>
        <span>${category.label}</span>
      </label>
      <span class="layer-count">${count}</span>
    `;
    row.querySelector("input").addEventListener("change", (event) => {
      categoryState[category.key] = event.target.checked;
      currentMode = "coordination";
      document.querySelectorAll(".mode-button").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.mode === currentMode);
      });
      sectionControls.hidden = true;
      if (sectionEnabled) toggleSection(false);
      updateVisibility();
    });
    layerControls.append(row);
  });
}

function makePresets() {
  presetControls.replaceChildren();
  Object.entries(manifest.cameraPresets).forEach(([key, preset]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-button";
    button.dataset.preset = key;
    button.textContent = preset.label;
    button.addEventListener("click", () => setCameraPreset(key));
    presetControls.append(button);
  });
}

function makeTimeline() {
  stageMarkers.replaceChildren();
  manifest.stages.forEach((stage) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stage-marker";
    button.dataset.stage = stage.id;
    button.innerHTML = `<strong>${String(stage.id).padStart(2, "0")}</strong><span>${stage.label}</span>`;
    button.addEventListener("click", () => {
      if (currentMode === "structure") setMode("construction");
      setStage(stage.id);
    });
    stageMarkers.append(button);
  });
}

function nodeCenter(node) {
  const box = new THREE.Box3().setFromObject(node);
  return box.isEmpty() ? node.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
}

function fallbackRelated(node, meta) {
  const targets = {
    column: ["beam", "slab"],
    beam: ["column", "core", "slab"],
    slab: ["beam", "column"],
    foundation: ["column", "core"],
    core: ["beam", "slab"],
    truss: ["column", "audience", "brace"],
    brace: ["truss", "column"],
    audience: ["truss", "beam"],
  }[meta.structuralRole] || [];
  if (!targets.length) return [];
  const origin = nodeCenter(node);
  return modelNodes
    .filter(({ node: candidate, meta: candidateMeta }) => (
      candidate !== node && targets.includes(candidateMeta.structuralRole) && candidateMeta.id
    ))
    .map(({ node: candidate, meta: candidateMeta }) => ({
      candidate,
      candidateMeta,
      distance: origin.distanceTo(nodeCenter(candidate)),
    }))
    .filter((item) => item.distance < 9)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map((item) => item.candidateMeta.id);
}

function buildClientRelationships() {
  modelNodes.forEach(({ node, meta }) => {
    if (!meta.relatedIds.length) meta.relatedIds = fallbackRelated(node, meta);
  });
}

function materialColor(material) {
  if (MATERIAL_COLORS[material]) return MATERIAL_COLORS[material];
  if (material?.includes("混凝土")) return MATERIAL_COLORS["钢筋混凝土"];
  if (material?.includes("钢")) return MATERIAL_COLORS["结构钢"];
  if (material?.includes("玻璃") || material?.includes("铝")) return MATERIAL_COLORS["玻璃 / 铝合金"];
  if (material?.includes("机电")) return MATERIAL_COLORS["机电管线"];
  return MATERIAL_COLORS["概念构件"];
}

function buildMaterialAnchors() {
  const anchors = new Map();
  modelNodes.forEach(({ node, meta }) => {
    if (!meta.cameraRelevant || ["environment", "engineering", "equipment"].includes(meta.discipline)) return;
    const material = meta.material || materialForRole(meta.structuralRole, meta.discipline);
    const box = new THREE.Box3().setFromObject(node);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const volume = size.x * size.y * size.z;
    const current = anchors.get(material);
    if (!current || volume > current.volume) anchors.set(material, { node, meta, volume });
  });
  materialAnchors = [...anchors.values()];
  materialLabels.replaceChildren();
  materialAnchors.forEach(({ meta }) => {
    const label = document.createElement("div");
    label.className = "material-label";
    label.style.setProperty("--material-color", `#${materialColor(meta.material).toString(16).padStart(6, "0")}`);
    const swatch = document.createElement("i");
    swatch.className = "material-label-swatch";
    const text = document.createElement("span");
    text.textContent = meta.material;
    label.append(swatch, text);
    materialLabels.append(label);
  });
}

function updateMaterialLabels() {
  const enabled = toggleMaterialLabelsInput?.checked !== false && Boolean(model);
  materialLabels.hidden = !enabled;
  if (!enabled) return;
  const rect = viewport.getBoundingClientRect();
  materialAnchors.forEach(({ node }, index) => {
    const label = materialLabels.children[index];
    if (!label || !node.visible) {
      if (label) label.hidden = true;
      return;
    }
    const projected = nodeCenter(node).project(camera);
    const inside = projected.z >= -1 && projected.z <= 1
      && projected.x >= -1.05 && projected.x <= 1.05
      && projected.y >= -1.05 && projected.y <= 1.05;
    label.hidden = !inside;
    if (!inside) return;
    const x = (projected.x * 0.5 + 0.5) * rect.width;
    const y = (-projected.y * 0.5 + 0.5) * rect.height;
    label.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  });
}

function clearConnectionOverlay() {
  while (connectionGroup.children.length) {
    const child = connectionGroup.children[0];
    connectionGroup.remove(child);
    child.geometry?.dispose();
    child.material?.dispose();
  }
}

function updateConnectionOverlay() {
  clearConnectionOverlay();
  connectionGroup.visible = toggleConnectionsInput?.checked !== false && Boolean(selectedObject);
  if (!connectionGroup.visible) return;
  const start = nodeCenter(selectedObject);
  selectedRelated.forEach((node) => {
    if (!node.visible) return;
    const end = nodeCenter(node);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([start, end]),
      new THREE.LineBasicMaterial({ color: 0x4ca7b0, transparent: true, opacity: 0.86 }),
    );
    connectionGroup.add(line);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff8a32 }),
    );
    marker.position.copy(end);
    connectionGroup.add(marker);
  });
}

function setSelected(node) {
  clearHighlights();
  selectedObject = node;
  clearConnectionOverlay();
  if (!node) {
    selectionEmpty.hidden = false;
    selectionDetails.hidden = true;
    selectedHud.textContent = "未选择构件";
    return;
  }
  const meta = metaFor(node) || {};
  selectedRelated = (meta.relatedIds || []).map((id) => nodeById.get(id)).filter(Boolean);
  selectedRelated.forEach((relatedNode) => applyHighlight(relatedNode, 0x4ca7b0, 0.45));
  applyHighlight(node, 0xff8a32, 0.75);
  selectionEmpty.hidden = true;
  selectionDetails.hidden = false;
  detailFields.name.textContent = meta.name || node.name;
  detailFields.id.textContent = meta.id || "未编号";
  detailFields.discipline.textContent = categoryLabels[meta.discipline] || meta.discipline || "未分类";
  detailFields.floor.textContent = meta.floor || "概念层";
  detailFields.stage.textContent = manifest.stages[(Number(meta.stageStart || 1) - 1)]?.label || "场地与土方";
  detailFields.role.textContent = ROLE_LABELS[meta.structuralRole] || meta.structuralRole || "未定义";
  detailFields.material.textContent = meta.material || "概念材料";
  detailFields.section.textContent = meta.section || "概念截面";
  detailFields.installation.textContent = meta.installationStatus || "随阶段安装";
  detailFields.connection.textContent = meta.connectionType || "概念连接";
  detailFields.related.replaceChildren();
  if (!selectedRelated.length) {
    const item = document.createElement("li");
    item.className = "is-empty";
    item.textContent = "暂无关联构件";
    detailFields.related.append(item);
  } else {
    selectedRelated.forEach((relatedNode) => {
      const item = document.createElement("li");
      item.textContent = metaFor(relatedNode)?.name || relatedNode.name;
      detailFields.related.append(item);
    });
  }
  selectedHud.textContent = `${meta.name || node.name} · ${ROLE_LABELS[meta.structuralRole] || detailFields.floor.textContent}`;
  updateConnectionOverlay();
}

function axisConfig(axis = sectionAxis) {
  if (axis === "z") return { index: 2, normal: new THREE.Vector3(0, 0, -1), label: "B-B", rotation: [0, 0, 0] };
  if (axis === "y") return { index: 1, normal: new THREE.Vector3(0, -1, 0), label: "水平", rotation: [-Math.PI / 2, 0, 0] };
  return { index: 0, normal: new THREE.Vector3(-1, 0, 0), label: "A-A", rotation: [0, Math.PI / 2, 0] };
}

function updateSectionValue() {
  if (sectionValue && sectionRange) sectionValue.textContent = `${axisConfig().label} ${Number(sectionRange.value).toFixed(2)} m`;
}

function updateSectionRange() {
  if (!sectionBounds || !sectionRange) return;
  const config = axisConfig();
  const min = sectionBounds.min.getComponent(config.index);
  const max = sectionBounds.max.getComponent(config.index);
  sectionRange.min = String(min);
  sectionRange.max = String(max);
  sectionRange.step = String(Math.max((max - min) / 100, 0.01));
  if (Number(sectionRange.value) < min || Number(sectionRange.value) > max) {
    sectionRange.value = String((min + max) / 2);
  }
  updateSectionValue();
}

function setSectionAxis(axis) {
  sectionAxis = axis;
  document.querySelectorAll(".axis-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.axis === axis);
  });
  updateSectionRange();
  syncSectionPlane();
}

function syncSectionPlane() {
  if (!sectionPlaneMesh || !sectionPlane || !sectionEnabled || !sectionBounds) {
    if (sectionPlaneMesh) sectionPlaneMesh.visible = false;
    return;
  }
  const config = axisConfig();
  const value = Number(sectionRange.value);
  const point = new THREE.Vector3();
  point.setComponent(config.index, value);
  sectionPlane.normal.copy(config.normal);
  sectionPlane.constant = -config.normal.dot(point);
  const size = sectionBounds.getSize(new THREE.Vector3());
  const center = sectionBounds.getCenter(new THREE.Vector3());
  if (sectionAxis === "x") {
    sectionPlaneMesh.scale.set(Math.max(size.z, 1), Math.max(size.y, 1), 1);
    sectionPlaneMesh.position.set(value, center.y, center.z);
  } else if (sectionAxis === "z") {
    sectionPlaneMesh.scale.set(Math.max(size.x, 1), Math.max(size.y, 1), 1);
    sectionPlaneMesh.position.set(center.x, center.y, value);
  } else {
    sectionPlaneMesh.scale.set(Math.max(size.x, 1), Math.max(size.z, 1), 1);
    sectionPlaneMesh.position.set(center.x, value, center.z);
  }
  sectionPlaneMesh.rotation.set(...config.rotation);
  sectionPlaneMesh.visible = true;
  updateSectionValue();
}

function toggleSection(enabled) {
  sectionEnabled = enabled;
  $("#toggle-section").checked = enabled;
  sectionPlane ||= new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  model?.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const meta = metaFor(node);
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      material.clippingPlanes = enabled && meta?.sectionVisible !== false ? [sectionPlane] : [];
      material.clipShadows = enabled;
    });
  });
  if (!sectionPlaneMesh) {
    sectionPlaneMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xd8a34b,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    scene.add(sectionPlaneMesh);
  }
  syncSectionPlane();
}

function onPointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const targets = modelNodes
    .filter(({ node, meta }) => node.visible && meta.selectable !== false)
    .map(({ node }) => node);
  const hit = raycaster.intersectObjects(targets, true).find((intersection) => intersection.object.isMesh);
  if (!hit) {
    setSelected(null);
    return;
  }
  let node = hit.object;
  while (node.parent && !metaFor(node) && node.parent !== model) node = node.parent;
  setSelected(node);
}

function resize() {
  if (!renderer) return;
  const rect = viewport.getBoundingClientRect();
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height, false);
}

function animate() {
  if (!renderer) return;
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  if (isPlaying && mixer) {
    playheadFrame += delta * manifest.fps * Number(playbackSpeed.value);
    if (playheadFrame > manifest.endFrame) playheadFrame = 1;
    mixer.setTime(playheadFrame / manifest.fps);
    const active = manifest.stages.find((stage) => playheadFrame >= stage.frame && playheadFrame <= stage.end);
    if (active && active.id !== currentStage) setStage(active.id, false);
  }
  syncSectionPlane();
  updateMaterialLabels();
  controls.update();
  renderer.render(scene, camera);
}

function showFallback(title, message) {
  loading.hidden = true;
  webglError.hidden = false;
  previewImage.hidden = false;
  fallbackTitle.textContent = title;
  fallbackText.textContent = message;
  status.textContent = "工程预览模式";
  status.classList.add("is-ready");
  viewport.classList.add("is-fallback");
}

function loadModel() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(reject)(new Error("GLB 解析超时")), 30000);
    const finish = (callback) => (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    loader.load(
      "./stage_tower.glb",
      finish(resolve),
      (progress) => {
        loadingText.textContent = progress.total
          ? `正在载入结构模型 ${Math.round((progress.loaded / progress.total) * 100)}%`
          : "正在解析结构模型";
      },
      finish(reject),
    );
  });
}

async function load() {
  try {
    const response = await fetch("./manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`清单加载失败: ${response.status}`);
    manifest = await response.json();
    makeLayerControls();
    makePresets();
    makeTimeline();
    setMode("structure");
    setStage(8);
    if (!renderer) {
      showFallback("已切换到工程预览", "当前浏览器无法创建 WebGL 场景；时间轴、专业图层和工程信息仍可查看。");
      return;
    }
    const gltf = await loadModel();
    model = gltf.scene;
    cloneMeshMaterials(model);
    scene.add(model);
    mixer = new THREE.AnimationMixer(model);
    (gltf.animations || []).forEach((clip) => mixer.clipAction(clip).play());
    model.traverse((node) => {
      const meta = metaFor(node);
      if (!meta) return;
      modelNodes.push({ node, meta });
      if (!nodeById.has(meta.id) || meta.selectable !== false) nodeById.set(meta.id, node);
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
      forEachMaterial(node, (material) => {
        rememberMaterial(material);
        if (material.isMeshStandardMaterial) {
          material.envMapIntensity = material.transparent ? 1.45 : 0.9;
        }
      });
    });
    buildClientRelationships();
    buildMaterialAnchors();
    modelCount.textContent = `模型节点 ${modelNodes.length}`;
    resize();
    buildPresetViews();
    configureShadows();
    setStage(8);
    setCameraPreset(new URLSearchParams(window.location.search).get("preset") || "overall");
    loading.hidden = true;
    status.textContent = "模型已就绪";
    status.classList.add("is-ready");
    animate();
  } catch (error) {
    console.error(error);
    showFallback("三维模型暂未载入", "GLB 解析超时或当前浏览器不支持 WebGL，已显示本地工程预览。");
  }
}

stageRange.addEventListener("input", (event) => {
  if (currentMode === "structure") setMode("construction");
  setStage(event.target.value);
});
playToggle.addEventListener("click", () => {
  if (currentMode === "structure") setMode("construction");
  setPlayback(!isPlaying);
});
$("#reset-view").addEventListener("click", () => setCameraPreset("overall"));
$("#fit-view").addEventListener("click", fitView);
document.querySelectorAll(".mode-button").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode, true));
});
document.querySelectorAll(".axis-button").forEach((button) => {
  button.addEventListener("click", () => {
    setMode("section");
    setSectionAxis(button.dataset.axis);
  });
});
sectionRange.addEventListener("input", () => {
  setMode("section");
  syncSectionPlane();
});
$("#toggle-grid").addEventListener("change", (event) => {
  const input = layerControls.querySelector('[data-category="engineering"]');
  if (input) {
    input.checked = event.target.checked;
    categoryState.engineering = event.target.checked;
    updateVisibility();
  }
});
$("#toggle-section").addEventListener("change", (event) => {
  if (event.target.checked) setMode("section");
  toggleSection(event.target.checked);
});
toggleConnectionsInput?.addEventListener("change", updateConnectionOverlay);
toggleMaterialLabelsInput?.addEventListener("change", updateMaterialLabels);
$("#toggle-layers").addEventListener("click", (event) => {
  $(".left-panel").classList.toggle("is-collapsed");
  event.target.textContent = $(".left-panel").classList.contains("is-collapsed") ? "+" : "−";
});
canvas.addEventListener("pointerup", onPointer);
window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select, button")) return;
  if (event.key.toLowerCase() === "g") $("#toggle-grid").click();
  if (event.key.toLowerCase() === "a") $("#toggle-section").click();
  if (event.key.toLowerCase() === "c") toggleConnectionsInput?.click();
  if (event.key.toLowerCase() === "m") toggleMaterialLabelsInput?.click();
  if (event.key === " ") {
    event.preventDefault();
    if (currentMode === "structure") setMode("construction");
    setPlayback(!isPlaying);
  }
});

load();
