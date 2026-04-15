"""FastAPI web API for JoyAI-Image local web UI."""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import importlib.util
import io
import os
import subprocess
import sys
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Optional

import torch
import torch.distributed as dist
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

APP_DIR = Path(__file__).resolve().parent
DEFAULT_JOYAI_PATH = APP_DIR.parent / "JoyAI-Image"
OUTPUTS_DIR = APP_DIR / "outputs"
UPLOADS_DIR = APP_DIR / "uploads"
STATIC_DIR = APP_DIR / "static"

# Load secrets (e.g. OPENAI_API_KEY) from a .env file next to this script, if
# present. Runs at import time so every code path — including JoyAI-Image's
# load_settings() which does os.environ.get('OPENAI_API_KEY') — sees it.
# .env is already in .gitignore. Shell-exported variables take precedence.
load_dotenv(APP_DIR / ".env")


OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="JoyAI-Image")

model: Any = None
model_device: str | None = None
model_error: str | None = None
inference_lock = asyncio.Lock()
dist_initialized = False


class PromptRewriteUnavailable(RuntimeError):
    """Raised when LLM prompt rewriting is requested but not usable."""


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
    parser.add_argument(
        "--hsdp-shard-dim",
        type=int,
        default=None,
        help="Optional HSDP shard dimension. Defaults to WORLD_SIZE when launched with torchrun.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Server host")
    parser.add_argument("--port", type=int, default=7860, help="Server port")
    return parser.parse_args()


def get_rank() -> int:
    return int(os.environ.get("RANK", "0"))


def get_world_size() -> int:
    return int(os.environ.get("WORLD_SIZE", "1"))


def is_rank0() -> bool:
    return get_rank() == 0


def is_distributed() -> bool:
    return dist.is_available() and dist.is_initialized()


def maybe_init_distributed() -> bool:
    world_size = get_world_size()
    if world_size <= 1:
        return False
    rank = get_rank()
    # Web workers can sit idle for long periods between edits, so the default
    # process-group timeout is too short for this serving model.
    dist.init_process_group(
        backend="nccl",
        world_size=world_size,
        rank=rank,
        timeout=dt.timedelta(hours=12),
    )
    return True


def resolve_device() -> torch.device:
    if not torch.cuda.is_available():
        return torch.device("cpu")
    local_rank = int(os.environ.get("LOCAL_RANK", "0"))
    torch.cuda.set_device(local_rank)
    return torch.device(f"cuda:{local_rank}")


def resolve_hsdp_shard_dim(args: argparse.Namespace) -> int | None:
    if args.hsdp_shard_dim is not None:
        return args.hsdp_shard_dim
    world_size = get_world_size()
    return world_size if world_size > 1 else None


def patch_transformer_execution_device() -> None:
    from modules.models.mmdit.dit.models import Transformer3DModel

    if getattr(Transformer3DModel, "_joyai_web_device_patch", False):
        return

    original_device_property = Transformer3DModel.device

    def patched_device(self) -> torch.device:
        execution_device = getattr(self, "_joyai_execution_device", None)
        if execution_device is not None:
            return execution_device
        return original_device_property.fget(self)

    Transformer3DModel.device = property(patched_device)
    Transformer3DModel._joyai_web_device_patch = True


def patch_pipeline_load() -> None:
    import infer_runtime.model as infer_model
    import modules.models as model_modules

    if getattr(infer_model.load_pipeline, "_joyai_web_offload_patch", False):
        return

    original_load_pipeline = infer_model.load_pipeline

    def patched_load_pipeline(cfg, dit, device: torch.device):
        if device.type != "cuda":
            return original_load_pipeline(cfg, dit, device)

        from modules.models.pipeline import Pipeline
        from modules.utils.constants import PRECISION_TO_TYPE
        from modules.utils.utils import build_from_config

        is_distributed_cpu_offload = get_world_size() > 1 and bool(getattr(cfg, "cpu_offload", False))
        if get_world_size() > 1 and not is_distributed_cpu_offload:
            return original_load_pipeline(cfg, dit, device)

        component_device = device if is_distributed_cpu_offload else torch.device("cpu")
        vae = build_from_config(
            cfg.vae_arch_config,
            torch_dtype=PRECISION_TO_TYPE[cfg.vae_precision],
            device=component_device,
        )
        if getattr(cfg.vae_arch_config, "enable_feature_caching", False):
            vae.enable_feature_caching()
        tokenizer, text_encoder = build_from_config(
            cfg.text_encoder_arch_config,
            torch_dtype=PRECISION_TO_TYPE[cfg.text_encoder_precision],
            device=component_device,
        )
        scheduler = build_from_config(cfg.scheduler_arch_config)

        pipeline = Pipeline(
            vae=vae,
            tokenizer=tokenizer,
            text_encoder=text_encoder,
            transformer=dit,
            scheduler=scheduler,
            args=cfg,
        )

        if is_distributed_cpu_offload:
            # Keep the FSDP transformer in its CPU-offloaded state while the
            # text encoder and VAE live on the local CUDA rank.
            return pipeline

        pipeline.enable_model_cpu_offload(gpu_id=device.index or 0)
        return pipeline

    patched_load_pipeline._joyai_web_offload_patch = True
    infer_model.load_pipeline = patched_load_pipeline
    model_modules.load_pipeline = patched_load_pipeline


def patch_single_gpu_dit_load() -> None:
    import infer_runtime.model as infer_model
    import modules.models as model_modules

    if getattr(model_modules.load_dit, "_joyai_web_cpu_stage_patch", False):
        return

    original_load_dit = model_modules.load_dit

    def patched_load_dit(cfg, device: torch.device):
        if device.type != "cuda":
            return original_load_dit(cfg, device)

        import glob

        from modules.utils.constants import PRECISION_TO_TYPE
        from modules.utils.fsdp_load import (
            maybe_load_fsdp_model,
            safetensors_weights_iterator,
        )
        from modules.utils.logging import get_logger
        from modules.utils.utils import build_from_config

        logger = get_logger()

        state_dict = None
        if cfg.dit_ckpt is not None:
            logger.info(f"Loading model from: {cfg.dit_ckpt}, type: {cfg.dit_ckpt_type}")
            if cfg.dit_ckpt_type == "safetensor":
                safetensors_files = glob.glob(os.path.join(str(cfg.dit_ckpt), "*.safetensors"))
                if not safetensors_files:
                    raise ValueError(f"No safetensors files found in {cfg.dit_ckpt}")
                state_dict = dict(safetensors_weights_iterator(safetensors_files))
            elif cfg.dit_ckpt_type == "pt":
                state_dict = torch.load(
                    cfg.dit_ckpt,
                    map_location="cpu",
                    weights_only=True,
                    mmap=True,
                )
                if "model" in state_dict:
                    state_dict = state_dict["model"]
            else:
                raise ValueError(
                    f"Unknown dit_ckpt_type: {cfg.dit_ckpt_type}, must be 'safetensor' or 'pt'"
                )

        dtype = PRECISION_TO_TYPE[cfg.dit_precision]
        cpu = torch.device("cpu")
        model = build_from_config(cfg.dit_arch_config, dtype=dtype, device=cpu, args=cfg)

        if state_dict is not None:
            load_state_dict = {}
            for key, value in state_dict.items():
                if key == "img_in.weight" and model.img_in.weight.shape != value.shape:
                    logger.info(f"Inflate {key} from {value.shape} to {model.img_in.weight.shape}")
                    value_new = value.new_zeros(model.img_in.weight.shape)
                    value_new[:, :value.shape[1], :, :, :] = value
                    value = value_new
                load_state_dict[key] = value
            model.load_state_dict(load_state_dict, strict=True)

        param_dtypes = {param.dtype for param in model.parameters()}
        if len(param_dtypes) > 1:
            logger.warning(f"Model has mixed dtypes: {param_dtypes}. Converting to {dtype}")
            model = model.to(dtype=dtype)

        if get_world_size() > 1:
            cfg.reshard_after_forward = True
            cfg.cpu_offload = True
            cfg.pin_cpu_memory = True
            model = maybe_load_fsdp_model(
                model=model,
                hsdp_shard_dim=cfg.hsdp_shard_dim,
                reshard_after_forward=cfg.reshard_after_forward,
                param_dtype=dtype,
                reduce_dtype=torch.float32,
                output_dtype=None,
                cpu_offload=cfg.cpu_offload,
                fsdp_inference=cfg.use_fsdp_inference,
                training_mode=cfg.training_mode,
                pin_cpu_memory=cfg.pin_cpu_memory,
            )
            model._joyai_execution_device = device
        else:
            torch.cuda.empty_cache()
            model = model.to(device=device)

        total_params = sum(param.numel() for param in model.parameters())
        logger.info(f"Instantiate model with {total_params / 1e9:.2f}B parameters")
        return model.eval()

    patched_load_dit._joyai_web_cpu_stage_patch = True
    infer_model.load_dit = patched_load_dit
    model_modules.load_dit = patched_load_dit


def patch_attention_backend_fallback() -> None:
    import modules.models.attention as attention_module
    import modules.models.mmdit.dit.models as dit_models_module

    if getattr(attention_module, "_joyai_web_attention_patch", False):
        return

    def patched_attention(
        q: torch.Tensor,
        k: torch.Tensor,
        v: torch.Tensor,
        backend: str = "flash_attn",
        *,
        causal: bool = False,
        softmax_scale: float | None = None,
        attn_kwargs: dict | None = None,
    ):
        if backend == "auto":
            backend = attention_module.get_preferred_attention_backend()
        if backend == "flash_attn" and attention_module.flash_attn_varlen_func is None:
            backend = "torch_spda"
        if backend not in {"torch_spda", "flash_attn"}:
            raise AssertionError(f"Unsupported attention backend: {backend}")
        if not (q.dim() == 4 and k.dim() == 4 and v.dim() == 4):
            raise AssertionError("Input tensors must be 4D")

        if backend == "torch_spda":
            q = attention_module.rearrange(q, "b l h c -> b h l c")
            k = attention_module.rearrange(k, "b l h c -> b h l c")
            v = attention_module.rearrange(v, "b l h c -> b h l c")
            output = torch.nn.functional.scaled_dot_product_attention(
                q,
                k,
                v,
                is_causal=causal,
                scale=softmax_scale,
            )
            return attention_module.rearrange(output, "b h l c -> b l h c")

        if attn_kwargs is None:
            raise AssertionError("Flash attention requires attn_kwargs.")

        batch_size = q.shape[0]
        cu_seqlens_q = attn_kwargs["cu_seqlens_q"]
        cu_seqlens_kv = attn_kwargs["cu_seqlens_kv"]
        max_seqlen_q = attn_kwargs["max_seqlen_q"]
        max_seqlen_kv = attn_kwargs["max_seqlen_kv"]
        x = attention_module.flash_attn_varlen_func(
            q.view(q.shape[0] * q.shape[1], *q.shape[2:]),
            k.view(k.shape[0] * k.shape[1], *k.shape[2:]),
            v.view(v.shape[0] * v.shape[1], *v.shape[2:]),
            cu_seqlens_q,
            cu_seqlens_kv,
            max_seqlen_q,
            max_seqlen_kv,
        )
        return x.view(batch_size, max_seqlen_q, x.shape[-2], x.shape[-1])

    attention_module.attention = patched_attention
    dit_models_module.attention = patched_attention
    attention_module._joyai_web_attention_patch = True


def _resolve_image_suffix(filename: str | None) -> str:
    if not filename:
        return ".png"
    suffix = Path(filename).suffix.lower()
    return suffix if suffix in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"} else ".png"


def _load_model(args: argparse.Namespace) -> None:
    global dist_initialized, model, model_device, model_error

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

    dist_initialized = maybe_init_distributed()

    settings = load_settings(
        ckpt_root=args.ckpt_root,
        config_path=args.config,
        rewrite_model=args.rewrite_model,
    )
    device = resolve_device()
    model_device = str(device)
    if device.type == "cuda":
        patch_attention_backend_fallback()
        patch_transformer_execution_device()
        torch.cuda.empty_cache()
        patch_single_gpu_dit_load()
        patch_pipeline_load()
    model = build_model(
        settings,
        device=device,
        hsdp_shard_dim_override=resolve_hsdp_shard_dim(args),
    )


def _load_uploaded_image(input_filename: str | None) -> Image.Image | None:
    if not input_filename:
        return None
    input_path = UPLOADS_DIR / input_filename
    with Image.open(input_path) as image:
        return image.convert("RGB")


def _read_gpu_status() -> dict[str, Any]:
    if not torch.cuda.is_available():
        return {"available": False, "gpus": []}

    command = [
        "nvidia-smi",
        "--query-gpu=index,name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu",
        "--format=csv,noheader,nounits",
    ]
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        return {
            "available": False,
            "gpus": [],
            "error": str(exc),
        }

    gpus: list[dict[str, Any]] = []
    for raw_line in completed.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        parts = [part.strip() for part in line.split(",")]
        if len(parts) != 7:
            continue
        index, name, gpu_util, mem_util, mem_used, mem_total, temperature = parts
        gpus.append(
            {
                "index": int(index),
                "name": name,
                "gpu_utilization": int(gpu_util),
                "memory_utilization": int(mem_util),
                "memory_used_mib": int(mem_used),
                "memory_total_mib": int(mem_total),
                "temperature_c": int(temperature),
            }
        )
    return {"available": True, "gpus": gpus}


def _get_prompt_rewrite_status() -> dict[str, Any]:
    openai_installed = importlib.util.find_spec("openai") is not None
    api_key_configured = bool(os.environ.get("OPENAI_API_KEY"))

    message = None
    if not openai_installed:
        message = (
            "Prompt rewrite requires the `openai` Python package. "
            "Install it with `uv pip install openai`."
        )
    elif not api_key_configured:
        message = "Prompt rewrite requires OPENAI_API_KEY."

    return {
        "available": openai_installed and api_key_configured,
        "openai_installed": openai_installed,
        "api_key_configured": api_key_configured,
        "message": message,
    }


def _ensure_prompt_rewrite_available() -> None:
    status = _get_prompt_rewrite_status()
    if status["available"]:
        return
    raise PromptRewriteUnavailable(status["message"] or "Prompt rewrite is unavailable.")


def _run_local_inference(task: dict[str, Any]) -> dict[str, Any]:
    from infer_runtime.model import InferenceParams

    if task["command"] == "shutdown":
        return {"command": "shutdown"}

    input_image = _load_uploaded_image(task.get("input_filename"))
    started_at = time.perf_counter()
    output_image = model.infer(
        InferenceParams(
            prompt=task["prompt"],
            image=input_image,
            height=task["height"],
            width=task["width"],
            steps=task["steps"],
            guidance_scale=task["guidance_scale"],
            seed=task["seed"],
            neg_prompt=task["neg_prompt"],
            basesize=task["basesize"],
        )
    )
    elapsed = round(time.perf_counter() - started_at, 3)

    if is_rank0():
        output_path = OUTPUTS_DIR / task["output_filename"]
        output_image.save(output_path)

    return {
        "output_filename": task["output_filename"],
        "elapsed_seconds": elapsed,
    }


def _run_task_with_status(task: dict[str, Any]) -> dict[str, Any]:
    try:
        return {
            "ok": True,
            "rank": get_rank(),
            "result": _run_local_inference(task),
        }
    except Exception as exc:
        traceback.print_exc()
        return {
            "ok": False,
            "rank": get_rank(),
            "error": str(exc),
        }


def _gather_statuses(local_status: dict[str, Any]) -> list[dict[str, Any]]:
    if not is_distributed():
        return [local_status]
    statuses: list[dict[str, Any] | None] = [None] * get_world_size()
    dist.all_gather_object(statuses, local_status)
    return [status for status in statuses if status is not None]


def _raise_for_failed_statuses(statuses: list[dict[str, Any]]) -> None:
    failures = [status for status in statuses if not status.get("ok")]
    if not failures:
        return
    joined = "; ".join(
        f"rank {status.get('rank', '?')}: {status.get('error', 'unknown error')}"
        for status in failures
    )
    raise RuntimeError(joined)


def _execute_rank0_task(task: dict[str, Any]) -> dict[str, Any]:
    if is_distributed():
        payload = [task]
        dist.broadcast_object_list(payload, src=0)

    local_status = _run_task_with_status(task)
    statuses = _gather_statuses(local_status)
    _raise_for_failed_statuses(statuses)
    return local_status.get("result", {})


def _worker_loop() -> None:
    if not is_distributed() or is_rank0():
        return

    while True:
        payload: list[dict[str, Any] | None] = [None]
        dist.broadcast_object_list(payload, src=0)
        task = payload[0] or {"command": "shutdown"}
        local_status = _run_task_with_status(task)
        _gather_statuses(local_status)
        if task["command"] == "shutdown":
            return


def _broadcast_shutdown() -> None:
    if not is_distributed() or not is_rank0():
        return
    try:
        _execute_rank0_task({"command": "shutdown"})
    except Exception:
        pass


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
        "rank": get_rank(),
        "world_size": get_world_size(),
        "distributed": is_distributed(),
        "rewrite_prompt": _get_prompt_rewrite_status(),
    }


@app.get("/api/gpu")
async def api_gpu() -> dict[str, Any]:
    return _read_gpu_status()


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
    else:
        pil_image = None

    original_prompt = prompt.strip()
    if not original_prompt:
        raise HTTPException(status_code=400, detail="Prompt cannot be empty.")

    rewrite_enabled = bool(rewrite_prompt)
    if rewrite_enabled:
        try:
            _ensure_prompt_rewrite_available()
        except PromptRewriteUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    async with inference_lock:
        try:
            effective_prompt = model.maybe_rewrite_prompt(
                original_prompt,
                pil_image,
                enabled=rewrite_enabled,
            )
            output_filename = f"{uuid.uuid4().hex}.png"
            task = {
                "command": "infer",
                "prompt": effective_prompt,
                "input_filename": input_filename,
                "output_filename": output_filename,
                "height": height,
                "width": width,
                "steps": steps,
                "guidance_scale": guidance_scale,
                "seed": seed,
                "neg_prompt": neg_prompt,
                "basesize": basesize,
            }
            result = await asyncio.to_thread(_execute_rank0_task, task)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc

    return JSONResponse(
        {
            "output_url": f"/outputs/{output_filename}",
            "input_url": f"/uploads/{input_filename}" if input_filename else None,
            "prompt": effective_prompt,
            "elapsed_seconds": result.get("elapsed_seconds"),
            "seed": seed,
            "params_echo": {
                "steps": steps,
                "guidance_scale": guidance_scale,
                "neg_prompt": neg_prompt,
                "basesize": basesize,
                "height": height,
                "width": width,
                "rewrite_prompt": rewrite_enabled,
                "has_input_image": pil_image is not None,
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
        if is_rank0():
            print(f"Model loaded on {model_device}. Starting server on {args.host}:{args.port}...")
        else:
            print(f"Worker rank {get_rank()} ready on {model_device}.")
    except Exception as exc:
        model_error = f"{exc}"
        if is_rank0():
            print(f"Model failed to initialize: {model_error}", file=sys.stderr)
            print("Starting server in degraded mode. /api/edit is disabled until startup model load succeeds.", file=sys.stderr)
        else:
            print(f"Worker rank {get_rank()} failed to initialize: {model_error}", file=sys.stderr)
    try:
        if is_rank0():
            uvicorn.run(app, host=args.host, port=args.port)
        else:
            _worker_loop()
    finally:
        try:
            _broadcast_shutdown()
        finally:
            if dist_initialized:
                from modules.utils import clean_dist_env

                clean_dist_env()
