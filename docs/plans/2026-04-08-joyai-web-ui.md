# JoyAI-Image Web UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A standalone browser-based UI for JoyAI-Image that provides image editing and text-to-image generation through a clean, minimal interface — running locally on the user's laptop.

**Architecture:** A FastAPI backend in a separate repo (`joyai-web/`) that adds JoyAI-Image's `src/` to `sys.path` at runtime. The model loads once at startup. The frontend is a single HTML page with vanilla CSS/JS (no build step). Three-panel layout: chat on the left, image I/O in the center, controls on the right. Images stored on disk under `outputs/` and `uploads/`. The design follows the binnen5.nl aesthetic: light, minimal, sharp, generous whitespace, warm accent.

**Tech Stack:** FastAPI, uvicorn, vanilla HTML/CSS/JS, the existing JoyAI-Image inference code (imported via path).

**Folder structure:**
```
~/ai_stuff/
  JoyAI-Image/          # upstream repo — pull freely, never modified
  joyai-web/             # this project
    app.py               # FastAPI server + all API endpoints
    static/
      index.html         # single-page app
      style.css          # binnen5.nl-inspired styling
      main.js            # client-side logic
    outputs/             # generated images (gitignored)
    uploads/             # uploaded input images (gitignored)
    requirements.txt     # web-only deps (fastapi, uvicorn, python-multipart)
    .gitignore
    README.md
```

---

### Task 1: Project scaffold

**Files:**
- Create: `requirements.txt`
- Create: `.gitignore`
- Create: `app.py`

**Step 1: Create `requirements.txt`**

```
fastapi
uvicorn[standard]
python-multipart
```

**Step 2: Create `.gitignore`**

```
outputs/
uploads/
__pycache__/
*.pyc
.env
```

**Step 3: Create `app.py` — server skeleton**

```python
"""JoyAI-Image Web UI — standalone FastAPI server."""
from __future__ import annotations

import argparse
import sys
import time
import uuid
from pathlib import Path

import torch
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# --- Path setup: import JoyAI-Image source without modifying it ---
JOYAI_ROOT = Path(__file__).resolve().parent.parent / "JoyAI-Image"
JOYAI_SRC = JOYAI_ROOT / "src"

APP_DIR = Path(__file__).resolve().parent
OUTPUTS_DIR = APP_DIR / "outputs"
UPLOADS_DIR = APP_DIR / "uploads"

app = FastAPI(title="JoyAI-Image")

# Loaded at startup in __main__
model = None


def parse_args():
    parser = argparse.ArgumentParser(description="JoyAI-Image Web UI")
    parser.add_argument(
        "--ckpt-root", required=True,
        help="Path to JoyAI-Image checkpoint directory",
    )
    parser.add_argument("--config", default=None, help="Optional infer_config.py path")
    parser.add_argument(
        "--joyai-path", default=str(JOYAI_ROOT),
        help="Path to JoyAI-Image repo (default: sibling folder)",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7860)
    return parser.parse_args()


# --- Routes ---

@app.get("/", response_class=HTMLResponse)
async def index():
    return (APP_DIR / "static" / "index.html").read_text()


@app.get("/api/status")
async def api_status():
    return {"ready": model is not None}


# Static file mounts (order matters — specific before general)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")), name="static")
```

**Step 4: Verify import works**

Run: `cd ~/ai_stuff/joyai-web && python -c "from app import app; print('OK')"`
Expected: `OK`

**Step 5: Commit**

```bash
git add requirements.txt .gitignore app.py
git commit -m "feat: project scaffold with FastAPI skeleton"
```

---

### Task 2: Inference endpoint + model loading

**Files:**
- Modify: `app.py`

**Step 1: Add the `/api/edit` endpoint and startup logic**

Append to `app.py`, before the static mounts:

```python
@app.post("/api/edit")
async def api_edit(
    prompt: str = Form(...),
    image: UploadFile | None = File(None),
    steps: int = Form(50),
    guidance_scale: float = Form(5.0),
    seed: int = Form(42),
    neg_prompt: str = Form(""),
    basesize: int = Form(1024),
    height: int = Form(1024),
    width: int = Form(1024),
):
    from PIL import Image as PILImage
    from infer_runtime.model import InferenceParams

    if model is None:
        return JSONResponse({"detail": "Model not loaded yet"}, status_code=503)

    # Handle uploaded image
    input_image = None
    input_filename = None
    if image and image.filename:
        input_filename = f"{uuid.uuid4().hex}_{image.filename}"
        input_path = UPLOADS_DIR / input_filename
        content = await image.read()
        input_path.write_bytes(content)
        input_image = PILImage.open(input_path).convert("RGB")

    params = InferenceParams(
        prompt=prompt,
        image=input_image,
        height=height,
        width=width,
        steps=steps,
        guidance_scale=guidance_scale,
        seed=seed,
        neg_prompt=neg_prompt,
        basesize=basesize,
    )

    try:
        start = time.time()
        output_image = model.infer(params)
        elapsed = time.time() - start
    except Exception as e:
        return JSONResponse({"detail": str(e)}, status_code=500)

    output_filename = f"{uuid.uuid4().hex}.png"
    output_path = OUTPUTS_DIR / output_filename
    output_image.save(output_path)

    return JSONResponse({
        "output_url": f"/outputs/{output_filename}",
        "input_url": f"/uploads/{input_filename}" if input_filename else None,
        "prompt": prompt,
        "elapsed": round(elapsed, 2),
        "seed": seed,
    })


@app.get("/api/history")
async def api_history():
    files = sorted(OUTPUTS_DIR.glob("*.png"), key=lambda f: f.stat().st_mtime, reverse=True)[:20]
    return [{"url": f"/outputs/{f.name}", "name": f.name} for f in files]
```

**Step 2: Add `__main__` startup block**

Append at the bottom of `app.py`:

```python
if __name__ == "__main__":
    args = parse_args()

    # Add JoyAI-Image src to path
    joyai_src = Path(args.joyai_path) / "src"
    if not joyai_src.exists():
        sys.exit(f"JoyAI-Image src not found at {joyai_src}")
    if str(joyai_src) not in sys.path:
        sys.path.insert(0, str(joyai_src))

    from infer_runtime.model import build_model
    from infer_runtime.settings import load_settings

    print(f"Loading model from {args.ckpt_root}...")
    settings = load_settings(ckpt_root=args.ckpt_root, config_path=args.config)
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    model = build_model(settings, device=device)
    print(f"Model loaded on {device}. Starting server...")

    uvicorn.run(app, host=args.host, port=args.port)
```

**Step 3: Commit**

```bash
git add app.py
git commit -m "feat: add /api/edit, /api/history endpoints and model loading"
```

---

### Task 3: HTML layout

**Files:**
- Create: `static/index.html`

**Step 1: Write the HTML**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JoyAI Image</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <header class="topbar">
    <span class="logo">JoyAI <span class="logo-light">Image</span></span>
    <span class="status" id="status">Connecting...</span>
  </header>

  <div class="layout">
    <!-- LEFT: Chat -->
    <aside class="panel panel-chat">
      <div class="panel-header">Prompt</div>
      <div id="chat-log" class="chat-log"></div>
      <form id="chat-form" class="chat-input">
        <textarea id="prompt-input" placeholder="Describe your edit or what to generate..." rows="3"></textarea>
        <button type="submit" id="send-btn">Generate</button>
      </form>
    </aside>

    <!-- CENTER: Images -->
    <main class="panel panel-images">
      <div class="images-row">
        <div class="image-section">
          <div class="section-label">Input</div>
          <div id="input-box" class="image-box">
            <label class="upload-area" id="upload-label" for="image-upload">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="0"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="m21 15-5-5L5 21"/>
              </svg>
              <span>Drop image or click to upload</span>
              <input type="file" id="image-upload" accept="image/*" hidden>
            </label>
            <img id="input-image" hidden>
            <button id="clear-image" class="btn-clear" hidden>&times;</button>
          </div>
        </div>
        <div class="image-section">
          <div class="section-label">Output</div>
          <div id="output-box" class="image-box">
            <div id="output-placeholder" class="placeholder-text">Result appears here</div>
            <img id="output-image" hidden>
            <button id="use-as-input" class="btn-use-input" hidden>Use as input &rarr;</button>
          </div>
        </div>
      </div>
      <div class="gallery-row">
        <div class="section-label">Recent</div>
        <div id="gallery" class="gallery"></div>
      </div>
    </main>

    <!-- RIGHT: Controls -->
    <aside class="panel panel-controls">
      <div class="panel-header">Settings</div>

      <div class="control">
        <div class="control-label">
          <span>Steps</span>
          <span class="control-value" id="val-steps">50</span>
        </div>
        <input type="range" id="ctrl-steps" min="1" max="100" value="50">
      </div>

      <div class="control">
        <div class="control-label">
          <span>Guidance Scale</span>
          <span class="control-value" id="val-guidance">5.0</span>
        </div>
        <input type="range" id="ctrl-guidance" min="1" max="20" step="0.5" value="5">
      </div>

      <div class="control">
        <div class="control-label"><span>Seed</span></div>
        <div class="control-row">
          <input type="number" id="ctrl-seed" value="42" min="0">
          <button type="button" id="random-seed" class="btn-small">Random</button>
        </div>
      </div>

      <div class="control">
        <div class="control-label"><span>Negative Prompt</span></div>
        <textarea id="ctrl-neg" rows="2" placeholder="Optional..."></textarea>
      </div>

      <div class="divider"></div>
      <div class="control-section-label">Image Editing</div>

      <div class="control">
        <div class="control-label"><span>Base Size</span></div>
        <select id="ctrl-basesize">
          <option value="256">256</option>
          <option value="512">512</option>
          <option value="768">768</option>
          <option value="1024" selected>1024</option>
        </select>
      </div>

      <div class="divider"></div>
      <div class="control-section-label">Text-to-Image</div>

      <div class="control">
        <div class="control-label"><span>Height</span></div>
        <input type="number" id="ctrl-height" value="1024" min="256" max="2048" step="64">
      </div>

      <div class="control">
        <div class="control-label"><span>Width</span></div>
        <input type="number" id="ctrl-width" value="1024" min="256" max="2048" step="64">
      </div>

      <div id="progress" class="progress" hidden>
        <div class="progress-bar"></div>
      </div>
    </aside>
  </div>

  <script src="/static/main.js"></script>
</body>
</html>
```

**Step 2: Commit**

```bash
git add static/index.html
git commit -m "feat: add HTML layout — chat, images, controls"
```

---

### Task 4: CSS — binnen5.nl-inspired styling

**Files:**
- Create: `static/style.css`

**Step 1: Write the CSS**

Design principles from binnen5.nl: light surfaces, warm muted accent, sharp corners, generous spacing, light font weights, minimal borders.

```css
/* static/style.css */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #f5f3f0;
  --surface: #ffffff;
  --border: #e5e1dc;
  --text: #2c2c2c;
  --text-muted: #8a8580;
  --accent: #a4835b;
  --accent-hover: #8e7049;
  --font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  height: 100vh;
  overflow: hidden;
  font-weight: 400;
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
}

/* --- Top bar --- */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.logo {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.logo-light { font-weight: 300; color: var(--text-muted); }
.status { font-size: 12px; color: var(--text-muted); letter-spacing: 0.3px; }
.status.ready { color: var(--accent); }

/* --- Layout --- */
.layout {
  display: grid;
  grid-template-columns: 280px 1fr 260px;
  height: calc(100vh - 49px);
}

.panel {
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
.panel:last-child { border-right: none; border-left: 1px solid var(--border); }

.panel-header {
  padding: 16px 20px 12px;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}

/* --- Chat panel --- */
.panel-chat { background: var(--bg); }
.chat-log {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.chat-msg {
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.5;
  max-width: 92%;
  word-wrap: break-word;
}
.chat-msg.user {
  background: var(--surface);
  border: 1px solid var(--border);
  align-self: flex-end;
}
.chat-msg.system {
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  align-self: flex-start;
  padding: 4px 0;
}
.chat-input {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chat-input textarea {
  width: 100%;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 10px 12px;
  resize: none;
  font-family: var(--font);
  font-size: 13px;
  line-height: 1.5;
  outline: none;
}
.chat-input textarea:focus { border-color: var(--accent); }
.chat-input button {
  align-self: flex-end;
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 8px 24px;
  font-family: var(--font);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.2s;
}
.chat-input button:hover { background: var(--accent-hover); }
.chat-input button:disabled { opacity: 0.4; cursor: not-allowed; }

/* --- Image panel --- */
.panel-images {
  background: var(--bg);
  border-right: none;
  padding: 20px;
  overflow-y: auto;
}
.images-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.section-label {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.image-box {
  background: var(--surface);
  border: 1px solid var(--border);
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}
.image-box img {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
  display: block;
}
.upload-area {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px;
  color: var(--text-muted);
  width: 100%;
  height: 100%;
  justify-content: center;
  transition: color 0.2s;
}
.upload-area:hover { color: var(--accent); }
.upload-area span { font-size: 12px; letter-spacing: 0.3px; }
.image-box.drag-over { border-color: var(--accent); }
.btn-clear {
  position: absolute;
  top: 8px;
  right: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s;
}
.btn-clear:hover { color: var(--text); }
.btn-use-input {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 6px 12px;
  font-family: var(--font);
  font-size: 11px;
  letter-spacing: 0.3px;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.btn-use-input:hover { color: var(--accent); border-color: var(--accent); }
.placeholder-text { color: var(--text-muted); font-size: 12px; letter-spacing: 0.3px; }

/* --- Gallery --- */
.gallery-row { margin-top: 20px; }
.gallery {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.gallery:empty::after {
  content: "No outputs yet";
  color: var(--text-muted);
  font-size: 12px;
}
.gallery img {
  height: 72px;
  width: 72px;
  object-fit: cover;
  border: 1px solid var(--border);
  cursor: pointer;
  transition: border-color 0.2s;
}
.gallery img:hover { border-color: var(--accent); }

/* --- Controls panel --- */
.panel-controls { background: var(--surface); overflow-y: auto; }
.panel-controls .panel-header { margin-bottom: 0; }
.control { padding: 12px 20px 0; }
.control-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.control-label span { font-size: 12px; color: var(--text-muted); }
.control-value { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--text); }
.control input[type="range"] {
  width: 100%;
  accent-color: var(--accent);
  height: 2px;
}
.control input[type="number"],
.control select,
.control textarea {
  width: 100%;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 8px 10px;
  font-family: var(--font);
  font-size: 13px;
  outline: none;
}
.control input[type="number"]:focus,
.control select:focus,
.control textarea:focus { border-color: var(--accent); }
.control-row { display: flex; gap: 8px; align-items: center; }
.control-row input { flex: 1; }
.btn-small {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 8px 12px;
  font-family: var(--font);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.2s;
}
.btn-small:hover { border-color: var(--accent); color: var(--accent); }
.divider { height: 1px; background: var(--border); margin: 16px 20px 8px; }
.control-section-label {
  padding: 4px 20px 0;
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text-muted);
}
.progress {
  margin: 16px 20px;
  height: 2px;
  background: var(--border);
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  width: 0%;
  background: var(--accent);
  animation: indeterminate 1.5s ease-in-out infinite;
}
@keyframes indeterminate {
  0% { width: 0%; margin-left: 0; }
  50% { width: 50%; margin-left: 25%; }
  100% { width: 0%; margin-left: 100%; }
}

/* --- Scrollbar --- */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
```

**Step 2: Commit**

```bash
git add static/style.css
git commit -m "feat: add CSS — light minimal design inspired by binnen5.nl"
```

---

### Task 5: JavaScript — interactivity

**Files:**
- Create: `static/main.js`

**Step 1: Write the JS**

```javascript
// static/main.js
const $ = (sel) => document.querySelector(sel);

// Elements
const chatLog = $("#chat-log");
const chatForm = $("#chat-form");
const promptInput = $("#prompt-input");
const sendBtn = $("#send-btn");
const imageUpload = $("#image-upload");
const inputBox = $("#input-box");
const inputImage = $("#input-image");
const clearImage = $("#clear-image");
const uploadLabel = $("#upload-label");
const outputImage = $("#output-image");
const outputPlaceholder = $("#output-placeholder");
const useAsInput = $("#use-as-input");
const progressEl = $("#progress");
const statusEl = $("#status");

let uploadedFile = null;

// --- Status check ---
async function checkStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    if (data.ready) {
      statusEl.textContent = "Model ready";
      statusEl.classList.add("ready");
    } else {
      statusEl.textContent = "Model loading...";
      setTimeout(checkStatus, 3000);
    }
  } catch {
    statusEl.textContent = "Disconnected";
    setTimeout(checkStatus, 5000);
  }
}
checkStatus();

// --- Image upload ---
imageUpload.addEventListener("change", (e) => {
  if (e.target.files[0]) setInputImage(e.target.files[0]);
});

inputBox.addEventListener("dragover", (e) => {
  e.preventDefault();
  inputBox.classList.add("drag-over");
});
inputBox.addEventListener("dragleave", () => inputBox.classList.remove("drag-over"));
inputBox.addEventListener("drop", (e) => {
  e.preventDefault();
  inputBox.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) setInputImage(file);
});

function setInputImage(file) {
  uploadedFile = file;
  inputImage.src = URL.createObjectURL(file);
  inputImage.hidden = false;
  clearImage.hidden = false;
  uploadLabel.hidden = true;
}

function setInputImageFromUrl(url) {
  // Fetch the output image as a File so we can re-upload it
  fetch(url)
    .then((r) => r.blob())
    .then((blob) => {
      const file = new File([blob], "previous_output.png", { type: "image/png" });
      setInputImage(file);
    });
}

clearImage.addEventListener("click", () => {
  uploadedFile = null;
  inputImage.hidden = true;
  inputImage.src = "";
  clearImage.hidden = true;
  uploadLabel.hidden = false;
  imageUpload.value = "";
});

// --- Use output as next input ---
useAsInput.addEventListener("click", () => {
  if (outputImage.src) setInputImageFromUrl(outputImage.src);
});

// --- Controls ---
function bindRange(sliderId, valId) {
  const slider = $(sliderId);
  const val = $(valId);
  if (!slider || !val) return;
  slider.addEventListener("input", () => {
    val.textContent = parseFloat(slider.value) % 1 === 0
      ? slider.value
      : parseFloat(slider.value).toFixed(1);
  });
}
bindRange("#ctrl-steps", "#val-steps");
bindRange("#ctrl-guidance", "#val-guidance");

$("#random-seed").addEventListener("click", () => {
  $("#ctrl-seed").value = Math.floor(Math.random() * 999999);
});

// --- Chat + Generate ---
function addMessage(text, role) {
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  addMessage(prompt, "user");
  promptInput.value = "";
  sendBtn.disabled = true;
  progressEl.hidden = false;

  const fd = new FormData();
  fd.append("prompt", prompt);
  fd.append("steps", $("#ctrl-steps").value);
  fd.append("guidance_scale", $("#ctrl-guidance").value);
  fd.append("seed", $("#ctrl-seed").value);
  fd.append("neg_prompt", $("#ctrl-neg").value);
  fd.append("basesize", $("#ctrl-basesize").value);
  fd.append("height", $("#ctrl-height").value);
  fd.append("width", $("#ctrl-width").value);
  if (uploadedFile) fd.append("image", uploadedFile);

  try {
    const res = await fetch("/api/edit", { method: "POST", body: fd });
    const data = await res.json();

    if (res.ok) {
      outputImage.src = data.output_url + "?t=" + Date.now();
      outputImage.hidden = false;
      outputPlaceholder.hidden = true;
      useAsInput.hidden = false;
      addMessage(`Done in ${data.elapsed}s  \u00b7  seed ${data.seed}`, "system");
      loadGallery();
    } else {
      addMessage(`Error: ${data.detail || "Unknown error"}`, "system");
    }
  } catch (err) {
    addMessage(`Error: ${err.message}`, "system");
  } finally {
    sendBtn.disabled = false;
    progressEl.hidden = true;
  }
});

// Ctrl/Cmd + Enter to submit
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    chatForm.dispatchEvent(new Event("submit"));
  }
});

// --- Gallery ---
async function loadGallery() {
  try {
    const res = await fetch("/api/history");
    const items = await res.json();
    const gallery = $("#gallery");
    gallery.innerHTML = "";
    items.forEach((item) => {
      const img = document.createElement("img");
      img.src = item.url;
      img.title = item.name;
      img.addEventListener("click", () => {
        outputImage.src = item.url;
        outputImage.hidden = false;
        outputPlaceholder.hidden = true;
        useAsInput.hidden = false;
      });
      gallery.appendChild(img);
    });
  } catch {}
}
loadGallery();
```

**Step 2: Commit**

```bash
git add static/main.js
git commit -m "feat: add JS — upload, chat, controls, gallery, use-as-input"
```

---

### Task 6: README

**Files:**
- Create: `README.md`

**Step 1: Write a short README**

```markdown
# JoyAI Web

Browser-based UI for [JoyAI-Image](https://github.com/jd-opensource/JoyAI-Image).

## Setup

```bash
# Install JoyAI-Image (sibling folder)
cd ~/ai_stuff/JoyAI-Image
pip install -e .

# Install web dependencies
cd ~/ai_stuff/joyai-web
pip install -r requirements.txt
```

## Run

```bash
python app.py --ckpt-root /path/to/checkpoints
```

Open http://127.0.0.1:7860

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--ckpt-root` | required | Path to model checkpoints |
| `--config` | auto | Path to `infer_config.py` |
| `--joyai-path` | `../JoyAI-Image` | Path to JoyAI-Image repo |
| `--host` | `127.0.0.1` | Server host |
| `--port` | `7860` | Server port |
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and usage instructions"
```

---

### Task 7: End-to-end test

**Step 1: Install web deps**

```bash
cd ~/ai_stuff/joyai-web
pip install -r requirements.txt
```

**Step 2: Start the server**

```bash
python app.py --ckpt-root /path/to/your/checkpoints
```

**Step 3: Test in browser**

1. Open `http://127.0.0.1:7860`
2. Verify status shows "Model ready" in top-right
3. Upload an image (click or drag)
4. Type a prompt, hit Generate
5. Verify output appears, chat shows timing
6. Click "Use as input" on output — verify it moves to input
7. Test text-to-image: clear input image, type a prompt, generate
8. Verify gallery populates
9. Click a gallery thumbnail — verify it shows in output

**Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: polish from end-to-end testing"
```

---

## How to run (summary)

```bash
cd ~/ai_stuff/joyai-web
python app.py --ckpt-root /path/to/JoyAI-Image-Edit
```

Then open **http://127.0.0.1:7860**
