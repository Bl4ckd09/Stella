from __future__ import annotations

import struct

from voice.latency_check import interruption_frames


def test_interruption_frames_start_at_real_speech() -> None:
    silence = bytes(640)
    quiet = struct.pack("<h", 999) * 320
    speech = struct.pack("<h", 1_500) * 320

    assert interruption_frames([silence, quiet, speech, speech], limit=2) == [speech, speech]
