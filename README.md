# JoyAI-Image Web UI

This project is a lightweight browser UI around the existing `JoyAI-Image` inference runtime.
It runs locally in one process and exposes:

- `POST /api/edit`
- `GET /api/status`
- `GET /api/history`
- `GET /outputs/{file}`
- `GET /uploads/{file}`

## Repository layout

- `app.py` – FastAPI server and API endpoints
- `static/` – Browser UI (`index.html`, `style.css`, `main.js`)
- `outputs/` – Generated images (local filesystem)
- `uploads/` – Uploaded images for edit mode

## Prerequisites

- Python 3.10+
- CUDA-capable setup if running on GPU
- JoyAI model checkpoint directory with this layout:
  - `<ckpt>/transformer/transformer.pth`
  - `<ckpt>/vae/<exactly one file>`
  - `<ckpt>/JoyAI-Image-Und/`
- Dependencies required by JoyAI-Image (`transformers`, `diffusers`, etc.) must be available in the environment.

`JoyAI-Image` itself is expected at `../JoyAI-Image` relative to this repo by default.

## Install

```bash
cd /Users/erwinvink/ai_stuff/joyai-web
python3.10 -m venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt
uv pip install -e /Users/erwinvink/ai_stuff/JoyAI-Image
```

## Run

```bash
uv run --env-file .env app.py \
  --ckpt-root /Users/erwinvink/ai_stuff/joyai_ckpts/JoyAI-Image-Edit-git \
  --joyai-path /Users/erwinvink/ai_stuff/JoyAI-Image \
  --host 127.0.0.1 \
  --port 7860
```

If a checkpoint file is missing, the server still starts and `/api/status` will show the exact startup error while the UI remains available.

The first required step is ensuring these files/folders exist under the checkpoint root:

- `<ckpt>/vae/Wan2.1_VAE.pth`
- `<ckpt>/transformer/transformer.pth`
- `<ckpt>/JoyAI-Image-Und/model-00001-of-00004.safetensors`
- `<ckpt>/JoyAI-Image-Und/model-00002-of-00004.safetensors`
- `<ckpt>/JoyAI-Image-Und/model-00003-of-00004.safetensors`
- `<ckpt>/JoyAI-Image-Und/model-00004-of-00004.safetensors`

Example manual resume command for the missing transformer file:

```bash
cd /Users/erwinvink/ai_stuff/joyai_ckpts/JoyAI-Image-Edit-git
curl -L --fail -o transformer/transformer.pth -C - \
  https://huggingface.co/jdopensource/JoyAI-Image-Edit/resolve/main/transformer/transformer.pth
```

If you installed dependencies globally and want to run without uv, use:

```bash
python app.py \
  --ckpt-root /path/to/ckpts_infer \
  --joyai-path /Users/erwinvink/ai_stuff/JoyAI-Image \
  --host 127.0.0.1 \
  --port 7860
```

Open `http://127.0.0.1:7860` in a browser.

## API examples

- Check status:

```bash
curl -s http://127.0.0.1:7860/api/status
```

- Text-to-image:

```bash
curl -X POST "http://127.0.0.1:7860/api/edit" \
  -F "prompt=Create a cozy living room in soft morning light" \
  -F "steps=40" \
  -F "guidance_scale=5.0" \
  -F "seed=42"
```

- Image editing:

```bash
curl -X POST "http://127.0.0.1:7860/api/edit" \
  -F "prompt=Move the cup into the red box and finally remove the red box." \
  -F "steps=50" \
  -F "guidance_scale=5" \
  -F "seed=123" \
  -F "image=@/path/to/input.jpg"
```

## Notes

- The server serializes inference calls using an async lock to avoid concurrent GPU contention.
- Model load happens before server start in `__main__`.
