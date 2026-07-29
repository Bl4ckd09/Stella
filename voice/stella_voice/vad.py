from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class VadConfig:
    sample_rate: int = 16_000
    frame_ms: int = 20
    silence_ms: int = 600
    max_utterance_ms: int = 15_000
    pre_roll_ms: int = 200

    @property
    def frame_bytes(self) -> int:
        return self.sample_rate * self.frame_ms // 1000 * 2


@dataclass(frozen=True)
class DetectorUpdate:
    started: bool = False
    audio_frames: tuple[bytes, ...] = ()
    ended: bool = False
    reason: str | None = None


class TurnDetector:
    def __init__(
        self,
        config: VadConfig | None = None,
        classifier: Callable[[bytes, int], bool] | None = None,
    ) -> None:
        self.config = config or VadConfig()
        if self.config.frame_ms not in (10, 20, 30):
            raise ValueError("WebRTC VAD requires 10, 20, or 30 millisecond frames")
        if classifier is None:
            import webrtcvad

            vad = webrtcvad.Vad(2)
            self.classifier = lambda frame, sample_rate: bool(vad.is_speech(frame, sample_rate))
        else:
            self.classifier = classifier
        self._pre_roll: deque[bytes] = deque(maxlen=max(1, self.config.pre_roll_ms // self.config.frame_ms))
        self.reset()

    def reset(self) -> None:
        self.active = False
        self.silence_frames = 0
        self.utterance_frames = 0
        if hasattr(self, "_pre_roll"):
            self._pre_roll.clear()

    def push(self, frame: bytes) -> DetectorUpdate:
        if len(frame) != self.config.frame_bytes:
            raise ValueError(f"Expected {self.config.frame_bytes} bytes of PCM16 audio")
        speech = self.classifier(frame, self.config.sample_rate)

        if not self.active:
            self._pre_roll.append(frame)
            if not speech:
                return DetectorUpdate()
            self.active = True
            self.utterance_frames = 1
            audio = tuple(self._pre_roll)
            self._pre_roll.clear()
            return DetectorUpdate(started=True, audio_frames=audio)

        self.utterance_frames += 1
        self.silence_frames = 0 if speech else self.silence_frames + 1
        silence_limit = self.config.silence_ms // self.config.frame_ms
        utterance_limit = self.config.max_utterance_ms // self.config.frame_ms
        reason = None
        if self.silence_frames >= silence_limit:
            reason = "silence"
        elif self.utterance_frames >= utterance_limit:
            reason = "max_duration"

        if reason:
            self.active = False
            self.silence_frames = 0
            self.utterance_frames = 0
            return DetectorUpdate(audio_frames=(frame,), ended=True, reason=reason)
        return DetectorUpdate(audio_frames=(frame,))
