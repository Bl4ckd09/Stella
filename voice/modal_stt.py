from __future__ import annotations

import os
import subprocess

import modal

MODEL = "mistralai/Voxtral-Mini-4B-Realtime-2602"

app = modal.App("stella-voxtral-stt")
cache = modal.Volume.from_name("stella-voxtral-models", create_if_missing=True)
image = modal.Image.from_registry("vllm/vllm-openai:v0.24.0").env({
    "HF_HOME": "/root/.cache/huggingface",
    "VLLM_DISABLE_COMPILE_CACHE": "1",
})


@app.function(
    image=image,
    gpu="L4",
    min_containers=0,
    scaledown_window=20 * 60,
    timeout=60 * 60,
    volumes={"/root/.cache/huggingface": cache},
)
@modal.concurrent(max_inputs=4)
@modal.web_server(port=8000, startup_timeout=20 * 60, requires_proxy_auth=True)
def serve() -> None:
    env = os.environ.copy()
    subprocess.Popen([
        "vllm",
        "serve",
        MODEL,
        "--host",
        "0.0.0.0",
        "--port",
        "8000",
        "--max-model-len",
        "4096",
        "--max-num-seqs",
        "4",
        "--gpu-memory-utilization",
        "0.92",
        "--compilation_config",
        '{"cudagraph_mode":"PIECEWISE"}',
    ], env=env)
