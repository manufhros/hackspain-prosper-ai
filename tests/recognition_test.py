"""Decoder routing and safeguards with synthetic modules; no native models/devices."""
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import numpy as np

spec = importlib.util.spec_from_file_location("recognition", Path(__file__).parent.parent / "local-voice/recognition.py")
recognition = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recognition)


class SegmentRecognitionTests(unittest.TestCase):
    def setUp(self):
        self.audio = np.ones(16000, dtype=np.float32) * 0.1
        self.result = SimpleNamespace(text=" Hola ", language="ca", tokens=[1, 2],
                                      no_speech_prob=0.01, avg_logprob=-0.2, compression_ratio=1.0)
        self.model = SimpleNamespace(dims=SimpleNamespace(n_mels=128, n_text_ctx=448), decode=Mock(return_value=self.result))
        self.load = Mock(return_value=self.model)
        self.full = Mock(return_value={"text": " Full recording ", "language": "es"})
        self.mel = Mock(return_value=np.zeros((3100, 128), dtype=np.float32))
        mx = SimpleNamespace(float16=np.float16)
        modules = {"mlx": SimpleNamespace(core=mx), "mlx.core": mx,
                   "mlx_whisper": SimpleNamespace(transcribe=self.full),
                   "mlx_whisper.audio": SimpleNamespace(N_FRAMES=3000, N_SAMPLES=480000,
                       log_mel_spectrogram=self.mel, pad_or_trim=lambda mel, length, axis: mel[:length]),
                   "mlx_whisper.decoding": SimpleNamespace(DecodingOptions=SimpleNamespace),
                   "mlx_whisper.transcribe": SimpleNamespace(ModelHolder=SimpleNamespace(get_model=self.load))}
        self.modules = patch.dict(sys.modules, modules)
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def run_segment(self, audio=None, language=None):
        return recognition.transcribe_segment(self.audio if audio is None else audio, "/private/test-model", language)

    def test_one_decode_per_utterance_detects_language_without_persisting_a_hint(self):
        self.assertEqual(self.run_segment(), {"text": "Hola", "language": "ca", "decoder": "segment"})
        mel, options = self.model.decode.call_args.args
        self.assertEqual(mel.shape, (3000, 128))
        self.assertEqual(mel.dtype, np.float16)
        self.assertEqual(options.task, "transcribe")
        self.assertIsNone(options.language)
        self.assertTrue(options.without_timestamps)
        self.result.language = "es"
        self.assertEqual(self.run_segment()["language"], "es")
        self.assertIsNone(self.model.decode.call_args.args[1].language)
        self.assertEqual(self.model.decode.call_count, 2)
        self.full.assert_not_called()
        self.assertEqual(self.mel.call_args.kwargs["n_mels"], 128)

    def test_explicit_language_is_preserved(self):
        self.run_segment(language="ca")
        self.assertEqual(self.model.decode.call_args.args[1].language, "ca")
        self.full.assert_not_called()

    def test_long_audio_uses_full_transcription_without_trimming_or_loading_twice(self):
        audio = np.zeros(480001, dtype=np.float32)
        result = self.run_segment(audio, "es")
        self.assertEqual(result["text"], "Full recording")
        self.assertEqual(result["decoder"], "transcribe_fallback")
        self.assertIs(self.full.call_args.args[0], audio)
        self.assertEqual(self.full.call_args.kwargs["language"], "es")
        self.assertFalse(self.full.call_args.kwargs["condition_on_previous_text"])
        self.load.assert_not_called()

    def test_no_speech_filter_retains_confident_speech(self):
        self.result.no_speech_prob = 0.9
        self.result.avg_logprob = -1.1
        self.assertEqual(self.run_segment()["text"], "")
        self.result.avg_logprob = -0.2
        self.assertEqual(self.run_segment()["text"], "Hola")
        self.full.assert_not_called()

    def test_token_exhaustion_repetition_and_uncertain_outputs_use_full_recording(self):
        for field, value in [("tokens", list(range(223))), ("compression_ratio", 3.0),
                             ("avg_logprob", -1.1), ("avg_logprob", float("nan"))]:
            original = getattr(self.result, field)
            with self.subTest(field=field, value=str(value)[:20]):
                setattr(self.result, field, value)
                self.assertEqual(self.run_segment()["decoder"], "transcribe_fallback")
                self.assertIs(self.full.call_args.args[0], self.audio)
                self.assertIsNone(self.full.call_args.kwargs["language"])
                setattr(self.result, field, original)


if __name__ == "__main__":
    unittest.main()
