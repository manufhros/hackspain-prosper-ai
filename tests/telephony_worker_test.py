"""Finite codec tests with real NumPy/SciPy/soundfile, synthetic models and no devices.
Run with the already-installed private Python 3.12; never loads a speech model.
"""
import base64
import io
import os
from pathlib import Path
import runpy
import sys
import types
import unittest
from unittest.mock import patch
import numpy as np
import soundfile as sf


class SyntheticVoice:
    @staticmethod
    def load(_path):
        return SyntheticVoice()

    def synthesize_wav(self, _text, output):
        samples = (np.sin(np.arange(22050) * 2 * np.pi * 440 / 22050) * 10000).astype("<i2")
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(22050)
        output.writeframes(samples.tobytes())


class WireAudioTests(unittest.TestCase):
    def setUp(self):
        self.heard = []

        def transcribe(audio, **kwargs):
            self.heard.append((audio, kwargs))
            return {"text": " Hola ", "language": "es"}

        modules = {"mlx_whisper": types.SimpleNamespace(transcribe=transcribe),
                   "sounddevice": types.SimpleNamespace(),
                   "piper": types.SimpleNamespace(PiperVoice=SyntheticVoice),
                   "recording": types.SimpleNamespace(Recording=object)}
        old_mask = os.umask(0o077)
        try:
            with patch.dict(sys.modules, modules), patch.object(sys, "stdin", io.StringIO()), patch.object(sys, "argv", ["worker.py", "/tmp/synthetic-voice"]):
                self.worker = runpy.run_path(str(Path(__file__).parent.parent / "local-voice/worker.py"))
        finally:
            os.umask(old_mask)

    def test_synthesis_is_raw_8000hz_mulaw_without_device_or_file_io(self):
        with patch.object(sf, "write", side_effect=AssertionError("No disk audio in wire mode")):
            result = self.worker["handle"]({"operation": "speak", "text": "Hola", "language": "es", "wire": True, "play": False})
        audio = base64.b64decode(result["payload"], validate=True)
        self.assertEqual(len(audio), 8000)
        self.assertEqual(result["duration_ms"], 1000)
        self.assertFalse(audio.startswith(b"RIFF"))
        self.assertGreater(len(set(audio)), 10)

    def test_wire_roundtrip_resamples_for_asr_and_detects_language(self):
        result = self.worker["handle"]({"operation": "speak", "text": "Hola", "language": "es", "wire": True})
        heard = self.worker["handle"]({"operation": "transcribe_mulaw", "payload": result["payload"]})
        self.assertEqual(heard, {"text": "Hola", "language": "es"})
        self.assertEqual(len(self.heard[0][0]), 16000)
        self.assertIsNone(self.heard[0][1]["language"])

    def test_silence_never_calls_whisper(self):
        result = self.worker["handle"]({"operation": "transcribe_mulaw", "payload": base64.b64encode(bytes([255]) * 8000).decode()})
        self.assertEqual(result["text"], "")
        self.assertEqual(self.heard, [])

    def test_oversized_or_malformed_payloads_are_rejected(self):
        for payload in ["!bad", "", "a" * 320001]:
            with self.assertRaises(ValueError):
                self.worker["handle"]({"operation": "transcribe_mulaw", "payload": payload})
        self.assertEqual(self.heard, [])


if __name__ == "__main__":
    unittest.main()
