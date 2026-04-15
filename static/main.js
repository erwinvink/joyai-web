/* ======================================================================
   JoyAI · Image — Local Workbench (front-end)

   Layout: single-column workbench. Mode bar sits above the prompt and owns
   mode-specific inputs (object, view, camera), plus Size and Preset chips.
   Technical parameters (steps, guidance, seed, rewrite, basesize) live in
   named presets persisted to localStorage. The negative prompt remains
   inline because it changes often.
   ====================================================================== */

/* ------------- DOM ------------------------------------------------------- */

// Topbar / status / GPU
const statusPill   = document.getElementById("statusPill");
const gpuGrid      = document.getElementById("gpuGrid");

// Workbench wrapper (for is-t2i class)
const workbench    = document.getElementById("workbench");

// Chat / prompt
const chatLog      = document.getElementById("chatLog");
const chatForm     = document.getElementById("chatForm");
const promptInput  = document.getElementById("promptInput");
const negPromptInput = document.getElementById("negPromptInput");
const runBtn       = document.getElementById("runBtn");
const elapsedLabel = document.getElementById("elapsed");
const promptDirtyRow = document.getElementById("promptDirtyRow");
const resetPromptBtn = document.getElementById("resetPromptBtn");

// Mode bar
const spatialModeInput = document.getElementById("spatialModeInput");
const spatialModeHelp  = document.getElementById("spatialModeHelp");
const spatialObjectGroup = document.getElementById("spatialObjectGroup");
const spatialObjectInput = document.getElementById("spatialObjectInput");
const spatialViewGroup   = document.getElementById("spatialViewGroup");
const spatialViewInput   = document.getElementById("spatialViewInput");
const spatialCameraGroup = document.getElementById("spatialCameraGroup");
const cameraYawInput     = document.getElementById("cameraYawInput");
const cameraPitchInput   = document.getElementById("cameraPitchInput");
const cameraZoomInput    = document.getElementById("cameraZoomInput");

// Size chip / popover
const sizeBtn       = document.getElementById("sizeBtn");
const sizeBtnValue  = document.getElementById("sizeBtnValue");
const sizePopover   = document.getElementById("sizePopover");

// Preset chip / popover
const presetBtn      = document.getElementById("presetBtn");
const presetBtnValue = document.getElementById("presetBtnValue");
const presetPopover  = document.getElementById("presetPopover");

// Preset slide-over panel
const presetPanel      = document.getElementById("presetPanel");
const presetPanelClose = document.getElementById("presetPanelClose");
const presetList       = document.getElementById("presetList");
const presetNewBtn     = document.getElementById("presetNewBtn");
const presetResetBtn   = document.getElementById("presetResetBtn");
const pe_name       = document.getElementById("pe_name");
const pe_steps      = document.getElementById("pe_steps");
const pe_stepsValue = document.getElementById("pe_stepsValue");
const pe_guidance   = document.getElementById("pe_guidance");
const pe_guidanceValue = document.getElementById("pe_guidanceValue");
const pe_basesize   = document.getElementById("pe_basesize");
const pe_randomSeed = document.getElementById("pe_randomSeed");
const pe_seed       = document.getElementById("pe_seed");
const pe_rewrite    = document.getElementById("pe_rewrite");
const pe_setDefault = document.getElementById("pe_setDefault");
const pe_duplicate  = document.getElementById("pe_duplicate");
const pe_delete     = document.getElementById("pe_delete");

// Input / output cards
const uploadSlot     = document.getElementById("uploadSlot");
const uploadInputBtn = document.getElementById("uploadInputBtn");
const imageInput     = document.getElementById("imageInput");
const inputStage     = document.getElementById("inputStage");
const inputImage     = document.getElementById("inputImage");
const inputPlaceholder = document.getElementById("inputPlaceholder");
const guideCanvas    = document.getElementById("guideCanvas");
const toggleGuideBtn = document.getElementById("toggleGuideBtn");
const clearGuideBtn  = document.getElementById("clearGuideBtn");
const clearInputBtn  = document.getElementById("clearInputBtn");

const outputImage       = document.getElementById("outputImage");
const outputPlaceholder = document.getElementById("outputPlaceholder");
const useAsInputBtn     = document.getElementById("useAsInputBtn");
const downloadBtn       = document.getElementById("downloadBtn");
const historyGrid       = document.getElementById("historyGrid");

// Lightbox
const lightbox      = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightboxImage");
const lightboxClose = document.getElementById("lightboxClose");

/* ------------- Constants ----------------------------------------------- */

const GPU_POLL_MS    = 3000;
const STATUS_POLL_MS = 4000;
const PROMPT_TOOLTIP_MAX = 60;

const FORM_KEY   = "joyai-web:form:v2";
const HIST_KEY   = "joyai-web:history-meta:v1";
const HIST_LIMIT = 100;
const PRESETS_KEY = "joyai-web:presets:v1";

const BASE_SIZES = [256, 512, 768, 1024];

const FACTORY_PRESETS = () => ({
  default: "quality",
  presets: [
    { id: "fast",    name: "Fast",    steps: 25, guidance: 4.0, seed: 42, randomSeed: true,  rewrite: true, basesize: 1024 },
    { id: "quality", name: "Quality", steps: 60, guidance: 6.0, seed: 42, randomSeed: false, rewrite: true, basesize: 1024 },
  ],
});

const T2I_ASPECTS = {
  "square1024":  { label: "Square 1024",     w: 1024, h: 1024 },
  "square768":   { label: "Square 768",      w: 768,  h: 768  },
  "portrait34":  { label: "Portrait 3:4",    w: 768,  h: 1024 },
  "landscape43": { label: "Landscape 4:3",   w: 1024, h: 768  },
  "custom":      { label: "Custom",          w: 1024, h: 1024 },
};

/* ------------- State --------------------------------------------------- */

let isBusy = false;
let currentOutputUrl = null;
let currentInputObjectUrl = null;

// Guide / red-box state (Object Move)
let guideToolEnabled = false;
let guideRect = null;
let guideDraftRect = null;
let guidePointerId = null;
let guideStartPoint = null;

// Prompt auto-fill / dirty tracking
let currentMode = "none";
let promptDirty = false;
let settingPromptProgrammatically = false;
let lastTemplateApplied = ""; // for detecting "did user actually change it?"

// Size (session overrides — sync from preset but can be tweaked per-run)
let sessionBasesize = 1024;
let sessionT2IAspect = "square1024";
let sessionT2ICustom = { w: 1024, h: 1024 };

// Preset state
let presetsState = loadPresets();
let editingPresetId = null; // id currently shown in the slide-over edit pane

/* ------------- Utilities ---------------------------------------------- */

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

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
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private */ }
}

function uid(prefix = "p") {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

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
  uploadInputBtn.disabled = active;
  updateGuideUI();
}

/* ------------- Presets ------------------------------------------------ */

function loadPresets() {
  const stored = safeReadJson(PRESETS_KEY, null);
  if (!stored || !Array.isArray(stored.presets) || stored.presets.length === 0) {
    const factory = FACTORY_PRESETS();
    safeWriteJson(PRESETS_KEY, factory);
    return factory;
  }
  return stored;
}

function savePresets() {
  safeWriteJson(PRESETS_KEY, presetsState);
}

function getActivePresetId() {
  const id = presetsState.default;
  return presetsState.presets.some(p => p.id === id) ? id : presetsState.presets[0]?.id;
}

function getActivePreset() {
  const id = getActivePresetId();
  return presetsState.presets.find(p => p.id === id) || presetsState.presets[0];
}

function getPreset(id) {
  return presetsState.presets.find(p => p.id === id) || null;
}

function setActivePresetId(id) {
  if (!getPreset(id)) return;
  presetsState.default = id;
  savePresets();
  // Sync session basesize from newly active preset.
  const p = getActivePreset();
  if (p) sessionBasesize = p.basesize || 1024;
  updatePresetChip();
  updateSizeChip();
}

/* ------------- Prompt templates --------------------------------------- */

function buildTemplateForMode() {
  const mode = currentMode;
  const targetObject = spatialObjectInput.value.trim();

  if (mode === "move") {
    if (!targetObject) return "";
    return `Move the ${targetObject} into the red box and finally remove the red box.`;
  }
  if (mode === "rotate") {
    if (!targetObject) return "";
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

function setPromptValue(value) {
  settingPromptProgrammatically = true;
  promptInput.value = value;
  settingPromptProgrammatically = false;
  lastTemplateApplied = value;
  promptDirty = false;
  updateDirtyRow();
}

function applyTemplateToPrompt({ force = false } = {}) {
  const template = buildTemplateForMode();
  if (!template) {
    // Free Edit or T2I — no template. Don't touch prompt on mode-input changes.
    return;
  }
  if (!force && promptDirty) {
    // User has edits — leave prompt alone, show reset link.
    updateDirtyRow();
    return;
  }
  setPromptValue(template);
}

function updateDirtyRow() {
  const templated = currentMode === "move" || currentMode === "rotate" || currentMode === "camera";
  promptDirtyRow.hidden = !(templated && promptDirty && lastTemplateApplied);
}

/* ------------- Mode UI ------------------------------------------------ */

function updateModeUI() {
  const mode = currentMode;
  const isT2I = mode === "t2i";
  const isMove = mode === "move";
  const isRotate = mode === "rotate";
  const isCamera = mode === "camera";
  const isFree = mode === "none";

  // Inline mode inputs
  spatialObjectGroup.hidden = !(isMove || isRotate);
  spatialViewGroup.hidden = !isRotate;
  spatialCameraGroup.hidden = !isCamera;

  // Mode help text
  if (isMove) {
    spatialModeHelp.textContent =
      "Draw a red destination box on the input image. The template will be sent as-is.";
  } else if (isRotate) {
    spatialModeHelp.textContent =
      "Turn one object to a canonical view while keeping the rest of the scene stable.";
  } else if (isCamera) {
    spatialModeHelp.textContent =
      "Change the viewpoint while keeping the 3D scene itself static.";
  } else if (isT2I) {
    spatialModeHelp.textContent =
      "Generate an image from text only. No input image required.";
  } else {
    spatialModeHelp.textContent = "";
  }

  // T2I layout switch
  workbench.classList.toggle("is-t2i", isT2I);

  // Submit button copy
  runBtn.textContent = isT2I ? "Generate" : "Run";

  // Placeholder copy tweak for T2I
  if (isT2I) {
    promptInput.placeholder = "e.g. a quiet Dutch canal at golden hour, oil painting style…";
  } else {
    promptInput.placeholder = "e.g. replace the sofa with a bronze velvet chaise, keep the morning light…";
  }

  updateGuideUI();
  updateSizeChip();
  updateDirtyRow();
}

function onModeChange(newMode) {
  currentMode = newMode;

  // Changing modes is an explicit reset — template (if any) re-applies.
  promptDirty = false;
  lastTemplateApplied = "";

  // T2I: clear any input image.
  if (newMode === "t2i") {
    safeClearInput();
  }

  updateModeUI();
  applyTemplateToPrompt({ force: true });
  scheduleSaveFormState();
}

spatialModeInput.addEventListener("change", () => onModeChange(spatialModeInput.value));

spatialObjectInput.addEventListener("input", () => { applyTemplateToPrompt(); scheduleSaveFormState(); });
spatialViewInput.addEventListener("change", () => { applyTemplateToPrompt(); scheduleSaveFormState(); });
cameraYawInput.addEventListener("input", () => { applyTemplateToPrompt(); scheduleSaveFormState(); });
cameraPitchInput.addEventListener("input", () => { applyTemplateToPrompt(); scheduleSaveFormState(); });
cameraZoomInput.addEventListener("change", () => { applyTemplateToPrompt(); scheduleSaveFormState(); });

promptInput.addEventListener("input", () => {
  if (settingPromptProgrammatically) return;
  promptDirty = true;
  updateDirtyRow();
});

resetPromptBtn.addEventListener("click", () => {
  applyTemplateToPrompt({ force: true });
});

/* ------------- Size chip / popover ------------------------------------ */

function t2iAspectLabel() {
  if (sessionT2IAspect === "custom") {
    return `Custom ${sessionT2ICustom.w}×${sessionT2ICustom.h}`;
  }
  return T2I_ASPECTS[sessionT2IAspect]?.label || "Square 1024";
}

function updateSizeChip() {
  if (currentMode === "t2i") {
    sizeBtnValue.textContent = t2iAspectLabel();
  } else {
    sizeBtnValue.textContent = String(sessionBasesize);
  }
}

function buildSizePopover() {
  sizePopover.innerHTML = "";
  if (currentMode === "t2i") {
    const title = document.createElement("div");
    title.className = "popover-title";
    title.textContent = "Aspect";
    sizePopover.appendChild(title);

    for (const key of ["square1024", "square768", "portrait34", "landscape43"]) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "popover-row" + (sessionT2IAspect === key ? " is-active" : "");
      row.innerHTML = `<span class="row-mark"></span><span class="row-label">${T2I_ASPECTS[key].label}</span><span class="row-badge">${T2I_ASPECTS[key].w}×${T2I_ASPECTS[key].h}</span>`;
      row.addEventListener("click", () => {
        sessionT2IAspect = key;
        updateSizeChip();
        closePopovers();
      });
      sizePopover.appendChild(row);
    }

    const customRow = document.createElement("button");
    customRow.type = "button";
    customRow.className = "popover-row" + (sessionT2IAspect === "custom" ? " is-active" : "");
    customRow.innerHTML = `<span class="row-mark"></span><span class="row-label">Custom</span>`;
    customRow.addEventListener("click", () => {
      sessionT2IAspect = "custom";
      updateSizeChip();
      buildSizePopover();
    });
    sizePopover.appendChild(customRow);

    if (sessionT2IAspect === "custom") {
      const custom = document.createElement("div");
      custom.className = "popover-custom";
      custom.innerHTML = `
        <label>Width <input id="t2i_w" type="number" min="128" max="2048" step="8" value="${sessionT2ICustom.w}"></label>
        <label>Height <input id="t2i_h" type="number" min="128" max="2048" step="8" value="${sessionT2ICustom.h}"></label>
      `;
      sizePopover.appendChild(custom);
      custom.querySelector("#t2i_w").addEventListener("input", (e) => {
        sessionT2ICustom.w = clamp(Number(e.target.value) || 1024, 128, 2048);
        updateSizeChip();
      });
      custom.querySelector("#t2i_h").addEventListener("input", (e) => {
        sessionT2ICustom.h = clamp(Number(e.target.value) || 1024, 128, 2048);
        updateSizeChip();
      });
    }
  } else {
    const title = document.createElement("div");
    title.className = "popover-title";
    title.textContent = "Working resolution";
    sizePopover.appendChild(title);

    for (const size of BASE_SIZES) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "popover-row" + (sessionBasesize === size ? " is-active" : "");
      row.innerHTML = `<span class="row-mark"></span><span class="row-label">${size}</span>`;
      row.addEventListener("click", () => {
        sessionBasesize = size;
        updateSizeChip();
        closePopovers();
      });
      sizePopover.appendChild(row);
    }
  }
}

/* ------------- Preset chip / popover ---------------------------------- */

function updatePresetChip() {
  const active = getActivePreset();
  presetBtnValue.textContent = active?.name || "—";
}

function buildPresetPopover() {
  presetPopover.innerHTML = "";
  const title = document.createElement("div");
  title.className = "popover-title";
  title.textContent = "Preset";
  presetPopover.appendChild(title);

  for (const preset of presetsState.presets) {
    const row = document.createElement("button");
    row.type = "button";
    const isActive = preset.id === getActivePresetId();
    row.className = "popover-row" + (isActive ? " is-active" : "");
    const isDefault = preset.id === presetsState.default;
    row.innerHTML = `<span class="row-mark"></span><span class="row-label">${preset.name}</span>${isDefault ? '<span class="row-badge">default</span>' : ""}`;
    row.addEventListener("click", () => {
      setActivePresetId(preset.id);
      closePopovers();
    });
    presetPopover.appendChild(row);
  }

  const divider = document.createElement("div");
  divider.className = "popover-divider";
  presetPopover.appendChild(divider);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "popover-link";
  saveBtn.textContent = "+ Save current as preset…";
  saveBtn.addEventListener("click", () => {
    const name = prompt("Preset name?", "New preset");
    if (!name) return;
    const current = getActivePreset();
    const dup = {
      id: uid("preset"),
      name: name.trim() || "New preset",
      steps: current?.steps ?? 50,
      guidance: current?.guidance ?? 5.0,
      seed: current?.seed ?? 42,
      randomSeed: current?.randomSeed ?? false,
      rewrite: current?.rewrite ?? true,
      basesize: sessionBasesize,
    };
    presetsState.presets.push(dup);
    savePresets();
    updatePresetChip();
    closePopovers();
  });
  presetPopover.appendChild(saveBtn);

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "popover-link";
  editBtn.textContent = "Edit presets…";
  editBtn.addEventListener("click", () => {
    closePopovers();
    openPresetPanel();
  });
  presetPopover.appendChild(editBtn);
}

/* ------------- Popover open/close (shared) ---------------------------- */

function openPopover(btn, popoverEl, builder) {
  if (!popoverEl.hidden) {
    closePopovers();
    return;
  }
  closePopovers();
  builder();
  popoverEl.hidden = false;
  btn.setAttribute("aria-expanded", "true");
}

function closePopovers() {
  sizePopover.hidden = true;
  presetPopover.hidden = true;
  sizeBtn.setAttribute("aria-expanded", "false");
  presetBtn.setAttribute("aria-expanded", "false");
}

sizeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  openPopover(sizeBtn, sizePopover, buildSizePopover);
});

presetBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  openPopover(presetBtn, presetPopover, buildPresetPopover);
});

document.addEventListener("click", (e) => {
  if (sizePopover.hidden && presetPopover.hidden) return;
  if (!e.target.closest(".popover-host")) closePopovers();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePopovers();
});

/* ------------- Preset panel (slide-over, full CRUD) -------------------- */

function openPresetPanel() {
  presetPanel.hidden = false;
  editingPresetId = getActivePresetId();
  renderPresetPanel();
}

function closePresetPanel() {
  presetPanel.hidden = true;
}

function renderPresetPanel() {
  // Left list
  presetList.innerHTML = "";
  for (const preset of presetsState.presets) {
    const li = document.createElement("li");
    li.className = preset.id === editingPresetId ? "is-selected" : "";
    const isDefault = preset.id === presetsState.default;
    li.innerHTML = `
      <span class="preset-star${isDefault ? "" : " is-hidden"}" title="Default">★</span>
      <span class="preset-name"></span>
    `;
    li.querySelector(".preset-name").textContent = preset.name;
    li.addEventListener("click", () => {
      editingPresetId = preset.id;
      renderPresetPanel();
    });
    presetList.appendChild(li);
  }

  // Right form
  const editing = getPreset(editingPresetId);
  if (!editing) return;
  pe_name.value = editing.name;
  pe_steps.value = editing.steps;
  pe_stepsValue.textContent = String(editing.steps);
  pe_guidance.value = editing.guidance;
  pe_guidanceValue.textContent = Number(editing.guidance).toFixed(1);
  pe_basesize.value = String(editing.basesize);
  pe_randomSeed.checked = Boolean(editing.randomSeed);
  pe_seed.value = editing.seed ?? 42;
  pe_seed.disabled = Boolean(editing.randomSeed);
  pe_rewrite.checked = Boolean(editing.rewrite);
}

function mutateEditing(fn) {
  const preset = getPreset(editingPresetId);
  if (!preset) return;
  fn(preset);
  savePresets();
  renderPresetPanel();
  // If the active preset was edited, refresh the chip + size sync.
  if (editingPresetId === getActivePresetId()) {
    const active = getActivePreset();
    sessionBasesize = active.basesize || sessionBasesize;
    updatePresetChip();
    updateSizeChip();
  }
}

pe_name.addEventListener("input",  () => mutateEditing(p => p.name = pe_name.value || "Untitled"));
pe_steps.addEventListener("input", () => { pe_stepsValue.textContent = pe_steps.value; mutateEditing(p => p.steps = Number(pe_steps.value)); });
pe_guidance.addEventListener("input", () => { pe_guidanceValue.textContent = Number(pe_guidance.value).toFixed(1); mutateEditing(p => p.guidance = Number(pe_guidance.value)); });
pe_basesize.addEventListener("change", () => mutateEditing(p => p.basesize = Number(pe_basesize.value)));
pe_seed.addEventListener("input", () => mutateEditing(p => p.seed = Number(pe_seed.value) || 0));
pe_randomSeed.addEventListener("change", () => {
  pe_seed.disabled = pe_randomSeed.checked;
  mutateEditing(p => p.randomSeed = pe_randomSeed.checked);
});
pe_rewrite.addEventListener("change", () => mutateEditing(p => p.rewrite = pe_rewrite.checked));

pe_setDefault.addEventListener("click", () => {
  if (!editingPresetId) return;
  presetsState.default = editingPresetId;
  savePresets();
  setActivePresetId(editingPresetId);
  renderPresetPanel();
});

pe_duplicate.addEventListener("click", () => {
  const src = getPreset(editingPresetId);
  if (!src) return;
  const copy = { ...src, id: uid("preset"), name: `${src.name} (copy)` };
  presetsState.presets.push(copy);
  savePresets();
  editingPresetId = copy.id;
  renderPresetPanel();
});

pe_delete.addEventListener("click", () => {
  if (presetsState.presets.length <= 1) {
    alert("At least one preset must remain.");
    return;
  }
  const idx = presetsState.presets.findIndex(p => p.id === editingPresetId);
  if (idx < 0) return;
  if (!confirm(`Delete preset "${presetsState.presets[idx].name}"?`)) return;
  presetsState.presets.splice(idx, 1);
  if (presetsState.default === editingPresetId) {
    presetsState.default = presetsState.presets[0].id;
  }
  savePresets();
  editingPresetId = presetsState.presets[0].id;
  setActivePresetId(presetsState.default);
  renderPresetPanel();
});

presetNewBtn.addEventListener("click", () => {
  const fresh = { id: uid("preset"), name: "New preset", steps: 40, guidance: 5.0, seed: 42, randomSeed: false, rewrite: true, basesize: 1024 };
  presetsState.presets.push(fresh);
  savePresets();
  editingPresetId = fresh.id;
  renderPresetPanel();
});

presetResetBtn.addEventListener("click", () => {
  if (!confirm("Reset all presets to factory defaults? This removes custom presets.")) return;
  presetsState = FACTORY_PRESETS();
  savePresets();
  editingPresetId = presetsState.default;
  setActivePresetId(presetsState.default);
  renderPresetPanel();
});

presetPanelClose.addEventListener("click", closePresetPanel);
presetPanel.addEventListener("click", (e) => {
  if (e.target === presetPanel) closePresetPanel();
});

/* ------------- Guide canvas / red-box (Object Move) ------------------- */

function updateGuideUI() {
  const moveMode = currentMode === "move";
  const hasImage = Boolean(imageInput.files?.[0]);

  if (!moveMode) {
    guideToolEnabled = false;
    guidePointerId = null;
    guideDraftRect = null;
  }

  toggleGuideBtn.hidden = !moveMode;
  clearGuideBtn.hidden = !moveMode;

  guideCanvas.hidden = !moveMode || !hasImage;
  toggleGuideBtn.disabled = !moveMode || !hasImage || isBusy;
  clearGuideBtn.disabled = !moveMode || !guideRect || isBusy;
  clearInputBtn.disabled = !hasImage || isBusy;

  toggleGuideBtn.classList.toggle("is-drawing", guideToolEnabled);
  const label = guideToolEnabled ? "Stop drawing" : "Draw red box";
  toggleGuideBtn.setAttribute("aria-label", label);
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
}

function syncGuideCanvas() {
  if (guideCanvas.hidden || inputImage.hidden) return;
  const width = Math.round(inputImage.clientWidth);
  const height = Math.round(inputImage.clientHeight);
  if (!width || !height) return;

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
  if (!rect) return;
  const width = guideCanvas.clientWidth;
  const height = guideCanvas.clientHeight;
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
    x + inset, y + inset,
    Math.max(boxWidth - strokeWidth, strokeWidth),
    Math.max(boxHeight - strokeWidth, strokeWidth),
  );
  ctx.restore();
}

function drawGuideCanvas() {
  if (guideCanvas.hidden) return;
  const ctx = guideCanvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = guideCanvas.clientWidth;
  const height = guideCanvas.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (guideRect) drawGuideRect(ctx, guideRect);
  if (guideDraftRect) drawGuideRect(ctx, guideDraftRect, { color: "#ff6a61", dashed: true });
}

function getNormalizedPointerPosition(event) {
  const rect = guideCanvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function buildRectFromPoints(a, b) {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x, b.x);
  const y2 = Math.max(a.y, b.y);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function finalizeGuideDraw(event) {
  if (guidePointerId !== event.pointerId || !guideStartPoint) return;
  const endPoint = getNormalizedPointerPosition(event);
  const rect = buildRectFromPoints(guideStartPoint, endPoint);
  if (rect.width >= 0.02 && rect.height >= 0.02) guideRect = rect;
  else guideRect = null;
  guideDraftRect = null;
  guidePointerId = null;
  guideStartPoint = null;
  drawGuideCanvas();
  updateGuideUI();
}

guideCanvas.addEventListener("pointerdown", (event) => {
  if (!guideToolEnabled || guideCanvas.hidden) return;
  event.preventDefault();
  guidePointerId = event.pointerId;
  guideStartPoint = getNormalizedPointerPosition(event);
  guideDraftRect = { x: guideStartPoint.x, y: guideStartPoint.y, width: 0, height: 0 };
  guideCanvas.setPointerCapture(event.pointerId);
  drawGuideCanvas();
});
guideCanvas.addEventListener("pointermove", (event) => {
  if (guidePointerId !== event.pointerId || !guideStartPoint) return;
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

/* ------------- Image upload ------------------------------------------ */

function openImagePicker() { imageInput.click(); }

uploadInputBtn.addEventListener("click", openImagePicker);
uploadSlot.addEventListener("click", () => {
  if (!imageInput.files?.[0] && !isBusy) openImagePicker();
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
  if (toggleGuideBtn.disabled) return;
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
  if (currentInputObjectUrl) URL.revokeObjectURL(currentInputObjectUrl);
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

/* ------------- Drag-and-drop upload ----------------------------------- */

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

["dragenter", "dragover"].forEach((n) => {
  uploadSlot.addEventListener(n, (event) => {
    if (isBusy) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    uploadSlot.classList.add("is-dragover");
  });
});

["dragleave", "dragend"].forEach((n) => {
  uploadSlot.addEventListener(n, (event) => {
    if (n === "dragleave" && uploadSlot.contains(event.relatedTarget)) return;
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

["dragover", "drop"].forEach((n) => {
  window.addEventListener(n, (event) => {
    if (event.target === uploadSlot || uploadSlot.contains(event.target)) return;
    event.preventDefault();
  });
});

/* ------------- Output / history / lightbox ---------------------------- */

function setOutputUrl(url) {
  currentOutputUrl = url;
  outputImage.src = url;
  outputImage.hidden = false;
  outputPlaceholder.hidden = true;
  useAsInputBtn.disabled = currentMode === "t2i"; // can't use output as input in T2I quickly — simpler
  if (downloadBtn) {
    downloadBtn.href = url;
    downloadBtn.removeAttribute("aria-disabled");
  }
}

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

outputImage.addEventListener("click", () => {
  if (outputImage.hidden || !currentOutputUrl) return;
  openLightbox(currentOutputUrl);
});
lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !lightbox.hidden) {
    event.preventDefault();
    closeLightbox();
  }
});

useAsInputBtn.addEventListener("click", async () => {
  if (!currentOutputUrl) return;
  // If we were in T2I, flip to Free Edit so the input card re-appears.
  if (currentMode === "t2i") {
    spatialModeInput.value = "none";
    onModeChange("none");
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

function truncate(text, limit) {
  if (!text) return "";
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

function loadHistoryMeta() {
  const meta = safeReadJson(HIST_KEY, {});
  return meta && typeof meta === "object" ? meta : {};
}

function saveHistoryMeta(meta) {
  const entries = Object.entries(meta);
  if (entries.length > HIST_LIMIT) {
    entries.sort((a, b) => (b[1]?.when || 0) - (a[1]?.when || 0));
    const trimmed = Object.fromEntries(entries.slice(0, HIST_LIMIT));
    safeWriteJson(HIST_KEY, trimmed);
    return;
  }
  safeWriteJson(HIST_KEY, meta);
}

function recordHistoryMeta(outputUrl, data) {
  if (!outputUrl) return;
  const filename = outputUrl.split("/").pop();
  if (!filename) return;
  const meta = loadHistoryMeta();
  meta[filename] = { ...data, when: Date.now() };
  saveHistoryMeta(meta);
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
      card.addEventListener("click", () => setOutputUrl(item.url));
      historyGrid.appendChild(card);
    }
  } catch (error) {
    historyGrid.textContent = "Could not load output history.";
  }
}

/* ------------- Burn red box into input (Object Move) ------------------ */

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Could not read the input image.")); };
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
  ctx.strokeRect(x + inset, y + inset,
    Math.max(width - strokeWidth, strokeWidth),
    Math.max(height - strokeWidth, strokeWidth));

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not draw the red guide box.");
  const basename = sourceFile.name.replace(/\.[^.]+$/, "") || "input";
  return new File([blob], `${basename}-guide.png`, { type: "image/png" });
}

/* ------------- Submit ------------------------------------------------- */

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isBusy) return;

  const prompt = promptInput.value.trim();
  const inputFile = imageInput.files?.[0] || null;
  const isT2I = currentMode === "t2i";

  if (!prompt) { pushLog("Prompt is required.", true); return; }
  if (!isT2I && (currentMode === "move" || currentMode === "rotate" || currentMode === "camera") && !inputFile) {
    pushLog("Spatial editing modes require an input image.", true);
    return;
  }
  if (currentMode === "move" && !guideRect) {
    pushLog("Object Move mode requires a red box on the input image.", true);
    return;
  }
  if (!isT2I && !inputFile && currentMode === "none") {
    // Free Edit without input image is actually T2I in the pipeline. Nudge.
    if (!confirm("No input image uploaded. Generate as text-to-image instead?")) return;
  }

  // Resolve preset values.
  const preset = getActivePreset();
  if (!preset) { pushLog("No preset available.", true); return; }

  const steps     = preset.steps;
  const guidance  = preset.guidance;
  const seed      = preset.randomSeed ? Math.floor(Math.random() * 2_000_000_000) : (preset.seed ?? 42);
  const rewrite   = Boolean(preset.rewrite);
  const basesize  = sessionBasesize || preset.basesize || 1024;

  // Compute H/W for T2I only. In edit mode, backend ignores H/W.
  let width = 1024;
  let height = 1024;
  if (isT2I) {
    if (sessionT2IAspect === "custom") {
      width = sessionT2ICustom.w;
      height = sessionT2ICustom.h;
    } else {
      const a = T2I_ASPECTS[sessionT2IAspect];
      if (a) { width = a.w; height = a.h; }
    }
  }

  // Rewrite is a no-op (and possibly harmful) for canonical spatial templates.
  const rewriteEffective = rewrite && (currentMode === "none" || currentMode === "t2i");

  setBusy(true);
  const startedAt = performance.now();
  elapsedLabel.classList.add("is-running");
  elapsedLabel.textContent = "Running · 0.0s";
  const timerHandle = setInterval(() => {
    const secs = ((performance.now() - startedAt) / 1000).toFixed(1);
    elapsedLabel.textContent = `Running · ${secs}s`;
  }, 100);

  const submittedPrompt = prompt;

  try {
    const fd = new FormData();
    fd.append("prompt", submittedPrompt);
    fd.append("steps", String(steps));
    fd.append("guidance_scale", String(guidance));
    fd.append("seed", String(seed));
    fd.append("neg_prompt", negPromptInput.value || "");
    fd.append("basesize", String(basesize));
    fd.append("height", String(height));
    fd.append("width", String(width));
    fd.append("rewrite_prompt", rewriteEffective ? "true" : "false");

    if (inputFile && !isT2I) {
      const fileToUpload = currentMode === "move" ? await buildGuidedImageFile(inputFile) : inputFile;
      fd.append("image", fileToUpload);
    }

    const response = await fetch("/api/edit", { method: "POST", body: fd });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.detail || "Request failed.");

    setOutputUrl(result.output_url);

    const finalPrompt = (result.prompt || "").trim();
    if (rewriteEffective && finalPrompt && finalPrompt !== submittedPrompt) {
      pushLog(`LLM rewrote → ${finalPrompt}`);
    }
    pushLog(`Done in ${result.elapsed_seconds}s · seed ${seed}.`);

    recordHistoryMeta(result.output_url, {
      prompt: finalPrompt || submittedPrompt,
      submittedPrompt,
      seed,
      steps,
      cfg: guidance,
      baseSize: basesize,
      height,
      width,
      mode: currentMode,
      preset: preset.name,
      rewriteRequested: rewriteEffective,
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

/* ------------- Cmd/Ctrl+Enter --------------------------------------- */

promptInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    if (!isBusy) chatForm.requestSubmit();
  }
});

/* ------------- Form-state persistence (mode inputs + neg prompt) ------ */

const PERSISTED_FIELDS = [
  ["promptInput", promptInput],
  ["negPromptInput", negPromptInput],
  ["spatialModeInput", spatialModeInput],
  ["spatialObjectInput", spatialObjectInput],
  ["spatialViewInput", spatialViewInput],
  ["cameraYawInput", cameraYawInput],
  ["cameraPitchInput", cameraPitchInput],
  ["cameraZoomInput", cameraZoomInput],
];

function serializeFormState() {
  const state = {};
  for (const [key, el] of PERSISTED_FIELDS) {
    if (!el) continue;
    state[key] = el.type === "checkbox" ? el.checked : el.value;
  }
  state.sessionBasesize = sessionBasesize;
  state.sessionT2IAspect = sessionT2IAspect;
  state.sessionT2ICustom = sessionT2ICustom;
  return state;
}

let savePending = null;
function scheduleSaveFormState() {
  if (savePending) return;
  savePending = setTimeout(() => {
    savePending = null;
    safeWriteJson(FORM_KEY, serializeFormState());
  }, 250);
}

function restoreFormState() {
  const state = safeReadJson(FORM_KEY, null);
  if (!state || typeof state !== "object") return;
  for (const [key, el] of PERSISTED_FIELDS) {
    if (!el || !(key in state)) continue;
    try {
      if (el.type === "checkbox") el.checked = Boolean(state[key]);
      else el.value = state[key];
    } catch { /* ignore */ }
  }
  if (typeof state.sessionBasesize === "number") sessionBasesize = state.sessionBasesize;
  if (typeof state.sessionT2IAspect === "string") sessionT2IAspect = state.sessionT2IAspect;
  if (state.sessionT2ICustom && typeof state.sessionT2ICustom === "object") {
    sessionT2ICustom = { w: state.sessionT2ICustom.w || 1024, h: state.sessionT2ICustom.h || 1024 };
  }
}

for (const [, el] of PERSISTED_FIELDS) {
  if (!el) continue;
  const eventName = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
  el.addEventListener(eventName, scheduleSaveFormState);
}

/* ------------- GPU + status polling ----------------------------------- */

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

/* ------------- Init --------------------------------------------------- */

function init() {
  restoreFormState();
  // Apply active preset's basesize if session value was never set.
  const active = getActivePreset();
  if (active) {
    if (!sessionBasesize) sessionBasesize = active.basesize || 1024;
  }
  currentMode = spatialModeInput.value || "none";
  updatePresetChip();
  updateSizeChip();
  updateModeUI();
  // On fresh load, if the prompt field is empty and we have a template, fill it.
  if (!promptInput.value.trim()) applyTemplateToPrompt({ force: true });

  pollStatus();
  pollGpu();
  loadHistory();
  setInterval(pollStatus, STATUS_POLL_MS);
  setInterval(pollGpu, GPU_POLL_MS);
}

init();
