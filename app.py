"""FastAPI web API for JoyAI-Image local web UI."""
from __future__ import annotations

import argparse
import asyncio
import io
import sys
import uuid
from pathlib import Path
from typing import Any, Optional

import torch
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

APP_DIR = Path(__file__).resolve().parent
DEFAULT_JOYAI_PATH = APP_DIR.parent / "JoyAI-Image"
OUTPUTS_DIR = APP_DIR / "outputs"
UPLOADS_DIR = APP_DIR / "uploads"
STATIC_DIR = APP_DIR / "static"


OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="JoyAI-Image")

model: Any = None
model_device: str | None = None
model_error: str | None = None
inference_lock = asyncio.Lock()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="JoyAI-Image web frontend")
    parser.add_argument("--ckpt-root", required=True, help="Checkpoint root directory")
    parser.add_argument("--config", default=None, help="Optional path to infer_config.py")
    parser.add_argument("--rewrite-model", default="gpt-5", help="Prompt rewrite model name")
    parser.add_argument(
        "--joyai-path",
        default=str(DEFAULT_JOYAI_PATH),
        help="Path to JoyAI-Image repo (default: sibling folder)",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Server host")
    parser.add_argument("--port", type=int, default=7860, help="Server port")
    return parser.parse_args()


def _resolve_image_suffix(filename: str | None) -> str:
    if not filename:
        return ".png"
    suffix = Path(filename).suffix.lower()
    return suffix if suffix in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"} else ".png"


def _load_model(args: argparse.Namespace) -> None:
    global model, model_device, model_error

    model = None
    model_error = None

    joyai_path = Path(args.joyai_path).expanduser().resolve()
    joyai_src = joyai_path / "src"
    if not joyai_src.exists():
        model_error = f"JoyAI-Image src not found at {joyai_src}"
        raise RuntimeError(model_error)

    if str(joyai_src) not in sys.path:
        sys.path.insert(0, str(joyai_src))

    from infer_runtime.model import build_model
    from infer_runtime.settings import load_settings

    settings = load_settings(
        ckpt_root=args.ckpt_root,
        config_path=args.config,
        rewrite_model=args.rewrite_model,
    )
    model_device = "cuda:0" if torch.cuda.is_available() else "cpu"
    device = torch.device(model_device)
    model = build_model(settings, device=device)


@app.get("/", response_class=HTMLResponse)
async def index():
    html_path = STATIC_DIR / "index.html"
    if not html_path.exists():
        raise HTTPException(status_code=500, detail="Frontend file missing. Missing static/index.html.")
    return html_path.read_text(encoding="utf-8")


@app.get("/api/status")
async def api_status() -> dict[str, Any]:
    return {
        "ready": model is not None,
        "device": model_device,
        "error": model_error,
    }


@app.post("/api/edit")
async def api_edit(
    prompt: str = Form(...),
    image: Optional[UploadFile] = File(None),
    steps: int = Form(50),
    guidance_scale: float = Form(5.0),
    seed: int = Form(42),
    neg_prompt: str = Form(""),
    basesize: int = Form(1024),
    height: int = Form(1024),
    width: int = Form(1024),
    rewrite_prompt: bool = Form(False),
):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not ready. Restart server with valid ckpt settings.")

    from infer_runtime.model import InferenceParams

    input_image = None
    input_filename = None

    if image is not None and image.filename:
        raw = await image.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty image payload.")
        try:
            pil_image = Image.open(io.BytesIO(raw)).convert("RGB")
        except (UnidentifiedImageError, OSError) as exc:
            raise HTTPException(status_code=400, detail="Uploaded file is not a valid image.") from exc

        input_filename = f"{uuid.uuid4().hex}{_resolve_image_suffix(image.filename)}"
        input_path = UPLOADS_DIR / input_filename
        pil_image.save(input_path)
        input_image = pil_image

    else:
        input_image = None

    original_prompt = prompt.strip()
    if not original_prompt:
        raise HTTPException(status_code=400, detail="Prompt cannot be empty.")

    async with inference_lock:
        try:
            effective_prompt = model.maybe_rewrite_prompt(
                original_prompt,
                input_image,
                enabled=bool(rewrite_prompt),
            )
            params = InferenceParams(
                prompt=effective_prompt,
                image=input_image,
                height=height,
                width=width,
                steps=steps,
                guidance_scale=guidance_scale,
                seed=seed,
                neg_prompt=neg_prompt,
                basesize=basesize,
            )
            import time

            start = time.perf_counter()
            output_image = await asyncio.to_thread(model.infer, params)
            elapsed = time.perf_counter() - start
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc

    output_filename = f"{uuid.uuid4().hex}.png"
    output_path = OUTPUTS_DIR / output_filename
    output_image.save(output_path)

    return JSONResponse(
        {
            "output_url": f"/outputs/{output_filename}",
            "input_url": f"/uploads/{input_filename}" if input_filename else None,
            "prompt": effective_prompt,
            "elapsed_seconds": round(elapsed, 3),
            "seed": seed,
            "params_echo": {
                "steps": steps,
                "guidance_scale": guidance_scale,
                "neg_prompt": neg_prompt,
                "basesize": basesize,
                "height": height,
                "width": width,
                "rewrite_prompt": bool(rewrite_prompt),
                "has_input_image": input_image is not None,
            },
        }
    )


@app.get("/api/history")
async def api_history(limit: int = 20):
    files = sorted(
        [f for f in OUTPUTS_DIR.glob("*.png") if f.is_file()],
        key=lambda file: file.stat().st_mtime,
        reverse=True,
    )
    return [
        {
            "name": output_file.name,
            "url": f"/outputs/{output_file.name}",
            "created_at": int(output_file.stat().st_mtime),
            "size": output_file.stat().st_size,
        }
        for output_file in files[:max(limit, 1)]
    ]


app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


if __name__ == "__main__":
    args = parse_args()
    try:
        _load_model(args)
        print(f"Model loaded on {model_device}. Starting server on {args.host}:{args.port}...")
    except Exception as exc:
        model_error = f"{exc}"
        print(f"Model failed to initialize: {model_error}", file=sys.stderr)
        print("Starting server in degraded mode. /api/edit is disabled until startup model load succeeds.", file=sys.stderr)
    uvicorn.run(app, host=args.host, port=args.port)
