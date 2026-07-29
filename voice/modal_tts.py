from __future__ import annotations

import os
import subprocess

import modal

MODEL = "mistralai/Voxtral-4B-TTS-2603"

app = modal.App("stella-voxtral-tts")
cache = modal.Volume.from_name("stella-voxtral-models", create_if_missing=True)
image = (
    modal.Image.from_registry("vllm/vllm-omni:v0.24.0", add_python="3.12")
    .entrypoint([])
    .env({
        "HF_HOME": "/root/.cache/huggingface",
    })
)


@app.function(
    image=image,
    gpu="L4",
    min_containers=0,
    scaledown_window=20 * 60,
    timeout=60 * 60,
    volumes={"/root/.cache/huggingface": cache},
)
@modal.concurrent(max_inputs=4)
@modal.web_server(port=8091, startup_timeout=20 * 60, requires_proxy_auth=True)
def serve() -> None:
    env = os.environ.copy()
    subprocess.Popen([
        "vllm",
        "serve",
        MODEL,
        "--omni",
        "--host",
        "0.0.0.0",
        "--port",
        "8091",
        "--max-model-len",
        "4096",
        "--max-num-seqs",
        "4",
        "--gpu-memory-utilization",
        "0.85",
        "--kv-cache-memory-bytes",
        "2G",
        "--enforce-eager",
    ], env=env)
