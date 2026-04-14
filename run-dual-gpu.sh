#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOYAI_ROOT="${JOYAI_ROOT:-$ROOT_DIR/../JoyAI-Image}"
CKPT_ROOT="${CKPT_ROOT:-$JOYAI_ROOT/ckpts_infer}"
HOST="${HOST:-127.0.0.1}"
# Keep JoyAI on a stable local backend port so the reverse proxy can
# always target the same upstream.
PORT="7860"
NPROC_PER_NODE="${NPROC_PER_NODE:-2}"
MASTER_PORT="${MASTER_PORT:-29501}"

export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0,1}"
export PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}"

exec "$JOYAI_ROOT/.venv/bin/torchrun" \
  --nproc_per_node="$NPROC_PER_NODE" \
  --master_port="$MASTER_PORT" \
  "$ROOT_DIR/app.py" \
  --ckpt-root "$CKPT_ROOT" \
  --joyai-path "$JOYAI_ROOT" \
  --host "$HOST" \
  --port "$PORT" \
  "$@"
