const statusPill = document.getElementById("statusPill");
const gpuGrid = document.getElementById("gpuGrid");
const chatLog = document.getElementById("chatLog");
const chatForm = document.getElementById("chatForm");
const promptInput = document.getElementById("promptInput");
const runBtn = document.getElementById("runBtn");
const elapsedLabel = document.getElementById("elapsed");

const stepsInput = document.getElementById("stepsInput");
const guidanceInput = document.getElementById("guidanceInput");
const stepsValue = document.getElementById("stepsValue");
const guidanceValue = document.getElementById("guidanceValue");
const seedInput = document.getElementById("seedInput");
const randomSeedBtn = document.getElementById("randomSeedBtn");
const negPromptInput = document.getElementById("negPromptInput");
const baseSizeInput = document.getElementById("baseSizeInput");
const heightInput = document.getElementById("heightInput");
const widthInput = document.getElementById("widthInput");
const rewritePromptInput = document.getElementById("rewritePromptInput");
const rewriteGroup = document.getElementById("rewriteGroup");

const spatialModeInput = document.getElementById("spatialModeInput");
const spatialModeHelp = document.getElementById("spatialModeHelp");
const spatialObjectGroup = document.getElementById("spatialObjectGroup");
const spatialObjectInput = document.getElementById("spatialObjectInput");
const spatialGuideHelp = document.getElementById("spatialGuideHelp");
const spatialViewGroup = document.getElementById("spatialViewGroup");
const spatialViewInput = document.getElementById("spatialViewInput");
const spatialCameraGroup = document.getElementById("spatialCameraGroup");
const cameraYawInput = document.getElementById("cameraYawInput");
const cameraPitchInput = document.getElementById("cameraPitchInput");
const cameraZoomInput = document.getElementById("cameraZoomInput");
const spatialPromptPreview = document.getElementById("spatialPromptPreview");
const applySpatialPromptBtn = document.getElementById("applySpatialPromptBtn");
const spatialTemplateGroup = document.getElementById("spatialTemplateGroup");

const uploadSlot = document.getElementById("uploadSlot");
const uploadInputBtn = document.getElementById("uploadInputBtn");
const imageInput = document.getElementById("imageInput");
const inputStage = document.getElementById("inputStage");
const inputImage = document.getElementById("inputImage");
const inputPlaceholder = document.getElementById("inputPlaceholder");
const guideCanvas = document.getElementById("guideCanvas");
const toggleGuideBtn = document.getElementById("toggleGuideBtn");
const clearGuideBtn = document.getElementById("clearGuideBtn");
const clearInputBtn = document.getElementById("clearInputBtn");

const outputImage = document.getElementById("outputImage");
const outputPlaceholder = document.getElementById("outputPlaceholder");
const useAsInputBtn = document.getElementById("useAsInputBtn");
const downloadBtn = document.getElementById("downloadBtn");
const historyGrid = document.getElementById("historyGrid");

const matchAspectBtn = document.getElementById("matchAspectBtn");
const aspectHint = document.getElementById("aspectHint");
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightboxImage");
const lightboxClose = document.getElementById("lightboxClose");

const STORAGE_KEY = "joyai-web:form:v1";
const HISTORY_META_KEY = "joyai-web:history-meta:v1";
const HISTORY_META_LIMIT = 100;
const PROMPT_TOOLTIP_MAX = 60;
const ASPECT_SNAP = 64;
const ASPECT_MIN = 256;
const ASPECT_MAX = 2048;

function setOutputUrl(url) {
  currentOutputUrl = url;
  outputImage.src = url;
  outputImage.hidden = false;
  outputPlaceholder.hidden = true;
  useAsInputBtn.disabled = false;
  if (downloadBtn) {
    downloadBtn.href = url;
    downloadBtn.removeAttribute("aria-disabled");
  }
}

let isBusy = false;
let currentOutputUrl = null;
let currentInputObjectUrl = null;
let guideToolEnabled = false;
let guideRect = null;
let guideDraftRect = null;
let guidePointerId = null;
let guideStartPoint = null;

const GPU_POLL_MS = 3000;
const STATUS_POLL_MS = 4000;

stepsInput.addEventListener("input", () => {
  stepsValue.textContent = stepsInput.value;
});

guidanceInput.addEventListener("input", () => {
  guidanceValue.textContent = Number(guidanceInput.value).toFixed(1);
});

randomSeedBtn.addEventListener("click", () => {
  seedInput.value = Math.floor(Math.random() * 2_000_000_000);
});

function pushLog(line, isError = false) {
  const p = document.createElement("p");
  p.textContent = line;
  p.style.color = isError ? "#9d2c2c" : "inherit";
  chatLog.appendChild(p);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setBusy(active) {
  isBusy = active;
  runBtn.disabled = active;
  randomSeedBtn.disabled = active;
  uploadInputBtn.disabled = active;
  applySpatialPromptBtn.disabled = active;
  updateGuideUI();
  updateMatchAspectButton();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/* ---------- localStorage (form + history metadata) -------------------- */

const PERSISTED_FIELDS = [
  ["promptInput", promptInput],
  ["stepsInput", stepsInput],
  ["guidanceInput", guidanceInput],
  ["seedInput", seedInput],
  ["negPromptInput", negPromptInput],
  ["baseSizeInput", baseSizeInput],
  ["heightInput", heightInput],
  ["widthInput", widthInput],
  ["rewritePromptInput", rewritePromptInput],
  ["spatialModeInput", spatialModeInput],
  ["spatialObjectInput", spatialObjectInput],
  ["spatialViewInput", spatialViewInput],
  ["cameraYawInput", cameraYawInput],
  ["cameraPitchInput", cameraPitchInput],
  ["cameraZoomInput", cameraZoomInput],
];

function safeReadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage unavailable (private mode, quota) — best-effort only. */
  }
}

function serializeFormState() {
  const state = {};
  for (const [key, el] of PERSISTED_FIELDS) {
    if (!el) continue;
    state[key] = el.type === "checkbox" ? el.checked : el.value;
  }
  return state;
}

let savePending = null;
function scheduleSaveFormState() {
  if (savePending) return;
  savePending = setTimeout(() => {
    savePending = null;
    safeWriteJson(STORAGE_KEY, serializeFormState());
  }, 250);
}

function restoreFormState() {
  const state = safeReadJson(STORAGE_KEY, null);
  if (!state || typeof state !== "object") return;
  for (const [key, el] of PERSISTED_FIELDS) {
    if (!el || !(key in state)) continue;
    try {
      if (el.type === "checkbox") {
        el.checked = Boolean(state[key]);
      } else {
        el.value = state[key];
      }
    } catch {
      /* ignore unusable stored value */
    }
  }
  // Sync derived display widgets.
  stepsValue.textContent = stepsInput.value;
  guidanceValue.textContent = Number(guidanceInput.value).toFixed(1);
}

function loadHistoryMeta() {
  const meta = safeReadJson(HISTORY_META_KEY, {});
  return meta && typeof meta === "object" ? meta : {};
}

function saveHistoryMeta(meta) {
  const entries = Object.entries(meta);
  if (entries.length > HISTORY_META_LIMIT) {
    entries.sort((a, b) => (b[1]?.when || 0) - (a[1]?.when || 0));
    const trimmed = Object.fromEntries(entries.slice(0, HISTORY_META_LIMIT));
    safeWriteJson(HISTORY_META_KEY, trimmed);
    return;
  }
  safeWriteJson(HISTORY_META_KEY, meta);
}

function recordHistoryMeta(outputUrl, data) {
  if (!outputUrl) return;
  const filename = outputUrl.split("/").pop();
  if (!filename) return;
  const meta = loadHistoryMeta();
  meta[filename] = { ...data, when: Date.now() };
  saveHistoryMeta(meta);
}

/* ---------- Aspect snapping ------------------------------------------- */

function snapDimension(value) {
  const snapped = Math.round(value / ASPECT_SNAP) * ASPECT_SNAP;
  return clamp(snapped, ASPECT_MIN, ASPECT_MAX);
}

function computeAspectDimensions(aspectW, aspectH, base) {
  if (!aspectW || !aspectH || !base) return null;
  const ratio = aspectW / aspectH;
  let width;
  let height;
  if (ratio >= 1) {
    width = base * Math.sqrt(ratio);
    height = base / Math.sqrt(ratio);
  } else {
    width = base * Math.sqrt(ratio);
    height = base / Math.sqrt(ratio);
  }
  return {
    width: snapDimension(width),
    height: snapDimension(height),
  };
}

function simplifyRatio(w, h) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(Math.round(w), Math.round(h)) || 1;
  return `${Math.round(w / g)}:${Math.round(h / g)}`;
}

function updateMatchAspectButton() {
  const hasImage = Boolean(imageInput.files?.[0]) && inputImage.naturalWidth > 0 && inputImage.naturalHeight > 0;
  matchAspectBtn.disabled = !hasImage || isBusy;
  if (!hasImage) {
    aspectHint.hidden = true;
    aspectHint.textContent = "";
    return;
  }
  const ratio = simplifyRatio(inputImage.naturalWidth, inputImage.naturalHeight);
  aspectHint.hidden = false;
  aspectHint.textContent = `Input is ${inputImage.naturalWidth}×${inputImage.naturalHeight} (${ratio})`;
}

function applyMatchAspect() {
  if (!inputImage.naturalWidth || !inputImage.naturalHeight) return;
  const base = Number(baseSizeInput.value) || 1024;
  const dims = computeAspectDimensions(inputImage.naturalWidth, inputImage.naturalHeight, base);
  if (!dims) return;
  widthInput.value = dims.width;
  heightInput.value = dims.height;
  scheduleSaveFormState();
  const ratio = simplifyRatio(inputImage.naturalWidth, inputImage.naturalHeight);
  aspectHint.hidden = false;
  aspectHint.textContent = `${ratio} → ${dims.width} × ${dims.height}`;
}

/* ---------- Lightbox -------------------------------------------------- */

function openLightbox(src) {
  if (!src) return;
  lightboxImage.src = src;
  lightbox.hidden = false;
  document.body.classList.add("lightbox-open");
  lightboxClose.focus();
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImage.removeAttribute("src");
  document.body.classList.remove("lightbox-open");
}

function buildRectFromPoints(a, b) {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x, b.x);
  const y2 = Math.max(a.y, b.y);
  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  };
}

function updateGuideUI() {
  const moveMode = spatialModeInput.value === "move";
  const hasImage = Boolean(imageInput.files?.[0]);

  if (!moveMode) {
    guideToolEnabled = false;
    guidePointerId = null;
    guideDraftRect = null;
  }

  // Guide tooling is only meaningful in Object Move mode. Hide the two
  // dedicated icons entirely in every other mode so the input actions row
  // stays uncluttered (Clear-input stays visible regardless).
  toggleGuideBtn.hidden = !moveMode;
  clearGuideBtn.hidden = !moveMode;

  guideCanvas.hidden = !moveMode || !hasImage;
  toggleGuideBtn.disabled = !moveMode || !hasImage || isBusy;
  clearGuideBtn.disabled = !moveMode || !guideRect || isBusy;
  clearInputBtn.disabled = !hasImage || isBusy;

  // Preserve the inline SVG — update only class, aria-label and title.
  toggleGuideBtn.classList.toggle("is-drawing", guideToolEnabled);
  const toggleLabel = guideToolEnabled ? "Stop drawing" : "Draw red box";
  toggleGuideBtn.setAttribute("aria-label", toggleLabel);
  toggleGuideBtn.setAttribute(
    "title",
    guideToolEnabled ? "Stop drawing — click to finish" : "Draw red destination box",
  );
  toggleGuideBtn.setAttribute("aria-pressed", guideToolEnabled ? "true" : "false");

  uploadSlot.classList.toggle("guide-active", guideToolEnabled && moveMode);
  if (!guideCanvas.hidden) {
    syncGuideCanvas();
  } else {
    drawGuideCanvas();
  }
}

function clearGuideBox() {
  guideRect = null;
  guideDraftRect = null;
  guidePointerId = null;
  guideStartPoint = null;
  drawGuideCanvas();
  updateGuideUI();
}

function safeClearInput() {
  if (currentInputObjectUrl) {
    URL.revokeObjectURL(currentInputObjectUrl);
    currentInputObjectUrl = null;
  }

  imageInput.value = "";
  inputImage.hidden = true;
  inputImage.removeAttribute("src");
  inputStage.hidden = true;
  inputPlaceholder.hidden = false;
  guideToolEnabled = false;
  clearGuideBox();
  useAsInputBtn.disabled = !currentOutputUrl;
  updateGuideUI();
  updateMatchAspectButton();
}

function syncGuideCanvas() {
  if (guideCanvas.hidden || inputImage.hidden) {
    return;
  }

  const width = Math.round(inputImage.clientWidth);
  const height = Math.round(inputImage.clientHeight);
  if (!width || !height) {
    return;
  }

  // `input-stage` is a flex-centered box; the image sits centered inside with
  // `object-fit: contain`, which leaves letterbox bands on one axis. The
  // canvas must overlay ONLY the image — if we leave it pinned to the stage's
  // top-left (inset: 0 + explicit width/height), pointer events on the lower
  // band of a landscape image don't land on the canvas.
  const stageRect = inputStage.getBoundingClientRect();
  const imageRect = inputImage.getBoundingClientRect();
  const offsetX = Math.max(0, imageRect.left - stageRect.left);
  const offsetY = Math.max(0, imageRect.top - stageRect.top);

  const dpr = window.devicePixelRatio || 1;
  guideCanvas.width = Math.round(width * dpr);
  guideCanvas.height = Math.round(height * dpr);
  guideCanvas.style.width = `${width}px`;
  guideCanvas.style.height = `${height}px`;
  guideCanvas.style.left = `${offsetX}px`;
  guideCanvas.style.top = `${offsetY}px`;
  guideCanvas.style.right = "auto";
  guideCanvas.style.bottom = "auto";
  drawGuideCanvas();
}

function drawGuideRect(ctx, rect, options = {}) {
  if (!rect) {
    return;
  }

  const width = guideCanvas.clientWidth;
  const height = guideCanvas.clientHeight;
  // Thin, crisp 2px stroke — reads as a guide, not as a big red rectangle.
  const strokeWidth = 2;
  const inset = strokeWidth / 2;

  const x = rect.x * width;
  const y = rect.y * height;
  const boxWidth = rect.width * width;
  const boxHeight = rect.height * height;

  ctx.save();
  ctx.strokeStyle = options.color || "#ff2d20";
  ctx.lineWidth = strokeWidth;
  ctx.setLineDash(options.dashed ? [10, 6] : []);
  ctx.strokeRect(
    x + inset,
    y + inset,
    Math.max(boxWidth - strokeWidth, strokeWidth),
    Math.max(boxHeight - strokeWidth, strokeWidth),
  );
  ctx.restore();
}

function drawGuideCanvas() {
  if (guideCanvas.hidden) {
    return;
  }

  const ctx = guideCanvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = guideCanvas.clientWidth;
  const height = guideCanvas.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (guideRect) {
    drawGuideRect(ctx, guideRect);
  }
  if (guideDraftRect) {
    drawGuideRect(ctx, guideDraftRect, { color: "#ff6a61", dashed: true });
  }
}

function getNormalizedPointerPosition(event) {
  const rect = guideCanvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function finalizeGuideDraw(event) {
  if (guidePointerId !== event.pointerId || !guideStartPoint) {
    return;
  }

  const endPoint = getNormalizedPointerPosition(event);
  const rect = buildRectFromPoints(guideStartPoint, endPoint);
  if (rect.width >= 0.02 && rect.height >= 0.02) {
    guideRect = rect;
  } else {
    guideRect = null;
  }

  guideDraftRect = null;
  guidePointerId = null;
  guideStartPoint = null;
  drawGuideCanvas();
  updateGuideUI();
}

guideCanvas.addEventListener("pointerdown", (event) => {
  if (!guideToolEnabled || guideCanvas.hidden) {
    return;
  }
  event.preventDefault();
  guidePointerId = event.pointerId;
  guideStartPoint = getNormalizedPointerPosition(event);
  guideDraftRect = { x: guideStartPoint.x, y: guideStartPoint.y, width: 0, height: 0 };
  guideCanvas.setPointerCapture(event.pointerId);
  drawGuideCanvas();
});

guideCanvas.addEventListener("pointermove", (event) => {
  if (guidePointerId !== event.pointerId || !guideStartPoint) {
    return;
  }
  const currentPoint = getNormalizedPointerPosition(event);
  guideDraftRect = buildRectFromPoints(guideStartPoint, currentPoint);
  drawGuideCanvas();
});

guideCanvas.addEventListener("pointerup", finalizeGuideDraw);
guideCanvas.addEventListener("pointercancel", () => {
  guideDraftRect = null;
  guidePointerId = null;
  guideStartPoint = null;
  drawGuideCanvas();
  updateGuideUI();
});

function openImagePicker() {
  imageInput.click();
}

uploadInputBtn.addEventListener("click", openImagePicker);
uploadSlot.addEventListener("click", () => {
  if (!imageInput.files?.[0] && !isBusy) {
    openImagePicker();
  }
});
uploadSlot.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && !imageInput.files?.[0] && !isBusy) {
    event.preventDefault();
    openImagePicker();
  }
});

clearInputBtn.addEventListener("click", safeClearInput);
clearGuideBtn.addEventListener("click", clearGuideBox);
toggleGuideBtn.addEventListener("click", () => {
  if (toggleGuideBtn.disabled) {
    return;
  }
  guideToolEnabled = !guideToolEnabled;
  guideDraftRect = null;
  guidePointerId = null;
  guideStartPoint = null;
  updateGuideUI();
});

function displayInputPreview() {
  const file = imageInput.files?.[0];
  if (!file) {
    safeClearInput();
    return;
  }

  if (currentInputObjectUrl) {
    URL.revokeObjectURL(currentInputObjectUrl);
  }
  currentInputObjectUrl = URL.createObjectURL(file);

  clearGuideBox();
  inputImage.onload = () => {
    inputStage.hidden = false;
    inputImage.hidden = false;
    inputPlaceholder.hidden = true;
    syncGuideCanvas();
    updateGuideUI();
    updateMatchAspectButton();
  };
  inputImage.src = currentInputObjectUrl;
}

imageInput.addEventListener("change", displayInputPreview);
window.addEventListener("resize", syncGuideCanvas);

/* ---------- Drag-and-drop upload -------------------------------------- */

function acceptDroppedFile(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) {
    pushLog("Only image files can be dropped here.", true);
    return;
  }
  const dt = new DataTransfer();
  dt.items.add(file);
  imageInput.files = dt.files;
  displayInputPreview();
}

["dragenter", "dragover"].forEach((eventName) => {
  uploadSlot.addEventListener(eventName, (event) => {
    if (isBusy) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    uploadSlot.classList.add("is-dragover");
  });
});

["dragleave", "dragend"].forEach((eventName) => {
  uploadSlot.addEventListener(eventName, (event) => {
    // `dragleave` fires when entering a child — guard by checking relatedTarget.
    if (eventName === "dragleave" && uploadSlot.contains(event.relatedTarget)) {
      return;
    }
    uploadSlot.classList.remove("is-dragover");
  });
});

uploadSlot.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  uploadSlot.classList.remove("is-dragover");
  if (isBusy) return;
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  acceptDroppedFile(file);
});

// Block the browser's default "open as tab" behaviour if a drop misses the slot.
["dragover", "drop"].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    if (event.target === uploadSlot || uploadSlot.contains(event.target)) return;
    event.preventDefault();
  });
});

/* ---------- Match-aspect + baseSize -------------------------------- */

matchAspectBtn.addEventListener("click", applyMatchAspect);
baseSizeInput.addEventListener("change", () => {
  if (imageInput.files?.[0] && inputImage.naturalWidth) {
    applyMatchAspect();
  }
});

useAsInputBtn.addEventListener("click", async () => {
  if (!currentOutputUrl) {
    return;
  }
  const response = await fetch(currentOutputUrl);
  if (!response.ok) {
    pushLog("Could not load output image to use as input.", true);
    return;
  }
  const blob = await response.blob();
  const file = new File([blob], "from-output.png", { type: "image/png" });
  const dt = new DataTransfer();
  dt.items.add(file);
  imageInput.files = dt.files;
  displayInputPreview();
});

/* ---------- Lightbox wiring ------------------------------------------ */

outputImage.addEventListener("click", () => {
  if (outputImage.hidden || !currentOutputUrl) return;
  openLightbox(currentOutputUrl);
});

lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) {
    closeLightbox();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !lightbox.hidden) {
    event.preventDefault();
    closeLightbox();
  }
});

/* ---------- Cmd/Ctrl+Enter to submit --------------------------------- */

promptInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    if (!isBusy) {
      chatForm.requestSubmit();
    }
  }
});

function buildSpatialPrompt() {
  const mode = spatialModeInput.value;
  const targetObject = spatialObjectInput.value.trim();

  if (mode === "move") {
    if (!targetObject) {
      return "";
    }
    return `Move the ${targetObject} into the red box and finally remove the red box.`;
  }

  if (mode === "rotate") {
    if (!targetObject) {
      return "";
    }
    return `Rotate the ${targetObject} to show the ${spatialViewInput.value} side view.`;
  }

  if (mode === "camera") {
    const yaw = Number(cameraYawInput.value || 0);
    const pitch = Number(cameraPitchInput.value || 0);
    return [
      "Move the camera.",
      `- Camera rotation: Yaw ${yaw}°, Pitch ${pitch}°.`,
      `- Camera zoom: ${cameraZoomInput.value}.`,
      "- Keep the 3D scene static; only change the viewpoint.",
    ].join("\n");
  }

  return "";
}

function updateSpatialPromptPreview() {
  spatialPromptPreview.value = buildSpatialPrompt();
}

function updateSpatialUI() {
  const mode = spatialModeInput.value;
  const objectMode = mode === "move" || mode === "rotate";

  spatialObjectGroup.hidden = !objectMode;
  spatialViewGroup.hidden = mode !== "rotate";
  spatialGuideHelp.hidden = mode !== "move";
  spatialCameraGroup.hidden = mode !== "camera";
  spatialTemplateGroup.hidden = mode === "none";
  // LLM rewrite is irrelevant (and likely harmful) when we're sending a
  // canonical JoyAI spatial-mode template — hide it entirely in those modes.
  // The checkbox's own state is preserved so Free Edit remembers it.
  rewriteGroup.hidden = mode !== "none";

  if (mode === "move") {
    spatialModeHelp.textContent =
      "Object Move follows JoyAI's red-box workflow. Draw the target box on the input image and keep the template wording intact.";
  } else if (mode === "rotate") {
    spatialModeHelp.textContent =
      "Object Rotation is the right spatial mode when you want to turn only one object, like the table in the middle, while keeping the rest of the scene as stable as possible.";
  } else if (mode === "camera") {
    spatialModeHelp.textContent =
      "Camera Control changes the viewpoint while telling JoyAI to keep the 3D scene itself static.";
  } else {
    spatialModeHelp.textContent =
      "Use Free Edit for ordinary prompt-based changes. The modes below follow JoyAI's documented spatial prompt patterns.";
  }

  updateSpatialPromptPreview();
  updateGuideUI();
}

spatialModeInput.addEventListener("change", updateSpatialUI);
spatialObjectInput.addEventListener("input", updateSpatialPromptPreview);
spatialViewInput.addEventListener("change", updateSpatialPromptPreview);
cameraYawInput.addEventListener("input", updateSpatialPromptPreview);
cameraPitchInput.addEventListener("input", updateSpatialPromptPreview);
cameraZoomInput.addEventListener("change", updateSpatialPromptPreview);

applySpatialPromptBtn.addEventListener("click", () => {
  const template = buildSpatialPrompt().trim();
  if (!template) {
    pushLog("Complete the spatial controls first.", true);
    return;
  }
  promptInput.value = template;
  promptInput.focus();
});

function renderGpuTelemetry(data) {
  if (!data?.available || !Array.isArray(data.gpus) || data.gpus.length === 0) {
    gpuGrid.innerHTML = `<p class="muted">${data?.error || "GPU telemetry unavailable."}</p>`;
    return;
  }

  gpuGrid.innerHTML = "";
  for (const gpu of data.gpus) {
    const card = document.createElement("article");
    card.className = "gpu-card";
    card.title = `GPU ${gpu.index} — ${gpu.name}\nCompute: ${gpu.gpu_utilization}%\nVRAM: ${(gpu.memory_used_mib / 1024).toFixed(1)} / ${(gpu.memory_total_mib / 1024).toFixed(1)} GiB\nMem util: ${gpu.memory_utilization}%\nTemp: ${gpu.temperature_c}°C`;
    card.style.setProperty("--_util", `${gpu.gpu_utilization}%`);

    const title = document.createElement("strong");
    title.textContent = `GPU ${gpu.index}`;

    const metrics = document.createElement("div");
    metrics.className = "gpu-metrics";
    metrics.innerHTML = `
      <div><span>Util</span>${gpu.gpu_utilization}%</div>
      <div><span>VRAM</span>${(gpu.memory_used_mib / 1024).toFixed(1)} / ${(gpu.memory_total_mib / 1024).toFixed(1)} GiB</div>
      <div><span>Mem util</span>${gpu.memory_utilization}%</div>
      <div><span>Temp</span>${gpu.temperature_c}°C</div>
    `;

    card.appendChild(title);
    card.appendChild(metrics);
    gpuGrid.appendChild(card);
  }
}

async function pollStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    if (data.ready) {
      const worldSize = data.world_size && data.world_size > 1 ? ` • ${data.world_size} ranks` : "";
      statusPill.textContent = `Ready • ${data.device || "cpu"}${worldSize}`;
      statusPill.className = "status status-online";
    } else {
      statusPill.textContent = data.error ? `Error: ${data.error}` : "Model loading…";
      statusPill.className = data.error ? "status status-error" : "status";
    }
  } catch (error) {
    statusPill.textContent = "Offline";
    statusPill.className = "status status-error";
  }
}

async function pollGpu() {
  try {
    const response = await fetch("/api/gpu");
    const data = await response.json();
    renderGpuTelemetry(data);
  } catch (error) {
    gpuGrid.innerHTML = "<p class=\"muted\">GPU telemetry unavailable.</p>";
  }
}

function truncate(text, limit) {
  if (!text) return "";
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

function formatHistoryTooltip(filename, meta) {
  if (!meta) return filename;
  const lines = [];
  if (meta.prompt) lines.push(meta.prompt);
  const stats = [];
  if (meta.seed !== undefined && meta.seed !== null) stats.push(`seed ${meta.seed}`);
  if (meta.steps) stats.push(`${meta.steps} steps`);
  if (meta.cfg !== undefined && meta.cfg !== null) stats.push(`cfg ${Number(meta.cfg).toFixed(1)}`);
  if (meta.width && meta.height) stats.push(`${meta.width}×${meta.height}`);
  if (stats.length) lines.push(stats.join(" · "));
  if (meta.when) {
    const d = new Date(meta.when);
    if (!Number.isNaN(d.getTime())) lines.push(d.toLocaleString());
  }
  lines.push(filename);
  return lines.join("\n");
}

async function loadHistory() {
  try {
    const response = await fetch("/api/history");
    const items = await response.json();
    if (!Array.isArray(items) || items.length === 0) {
      historyGrid.textContent = "No outputs yet.";
      return;
    }

    const meta = loadHistoryMeta();

    historyGrid.innerHTML = "";
    for (const item of items) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "history-item";

      const info = meta[item.name];
      card.title = formatHistoryTooltip(item.name, info);

      const img = document.createElement("img");
      img.src = item.url;
      img.alt = info?.prompt ? truncate(info.prompt, PROMPT_TOOLTIP_MAX) : item.name;

      const caption = document.createElement("p");
      caption.textContent = info?.prompt ? truncate(info.prompt, PROMPT_TOOLTIP_MAX) : item.name;

      card.appendChild(img);
      card.appendChild(caption);
      card.addEventListener("click", () => {
        setOutputUrl(item.url);
      });
      historyGrid.appendChild(card);
    }
  } catch (error) {
    historyGrid.textContent = "Could not load output history.";
  }
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read the input image."));
    };
    image.src = objectUrl;
  });
}

async function buildGuidedImageFile(sourceFile) {
  const image = await loadImageFromFile(sourceFile);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);

  const strokeWidth = Math.max(6, Math.round(Math.max(canvas.width, canvas.height) * 0.01));
  const inset = strokeWidth / 2;
  const x = guideRect.x * canvas.width;
  const y = guideRect.y * canvas.height;
  const width = guideRect.width * canvas.width;
  const height = guideRect.height * canvas.height;

  ctx.strokeStyle = "#ff2d20";
  ctx.lineWidth = strokeWidth;
  ctx.strokeRect(
    x + inset,
    y + inset,
    Math.max(width - strokeWidth, strokeWidth),
    Math.max(height - strokeWidth, strokeWidth),
  );

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) {
    throw new Error("Could not draw the red guide box.");
  }

  const basename = sourceFile.name.replace(/\.[^.]+$/, "") || "input";
  return new File([blob], `${basename}-guide.png`, { type: "image/png" });
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isBusy) {
    return;
  }

  let prompt = promptInput.value.trim();
  const spatialPrompt = buildSpatialPrompt().trim();
  const spatialMode = spatialModeInput.value;
  const inputFile = imageInput.files?.[0] || null;

  if (!prompt && spatialPrompt) {
    prompt = spatialPrompt;
    promptInput.value = prompt;
  }

  if (!prompt) {
    pushLog("Prompt is required.", true);
    return;
  }

  if (spatialMode !== "none" && !inputFile) {
    pushLog("Spatial editing modes require an input image.", true);
    return;
  }

  if (spatialMode === "move" && !guideRect) {
    pushLog("Object Move mode requires a red box on the input image.", true);
    return;
  }

  // Rewrite is a no-op for canonical spatial templates — never send it on.
  const rewriteRequested = rewritePromptInput.checked && spatialMode === "none";

  setBusy(true);
  const startedAt = performance.now();

  // Live timer — tick every 100ms so the user sees progress instead of a
  // motionless "Running…" label. Cleared in `finally` below.
  elapsedLabel.classList.add("is-running");
  elapsedLabel.textContent = "Running · 0.0s";
  const timerHandle = setInterval(() => {
    const secs = ((performance.now() - startedAt) / 1000).toFixed(1);
    elapsedLabel.textContent = `Running · ${secs}s`;
  }, 100);

  // Capture the prompt we're actually sending so we can diff against the
  // server's (possibly-rewritten) reply afterwards.
  const submittedPrompt = prompt;

  try {
    const fd = new FormData();
    fd.append("prompt", submittedPrompt);
    fd.append("steps", stepsInput.value);
    fd.append("guidance_scale", guidanceInput.value);
    fd.append("seed", seedInput.value);
    fd.append("neg_prompt", negPromptInput.value || "");
    fd.append("basesize", baseSizeInput.value);
    fd.append("height", heightInput.value);
    fd.append("width", widthInput.value);
    fd.append("rewrite_prompt", rewriteRequested ? "true" : "false");

    if (inputFile) {
      const fileToUpload = spatialMode === "move" ? await buildGuidedImageFile(inputFile) : inputFile;
      fd.append("image", fileToUpload);
    }

    const response = await fetch("/api/edit", { method: "POST", body: fd });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.detail || "Request failed.");
    }

    setOutputUrl(result.output_url);

    const finalPrompt = (result.prompt || "").trim();
    if (rewriteRequested && finalPrompt && finalPrompt !== submittedPrompt) {
      pushLog(`LLM rewrote → ${finalPrompt}`);
    } else if (rewriteRequested && finalPrompt === submittedPrompt) {
      pushLog("LLM rewrite returned your prompt unchanged (or OPENAI_API_KEY is not set).");
    }
    pushLog(`Done in ${result.elapsed_seconds}s.`);
    pushLog(`Saved output: ${result.output_url}`);

    // Persist prompt/seed/cfg/steps alongside the filename so the history
    // thumbnails can show rich tooltips instead of an opaque filename.
    recordHistoryMeta(result.output_url, {
      prompt: finalPrompt || submittedPrompt,
      submittedPrompt,
      seed: result.seed ?? Number(seedInput.value),
      steps: Number(stepsInput.value),
      cfg: Number(guidanceInput.value),
      baseSize: Number(baseSizeInput.value),
      height: Number(heightInput.value),
      width: Number(widthInput.value),
      spatialMode,
      rewriteRequested,
    });

    await loadHistory();
  } catch (error) {
    pushLog(error.message || "Unknown error", true);
  } finally {
    clearInterval(timerHandle);
    elapsedLabel.classList.remove("is-running");
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
    elapsedLabel.textContent = `${elapsed}s`;
    setBusy(false);
    updateGuideUI();
  }
});

// Persist form state: save on any user edit (debounced), restore on load.
for (const [, el] of PERSISTED_FIELDS) {
  if (!el) continue;
  const eventName = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
  el.addEventListener(eventName, scheduleSaveFormState);
}

restoreFormState();
updateSpatialUI();
updateMatchAspectButton();
pollStatus();
pollGpu();
loadHistory();
setInterval(pollStatus, STATUS_POLL_MS);
setInterval(pollGpu, GPU_POLL_MS);
