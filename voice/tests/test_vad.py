from voice.stella_voice.vad import TurnDetector, VadConfig


def energy_classifier(frame: bytes, _sample_rate: int) -> bool:
    return any(frame)


def test_vad_ends_after_600ms_silence() -> None:
    config = VadConfig()
    detector = TurnDetector(config, classifier=energy_classifier)
    speech = b"\x01\x00" * (config.frame_bytes // 2)
    silence = bytes(config.frame_bytes)

    assert detector.push(speech).started
    for _ in range(29):
        assert not detector.push(silence).ended
    ended = detector.push(silence)
    assert ended.ended
    assert ended.reason == "silence"


def test_vad_forces_15_second_limit() -> None:
    config = VadConfig()
    detector = TurnDetector(config, classifier=energy_classifier)
    speech = b"\x01\x00" * (config.frame_bytes // 2)
    update = detector.push(speech)
    for _ in range(config.max_utterance_ms // config.frame_ms - 1):
        update = detector.push(speech)
    assert update.ended
    assert update.reason == "max_duration"


def test_vad_rejects_malformed_frames() -> None:
    detector = TurnDetector(classifier=energy_classifier)
    try:
        detector.push(b"short")
        raise AssertionError("malformed audio was accepted")
    except ValueError as exc:
        assert "640 bytes" in str(exc)
