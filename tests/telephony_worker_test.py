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
        environment = patch.dict(os.environ, {"LOCAL_ASR_DECODER": "transcribe"})
        environment.start()
        self.addCleanup(environment.stop)

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
                self.worker["voices"].update({key: SyntheticVoice() for key in ("en", "es", "ca")})
        finally:
            os.umask(old_mask)

    def test_capture_worker_neither_imports_nor_warms_speech_models(self):
        modules = {"mlx_whisper": None, "piper": None,
                   "sounddevice": types.SimpleNamespace(),
                   "recording": types.SimpleNamespace(Recording=object)}
        old_mask = os.umask(0o077)
        try:
            with patch.dict(sys.modules, modules), patch.object(sys, "stdin", io.StringIO()), patch.object(sys, "argv", ["worker.py", "/tmp/synthetic-voice", "capture"]):
                worker = runpy.run_path(str(Path(__file__).parent.parent / "local-voice/worker.py"))
                self.assertEqual(worker["handle"]({"operation": "warmup"}), {"ready": True})
                self.assertNotIn("mlx_whisper", worker)
                self.assertNotIn("PiperVoice", worker)
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
        self.assertEqual(heard["text"], "Hola")
        self.assertEqual(heard["language"], "es")
        self.assertEqual(heard["decoder"], "transcribe")
        self.assertGreater(heard["input_rms"], 0)
        self.assertEqual(len(self.heard[0][0]), 16000)
        self.assertIsNone(self.heard[0][1]["language"])

    def test_silence_never_calls_whisper(self):
        result = self.worker["handle"]({"operation": "transcribe_mulaw", "payload": base64.b64encode(bytes([255]) * 8000).decode()})
        self.assertEqual(result["text"], "")
        self.assertEqual(result["skip_reason"], "digital_silence")
        self.assertEqual(result["decoder"], "skipped")
        self.assertEqual(self.heard, [])

    def test_quiet_speech_reaches_both_decoders_in_clean_and_telephone_forms(self):
        import audioop
        from unittest.mock import Mock
        # Below the former 0.002 RMS gate; comparable to the discarded FLEURS clips.
        audio = (np.sin(np.arange(16000) * 2 * np.pi * 440 / 16000) * 0.001).astype(np.float32)
        wire = base64.b64encode(audioop.lin2ulaw((audio[::2] * 32767).astype("<i2").tobytes(), 2)).decode()
        decode = Mock(return_value={"text": "Quiet speech", "language": "en", "decoder": "segment"})
        for mode in ("transcribe", "segment"):
            with patch.dict(os.environ, {"LOCAL_ASR_DECODER": mode}), patch.dict(sys.modules, {"recognition": types.SimpleNamespace(transcribe_segment=decode)}):
                results = [self.worker["transcribe_audio"](audio, None),
                           self.worker["handle"]({"operation": "transcribe_mulaw", "payload": wire})]
                for result in results:
                    self.assertEqual(result["decoder"], mode)
                    self.assertTrue(result["text"])
                    self.assertGreater(result["input_rms"], 0)
                    self.assertLess(result["input_rms"], 0.002)
                    self.assertNotIn("skip_reason", result)
        self.assertEqual(len(self.heard), 2)
        self.assertEqual(decode.call_count, 2)
        np.testing.assert_array_equal(self.heard[0][0], audio)

    def test_short_or_invalid_audio_does_not_reach_decoder(self):
        result = self.worker["transcribe_audio"](np.ones(1599, dtype=np.float32) * 0.1, None)
        self.assertEqual(result["skip_reason"], "too_short")
        for value in (float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                self.worker["transcribe_audio"](np.full(16000, value), None)
        self.assertEqual(self.heard, [])

    def test_opt_in_decoder_receives_resampled_audio_and_language_hint(self):
        from unittest.mock import Mock
        decode = Mock(return_value={"text": "Hola", "language": "ca", "decoder": "segment"})
        wire = self.worker["handle"]({"operation": "speak", "text": "Hola", "language": "ca", "wire": True})
        with patch.dict(os.environ, {"LOCAL_ASR_DECODER": "segment"}), patch.dict(sys.modules, {"recognition": types.SimpleNamespace(transcribe_segment=decode)}):
            result = self.worker["handle"]({"operation": "transcribe_mulaw", "payload": wire["payload"], "language": "ca"})
        self.assertEqual(result["decoder"], "segment")
        self.assertEqual(len(decode.call_args.args[0]), 16000)
        self.assertEqual(decode.call_args.args[2], "ca")
        self.assertEqual(self.heard, [])

    def test_oversized_or_malformed_payloads_are_rejected(self):
        for payload in ["!bad", "", "a" * 320001]:
            with self.assertRaises(ValueError):
                self.worker["handle"]({"operation": "transcribe_mulaw", "payload": payload})
        self.assertEqual(self.heard, [])


if __name__ == "__main__":
    unittest.main()
