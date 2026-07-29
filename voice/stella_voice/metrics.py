from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

logger = logging.getLogger("stella.voice.metrics")


class StructuredMetrics:
    """Log timing and tool outcomes. Never accept audio or text fields."""

    allowed_fields = {"event", "session", "timings_ms", "tool", "outcome", "reason"}

    def record(self, session_id: str, event: str, **fields: Any) -> None:
        record: dict[str, Any] = {
            "event": event,
            "session": hashlib.sha256(session_id.encode()).hexdigest()[:12],
        }
        for key, value in fields.items():
            if key not in self.allowed_fields:
                raise ValueError(f"Metric field is not allowed: {key}")
            record[key] = value
        logger.info(json.dumps(record, separators=(",", ":"), sort_keys=True))


class MemoryMetrics(StructuredMetrics):
    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    def record(self, session_id: str, event: str, **fields: Any) -> None:
        super().record(session_id, event, **fields)
        self.records.append({"session_id": session_id, "event": event, **fields})
