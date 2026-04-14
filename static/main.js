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

const uploadSlot = document.getElementById("uploadSlot");
const uploadInputBtn = document.getElementById("uploadInputBtn");
const imageInput = document.getElementById("imageInput");
const inputStage = document.getElementById("inputStage");
const inputImage = document.getElementById("inputImage");
const inputPlaceholder = document.getElementById("inputPlaceholder");
const guideCanvas = document.getElementById("guideCanvas");
const guideStatus = document.getElementById("guideStatus");
const toggleGuideBtn = document.getElementById("toggleGuideBtn");
const clearGuideBtn = document.getElementById("clearGuideBtn");
const clearInputBtn = document.getElementById("clearInputBtn");

const outputImage = document.getElementById("outputImage");
const outputPlaceholder = document.getElementById("outputPlaceholder");
const useAsInputBtn = document.getElementById("useAsInputBtn");
const historyGrid = document.getElementById("historyGrid");

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
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

function getGuideStatusText() {
  const mode = spatialModeInput.value;
  const hasImage = Boolean(imageInput.files?.[0]);
  if (mode !== "move") {
    return "Red box guidance is only used for Object Move.";
  }
  if (!hasImage) {
    return "Upload an image, then draw the red destination box.";
  }
  if (guideToolEnabled) {
    return "Drag on the image to place the red box.";
  }
  if (guideRect) {
    return "Red box ready.";
  }
  return "No red box yet.";
}

function updateGuideUI() {
  const moveMode = spatialModeInput.value === "move";
  const hasImage = Boolean(imageInput.files?.[0]);

  if (!moveMode) {
    guideToolEnabled = false;
    guidePointerId = null;
    guideDraftRect = null;
  }

  guideCanvas.hidden = !moveMode || !hasImage;
  toggleGuideBtn.disabled = !moveMode || !hasImage || isBusy;
  clearGuideBtn.disabled = !moveMode || !guideRect || isBusy;
  clearInputBtn.disabled = !hasImage || isBusy;
  toggleGuideBtn.textContent = guideToolEnabled ? "Stop drawing" : "Draw red box";
  uploadSlot.classList.toggle("guide-active", guideToolEnabled && moveMode);
  guideStatus.textContent = getGuideStatusText();
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

  const dpr = window.devicePixelRatio || 1;
  guideCanvas.width = Math.round(width * dpr);
  guideCanvas.height = Math.round(height * dpr);
  guideCanvas.style.width = `${width}px`;
  guideCanvas.style.height = `${height}px`;
  drawGuideCanvas();
}

function drawGuideRect(ctx, rect, options = {}) {
  if (!rect) {
    return;
  }

  const width = guideCanvas.clientWidth;
  const height = guideCanvas.clientHeight;
  const strokeWidth = Math.max(3, Math.round(Math.max(width, height) * 0.01));
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
  };
  inputImage.src = currentInputObjectUrl;
}

imageInput.addEventListener("change", displayInputPreview);
window.addEventListener("resize", syncGuideCanvas);

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

    const title = document.createElement("strong");
    title.textContent = `GPU ${gpu.index} • ${gpu.name}`;

    const metrics = document.createElement("div");
    metrics.className = "gpu-metrics";
    metrics.innerHTML = `
      <div><span>Compute</span>${gpu.gpu_utilization}%</div>
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

async function loadHistory() {
  try {
    const response = await fetch("/api/history");
    const items = await response.json();
    if (!Array.isArray(items) || items.length === 0) {
      historyGrid.textContent = "No outputs yet.";
      return;
    }

    historyGrid.innerHTML = "";
    for (const item of items) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "history-item";

      const img = document.createElement("img");
      img.src = item.url;
      img.alt = item.name;

      const caption = document.createElement("p");
      caption.title = item.name;
      caption.textContent = item.name;

      card.appendChild(img);
      card.appendChild(caption);
      card.addEventListener("click", () => {
        outputImage.src = item.url;
        outputImage.hidden = false;
        outputPlaceholder.hidden = true;
        currentOutputUrl = item.url;
        useAsInputBtn.disabled = false;
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

  setBusy(true);
  elapsedLabel.textContent = "Running…";
  const startedAt = performance.now();

  try {
    const fd = new FormData();
    fd.append("prompt", prompt);
    fd.append("steps", stepsInput.value);
    fd.append("guidance_scale", guidanceInput.value);
    fd.append("seed", seedInput.value);
    fd.append("neg_prompt", negPromptInput.value || "");
    fd.append("basesize", baseSizeInput.value);
    fd.append("height", heightInput.value);
    fd.append("width", widthInput.value);
    fd.append("rewrite_prompt", rewritePromptInput.checked ? "true" : "false");

    if (inputFile) {
      const fileToUpload = spatialMode === "move" ? await buildGuidedImageFile(inputFile) : inputFile;
      fd.append("image", fileToUpload);
    }

    const response = await fetch("/api/edit", { method: "POST", body: fd });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.detail || "Request failed.");
    }

    outputImage.src = result.output_url;
    outputImage.hidden = false;
    outputPlaceholder.hidden = true;
    currentOutputUrl = result.output_url;
    useAsInputBtn.disabled = false;

    pushLog(`Done (${result.elapsed_seconds}s): ${result.prompt}`);
    pushLog(`Saved output: ${result.output_url}`);
    await loadHistory();
  } catch (error) {
    pushLog(error.message || "Unknown error", true);
  } finally {
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
    elapsedLabel.textContent = `${elapsed}s`;
    setBusy(false);
    updateGuideUI();
  }
});

updateSpatialUI();
pollStatus();
pollGpu();
loadHistory();
setInterval(pollStatus, STATUS_POLL_MS);
setInterval(pollGpu, GPU_POLL_MS);
