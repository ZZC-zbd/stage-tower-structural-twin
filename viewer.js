import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";

const canvas = document.querySelector("#stage-canvas");
const viewport = document.querySelector("#viewport");
const loading = document.querySelector("#loading");
const loadingText = document.querySelector("#loading-text");
const webglError = document.querySelector("#webgl-error");
const fallbackTitle = document.querySelector("#fallback-title");
const fallbackText = document.querySelector("#fallback-text");
const previewImage = document.querySelector("#preview-image");
const status = document.querySelector("#stage-status");
const modelCount = document.querySelector("#model-count");
const selectedHud = document.querySelector("#selected-hud");
const layerControls = document.querySelector("#layer-controls");
const presetControls = document.querySelector("#preset-controls");
const stageMarkers = document.querySelector("#stage-markers");
const stageRange = document.querySelector("#stage-range");
const timelineLabel = document.querySelector("#timeline-label");
const playToggle = document.querySelector("#play-toggle");
const playbackSpeed = document.querySelector("#playback-speed");
const selectionEmpty = document.querySelector("#selection-empty");
const selectionDetails = document.querySelector("#selection-details");
const detailName = document.querySelector("#detail-name");
const detailId = document.querySelector("#detail-id");
const detailDiscipline = document.querySelector("#detail-discipline");
const detailFloor = document.querySelector("#detail-floor");
const detailStage = document.querySelector("#detail-stage");

let manifest;
let model;
let mixer;
let clips = [];
let currentStage = 8;
let isPlaying = false;
let playheadFrame = 480;
let selectedObject;
let sectionEnabled = false;
let sectionPlane;
let sectionPlaneMesh;
let categoryState = {};
let modelNodes = [];
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const categoryLabels = {};
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f0f);
scene.fog = new THREE.Fog(0x0b0f0f, 120, 320);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 250);
camera.position.set(43, 35, 55);

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
} catch (error) {
  console.warn("WebGL unavailable", error);
}
if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
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
  scene.background = new THREE.Color(0x0b0f0f);
  environment.traverse((object) => {
    if (object.isMesh) {
      object.geometry?.dispose();
      object.material?.dispose();
    }
  });
  pmrem.dispose();
}

function configureShadows() {
  if (!model || !renderer) return;
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

const loader = new GLTFLoader();
const MODEL_TIMEOUT_MS = 30000;
const SECTION_X = 8.5;
const presetViews = {};
let overallBox = null;

function metaFor(node) {
  const listed = manifest?.objects?.[node.name];
  if (listed) return listed;
  const extras = node.userData?.gltfExtensions?.extras || node.userData;
  return extras?.discipline || extras?.id || extras?.stageStart ? extras : null;
}

function stageForMeta(meta) {
  return Number(meta?.stageStart || 1);
}

function visibleByState(node) {
  if (node === model) return true;
  const meta = metaFor(node);
  if (!meta) return true;
  const category = meta.discipline || "environment";
  return categoryState[category] !== false && stageForMeta(meta) <= currentStage;
}

function updateVisibility() {
  modelNodes.forEach(({ node }) => {
    node.visible = visibleByState(node);
  });
  syncSectionPlane();
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

function applyLayerMode(preset) {
  const mode = preset.layers || "keep";
  if (mode === "keep") return;
  manifest.categories.forEach((category) => {
    const keep = (preset.scope || []).includes(category.key)
      || (preset.context || []).includes(category.key)
      || category.key === "engineering";
    const enabled = mode === "all" ? true : keep;
    categoryState[category.key] = enabled;
    const input = layerControls.querySelector(`[data-category="${category.key}"]`);
    if (input) input.checked = enabled;
  });
  updateVisibility();
}

function setCameraPreset(key) {
  const preset = manifest?.cameraPresets?.[key];
  if (!preset || !controls) return;
  applyLayerMode(preset);
  const position = new THREE.Vector3().fromArray(preset.position);
  const target = new THREE.Vector3().fromArray(preset.target);
  applyView(presetViews[key] || { position, target, distance: position.distanceTo(target) });
  markActivePreset(key);
  if (key === "section" && !sectionEnabled) {
    document.querySelector("#toggle-section").checked = true;
    toggleSection(true);
  }
}

function fitView() {
  if (!model) return;
  const box = overallBox || new THREE.Box3().setFromObject(model);
  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() < 1e-6) direction.set(0.85, 0.55, 1);
  applyView(frameBox(box, direction.normalize().toArray(), 1.06));
  markActivePreset(null);
}

function applyView(view) {
  camera.position.copy(view.position);
  controls.target.copy(view.target);
  controls.minDistance = Math.max(2, view.distance * 0.15);
  controls.maxDistance = Math.max(view.distance * 1.9, 150);
  camera.far = Math.max(250, view.distance * 3.2);
  camera.updateProjectionMatrix();
  if (scene.fog) {
    scene.fog.near = Math.max(60, view.distance * 0.9);
    scene.fog.far = Math.max(240, view.distance * 2.8);
  }
  controls.update();
}

function markActivePreset(key) {
  document.querySelectorAll(".preset-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.preset === key);
  });
}

function presetFromLocation() {
  const requested = new URLSearchParams(window.location.search).get("preset");
  return requested && manifest?.cameraPresets?.[requested] ? requested : "overall";
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
  if (!model) return;
  overallBox = new THREE.Box3().setFromObject(model);
  const disciplineBoxes = new Map();
  modelNodes.forEach(({ node, meta }) => {
    const key = meta.discipline || "environment";
    const box = disciplineBoxes.get(key) || new THREE.Box3();
    box.union(new THREE.Box3().setFromObject(node));
    disciplineBoxes.set(key, box);
  });
  Object.entries(manifest.cameraPresets).forEach(([key, preset]) => {
    const box = new THREE.Box3();
    (preset.scope || []).forEach((discipline) => {
      const scoped = disciplineBoxes.get(discipline);
      if (scoped) box.union(scoped);
    });
    if (box.isEmpty()) box.copy(overallBox);
    if (key === "section") box.max.x = Math.min(box.max.x, SECTION_X);
    const direction = new THREE.Vector3()
      .fromArray(preset.position)
      .sub(new THREE.Vector3().fromArray(preset.target));
    presetViews[key] = frameBox(box, direction.toArray(), preset.padding || 1.08);
  });
}

function makeLayerControls() {
  layerControls.replaceChildren();
  manifest.categories.forEach((category) => {
    categoryLabels[category.key] = category.label;
    categoryState[category.key] = true;
    const count = manifest.objects
      ? Object.values(manifest.objects).filter((item) => item.discipline === category.key).length
      : 0;
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
      updateVisibility();
    });
    layerControls.append(row);
  });
}

function makePresets() {
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
  manifest.stages.forEach((stage) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stage-marker";
    button.dataset.stage = stage.id;
    button.innerHTML = `<strong>${String(stage.id).padStart(2, "0")}</strong><span>${stage.label}</span>`;
    button.addEventListener("click", () => setStage(stage.id));
    stageMarkers.append(button);
  });
}

function setSelected(node) {
  if (selectedObject) {
    selectedObject.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material.userData?.originalEmissive) {
          material.emissive.copy(material.userData.originalEmissive);
          material.emissiveIntensity = material.userData.originalEmissiveIntensity || 0;
        }
      });
    });
  }
  selectedObject = node;
  if (!node) {
    selectionEmpty.hidden = false;
    selectionDetails.hidden = true;
    selectedHud.textContent = "未选择构件";
    return;
  }
  node.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      material.userData.originalEmissive = material.emissive?.clone?.() || new THREE.Color(0);
      material.userData.originalEmissiveIntensity = material.emissiveIntensity || 0;
      if (material.emissive) {
        material.emissive.set(0xb86b25);
        material.emissiveIntensity = 0.65;
      }
    });
  });

  const meta = metaFor(node) || {};
  selectionEmpty.hidden = true;
  selectionDetails.hidden = false;
  detailName.textContent = meta.name || node.name;
  detailId.textContent = meta.id || "未编号";
  detailDiscipline.textContent = categoryLabels[meta.discipline] || meta.discipline || "未分类";
  detailFloor.textContent = meta.floor || "概念层";
  detailStage.textContent = manifest.stages[(Number(meta.stageStart || 1) - 1)]?.label || "场地与土方";
  selectedHud.textContent = `${meta.name || node.name} · ${detailFloor.textContent}`;
}

function syncSectionPlane() {
  if (!sectionPlaneMesh) return;
  sectionPlaneMesh.visible = sectionEnabled && camera.position.x < SECTION_X;
}

function toggleSection(enabled) {
  sectionEnabled = enabled;
  if (!sectionPlane) {
    sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), SECTION_X);
  }
  model?.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      material.clippingPlanes = enabled ? [sectionPlane] : [];
      material.clipShadows = enabled;
    });
  });
  if (!sectionPlaneMesh) {
    const geometry = new THREE.PlaneGeometry(44, 20);
    const material = new THREE.MeshBasicMaterial({
      color: 0xd8a34b,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    sectionPlaneMesh = new THREE.Mesh(geometry, material);
    sectionPlaneMesh.rotation.y = Math.PI / 2;
    sectionPlaneMesh.position.set(SECTION_X, 8, 4);
    scene.add(sectionPlaneMesh);
  }
  syncSectionPlane();
}

function onPointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersections = raycaster.intersectObjects(modelNodes.map(({ node }) => node), true);
  const hit = intersections.find((intersection) => intersection.object.isMesh);
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
  if (isPlaying) renderer.shadowMap.needsUpdate = true;
  syncSectionPlane();
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
    const finish = (callback) => (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(
      () => finish(reject)(new Error("GLB 解析超时")),
      MODEL_TIMEOUT_MS,
    );
    loader.load(
      "./stage_tower.glb",
      finish(resolve),
      (progress) => {
        if (progress.total) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          loadingText.textContent = `正在载入结构模型 ${percent}%`;
        } else {
          loadingText.textContent = "正在解析结构模型";
        }
      },
      finish(reject),
    );
  });
}

async function load() {
  try {
    const manifestResponse = await fetch("./manifest.json", { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error(`清单加载失败: ${manifestResponse.status}`);
    manifest = await manifestResponse.json();
    makeLayerControls();
    makePresets();
    makeTimeline();
    setStage(8);
    setCameraPreset(presetFromLocation());
    loadingText.textContent = renderer ? "正在载入结构模型" : "当前浏览器不支持 WebGL";
    if (!renderer) {
      showFallback(
        "已切换到工程预览",
        "当前浏览器无法创建 WebGL 场景；时间轴、专业图层和工程信息仍可查看。",
      );
      return;
    }
    const gltf = await loadModel();
    model = gltf.scene;
    scene.add(model);
    clips = gltf.animations || [];
    mixer = new THREE.AnimationMixer(model);
    clips.forEach((clip) => mixer.clipAction(clip).play());
    modelNodes = [];
    model.traverse((node) => {
      const meta = metaFor(node);
      if (!meta) {
        if (node.isMesh) node.castShadow = node.receiveShadow = true;
        return;
      }
      modelNodes.push({ node, meta });
      if (node.isMesh) node.castShadow = node.receiveShadow = true;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        if (!material?.isMeshStandardMaterial) return;
        material.envMapIntensity = material.transparent ? 1.45 : 0.9;
        if (material.transparent && material.opacity < 0.9) material.depthWrite = false;
      });
    });
    modelCount.textContent = `模型节点 ${modelNodes.length}`;
    resize();
    buildPresetViews();
    configureShadows();
    setStage(8);
    setCameraPreset(presetFromLocation());
    loading.hidden = true;
    status.textContent = "模型已就绪";
    status.classList.add("is-ready");
    animate();
  } catch (error) {
    console.error(error);
    showFallback(
      "三维模型暂未载入",
      "GLB 解析超时或当前浏览器不支持 WebGL，已显示本地工程预览。请用桌面版 Chrome/Edge 重试三维模式。",
    );
  }
}

stageRange.addEventListener("input", (event) => setStage(event.target.value));
playToggle.addEventListener("click", () => setPlayback(!isPlaying));
document.querySelector("#playback-speed").addEventListener("change", () => {});
document.querySelector("#reset-view").addEventListener("click", () => setCameraPreset("overall"));
document.querySelector("#fit-view").addEventListener("click", fitView);
document.querySelector("#toggle-grid").addEventListener("change", (event) => {
  const enabled = event.target.checked;
  Object.values(categoryState).forEach((_, index) => {});
  const engineeringInput = layerControls.querySelector('[data-category="engineering"]');
  if (engineeringInput) {
    engineeringInput.checked = enabled;
    categoryState.engineering = enabled;
    updateVisibility();
  }
});
document.querySelector("#toggle-section").addEventListener("change", (event) => toggleSection(event.target.checked));
document.querySelector("#toggle-layers").addEventListener("click", (event) => {
  document.querySelector(".left-panel").classList.toggle("is-collapsed");
  event.target.textContent = document.querySelector(".left-panel").classList.contains("is-collapsed") ? "+" : "−";
});
canvas.addEventListener("pointerup", onPointer);
window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select, button")) return;
  if (event.key.toLowerCase() === "g") document.querySelector("#toggle-grid").click();
  if (event.key.toLowerCase() === "a") document.querySelector("#toggle-section").click();
  if (event.key === " ") {
    event.preventDefault();
    setPlayback(!isPlaying);
  }
});

load();
