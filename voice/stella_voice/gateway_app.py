from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections.abc import AsyncIterator
from typing import Callable

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .metrics import StructuredMetrics
from .services import GatewayServices
from .tokens import ReplayGuard, TokenError, verify_token
from .vad import TurnDetector, VadConfig


async def queue_frames(queue: asyncio.Queue[bytes | None]) -> AsyncIterator[bytes]:
    while True:
        frame = await queue.get()
        if frame is None:
            return
        yield frame


def create_voice_app(
    services: GatewayServices,
    session_secret: str,
    allowed_origin: str | None = None,
    metrics: StructuredMetrics | None = None,
    classifier: Callable[[bytes, int], bool] | None = None,
    now: Callable[[], int] | None = None,
) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    metric_sink = metrics or StructuredMetrics()
    replay_guard = ReplayGuard()
    clock = now or (lambda: int(time.time()))
    expected_origin = allowed_origin.rstrip("/") if allowed_origin else None

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.websocket("/ws")
    async def voice_socket(websocket: WebSocket) -> None:
        if expected_origin and (websocket.headers.get("origin") or "").rstrip("/") != expected_origin:
            await websocket.close(code=4403, reason="origin_rejected")
            return
        try:
            claims = verify_token(websocket.query_params.get("token", ""), session_secret, now=clock())
        except TokenError:
            await websocket.close(code=4401, reason="invalid_token")
            return
        if not replay_guard.consume(claims, now=clock()):
            await websocket.close(code=4409, reason="token_reused")
            return

        await websocket.accept()
        session_id = claims.jti
        metric_sink.record(session_id, "connected")
        send_lock = asyncio.Lock()
        detector = TurnDetector(VadConfig(), classifier=classifier) if classifier else TurnDetector(VadConfig())
        history: list[dict[str, str]] = []
        current_task: asyncio.Task[None] | None = None
        audio_queue: asyncio.Queue[bytes | None] | None = None
        active_timing: dict[str, float | None] | None = None

        async def send_json(payload: dict[str, object]) -> None:
            async with send_lock:
                await websocket.send_json(payload)

        async def cancel_current(reason: str) -> None:
            nonlocal current_task, audio_queue, active_timing
            if audio_queue:
                await audio_queue.put(None)
                audio_queue = None
                active_timing = None
            if not current_task or current_task.done():
                return
            detected_at = time.perf_counter()
            await send_json({"type": "playback_cancel", "reason": reason})
            cancel_ms = round((time.perf_counter() - detected_at) * 1000, 2)
            metric_sink.record(session_id, "interrupted", reason=reason, timings_ms={"cancel": cancel_ms})
            current_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await current_task

        async def synthesize(reply_text: str, turn_started: float, endpoint_at: float | None = None) -> None:
            await send_json({"type": "audio_start", "sample_rate": 24_000, "encoding": "pcm_s16le"})
            first_audio_at: float | None = None
            async for chunk in services.synthesizer.stream(reply_text):
                if first_audio_at is None:
                    first_audio_at = time.perf_counter()
                async with send_lock:
                    await websocket.send_bytes(chunk)
            await send_json({"type": "audio_end"})
            await send_json({"type": "turn_end"})
            timings = {"total": round((time.perf_counter() - turn_started) * 1000, 2)}
            if first_audio_at is not None:
                timings["first_audio_after_endpoint"] = round(
                    (first_audio_at - (endpoint_at or turn_started)) * 1000,
                    2,
                )
            metric_sink.record(session_id, "turn_complete", timings_ms=timings)

        async def run_agent(user_text: str, turn_started: float, endpoint_at: float | None = None) -> None:
            agent_started = time.perf_counter()
            response = await services.agent.respond(user_text, history)
            agent_ms = round((time.perf_counter() - agent_started) * 1000, 2)
            metric_sink.record(
                session_id,
                "agent_complete",
                timings_ms={"agent": agent_ms},
                tool=response.tool,
                outcome=response.outcome,
            )
            history.extend((
                {"role": "user", "content": user_text},
                {"role": "assistant", "content": response.text},
            ))
            del history[:-8]
            await send_json({"type": "reply_text", "text": response.text})
            await synthesize(response.text, turn_started, endpoint_at)

        async def run_audio_turn(
            queue: asyncio.Queue[bytes | None],
            turn_started: float,
            timing: dict[str, float | None],
        ) -> None:
            partial_text = ""
            first_partial_at: float | None = None

            async def on_partial(delta: str) -> None:
                nonlocal partial_text, first_partial_at
                partial_text += delta
                if first_partial_at is None:
                    first_partial_at = time.perf_counter()
                    metric_sink.record(
                        session_id,
                        "first_partial",
                        timings_ms={"partial": round((first_partial_at - turn_started) * 1000, 2)},
                    )
                await send_json({"type": "transcript_partial", "text": partial_text})

            transcript = await services.transcriber.transcribe(queue_frames(queue), on_partial)
            metric_sink.record(
                session_id,
                "transcription_complete",
                timings_ms={"final": round((time.perf_counter() - turn_started) * 1000, 2)},
            )
            if not transcript:
                await send_json({"type": "error", "message": "I did not hear that. Please try again."})
                await send_json({"type": "turn_end"})
                return
            await send_json({"type": "transcript_final", "text": transcript})
            await run_agent(transcript, turn_started, timing.get("ended"))

        async def guarded(coroutine: object) -> None:
            try:
                await coroutine  # type: ignore[misc]
            except asyncio.CancelledError:
                raise
            except Exception:
                metric_sink.record(session_id, "turn_error", outcome="service_error")
                with contextlib.suppress(Exception):
                    await send_json({"type": "error", "message": "Voice is unavailable. Please try again."})

        await send_json({
            "type": "ready",
            "input": {"sample_rate": 16_000, "encoding": "pcm_s16le"},
            "output": {"sample_rate": 24_000, "encoding": "pcm_s16le"},
        })

        try:
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    try:
                        update = detector.push(message["bytes"])
                    except ValueError:
                        await send_json({"type": "error", "message": "The audio frame was invalid."})
                        continue
                    if update.started:
                        await cancel_current("user_speech")
                        await send_json({"type": "speech_started"})
                        audio_queue = asyncio.Queue()
                        for frame in update.audio_frames:
                            await audio_queue.put(frame)
                        started_at = time.perf_counter()
                        active_timing = {"ended": None}
                        current_task = asyncio.create_task(
                            guarded(run_audio_turn(audio_queue, started_at, active_timing))
                        )
                    elif audio_queue:
                        for frame in update.audio_frames:
                            await audio_queue.put(frame)
                    if update.ended and audio_queue:
                        if active_timing is not None:
                            active_timing["ended"] = time.perf_counter()
                        await audio_queue.put(None)
                        audio_queue = None
                        await send_json({"type": "speech_ended", "reason": update.reason or "silence"})
                    continue

                raw_text = message.get("text")
                if raw_text is None:
                    continue
                try:
                    event = json.loads(raw_text)
                except json.JSONDecodeError:
                    await send_json({"type": "error", "message": "The message was invalid."})
                    continue
                if event.get("type") == "ping":
                    await send_json({"type": "pong"})
                    continue
                if event.get("type") != "text_input":
                    continue
                user_text = str(event.get("text") or "").strip()[:500]
                if not user_text:
                    continue
                detector.reset()
                await cancel_current("text_input")
                await send_json({"type": "transcript_final", "text": user_text})
                started_at = time.perf_counter()
                current_task = asyncio.create_task(guarded(run_agent(user_text, started_at, started_at)))
        except WebSocketDisconnect:
            pass
        finally:
            if audio_queue:
                await audio_queue.put(None)
            if current_task and not current_task.done():
                current_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await current_task
            metric_sink.record(session_id, "disconnected")

    return app
