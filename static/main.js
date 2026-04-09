const statusPill = document.getElementById("statusPill");
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

const imageInput = document.getElementById("imageInput");
const inputImage = document.getElementById("inputImage");
const inputPlaceholder = document.getElementById("inputPlaceholder");
const clearInputBtn = document.getElementById("clearInputBtn");
const outputImage = document.getElementById("outputImage");
const outputPlaceholder = document.getElementById("outputPlaceholder");
const useAsInputBtn = document.getElementById("useAsInputBtn");
const historyGrid = document.getElementById("historyGrid");

let isBusy = false;
let currentOutputUrl = null;
let currentInputObjectUrl = null;

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
}

function safeClearInput() {
  if (currentInputObjectUrl) {
    URL.revokeObjectURL(currentInputObjectUrl);
    currentInputObjectUrl = null;
  }
  imageInput.value = "";
  inputImage.hidden = true;
  inputImage.removeAttribute("src");
  inputPlaceholder.hidden = false;
  clearInputBtn.disabled = true;
}

clearInputBtn.addEventListener("click", safeClearInput);

function displayInputPreview() {
  const file = imageInput.files?.[0];
  if (!file) return;
  if (currentInputObjectUrl) URL.revokeObjectURL(currentInputObjectUrl);
  currentInputObjectUrl = URL.createObjectURL(file);
  inputImage.src = currentInputObjectUrl;
  inputImage.hidden = false;
  inputPlaceholder.hidden = true;
  clearInputBtn.disabled = false;
}

imageInput.addEventListener("change", displayInputPreview);

useAsInputBtn.addEventListener("click", async () => {
  if (!currentOutputUrl) return;
  const resp = await fetch(currentOutputUrl);
  if (!resp.ok) {
    pushLog("Could not load output image to use as input.", true);
    return;
  }
  const blob = await resp.blob();
  const file = new File([blob], "from-output.png", { type: "image/png" });
  const dt = new DataTransfer();
  dt.items.add(file);
  imageInput.files = dt.files;
  displayInputPreview();
});

async function pollStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    if (data.ready) {
      statusPill.textContent = `Ready • ${data.device || "cpu"}`;
      statusPill.className = "status status-online";
    } else {
      statusPill.textContent = data.error ? `Error: ${data.error}` : "Model loading…";
      statusPill.className = data.error ? "status status-error" : "status";
    }
  } catch (err) {
    statusPill.textContent = "Offline";
    statusPill.className = "status status-error";
  }
}

async function loadHistory() {
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
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isBusy) return;

  const prompt = promptInput.value.trim();
  if (!prompt) {
    pushLog("Prompt is required.", true);
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

    if (imageInput.files[0]) {
      fd.append("image", imageInput.files[0]);
    }

    const response = await fetch("/api/edit", { method: "POST", body: fd });
    const result = await response.json();
    if (!response.ok) {
      const detail = result?.detail || "Request failed.";
      throw new Error(detail);
    }

    outputImage.src = result.output_url;
    outputImage.hidden = false;
    outputPlaceholder.hidden = true;
    currentOutputUrl = result.output_url;
    useAsInputBtn.disabled = false;

    if (result.input_url) {
      outputPlaceholder.textContent = "Result";
    }
    pushLog(`Done (${result.elapsed_seconds}s): ${result.prompt}`);
    pushLog(`Saved output: ${result.output_url}`);
    await loadHistory();
  } catch (err) {
    pushLog(err.message || "Unknown error", true);
  } finally {
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
    elapsedLabel.textContent = `${elapsed}s`;
    setBusy(false);
  }
});

pollStatus();
setInterval(pollStatus, 4000);
loadHistory();
