"""Finite capture lifecycle tests with fake audio; no device or worker starts."""
import importlib.util
import io
import json
import os
import runpy
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class CallbackStop(Exception):
    pass


class Stream:
    fail_start = False

    def __init__(self, **options):
        self.options = options
        self.started = self.stopped = self.closed = 0

    def start(self):
        self.started += 1
        if self.fail_start:
            raise RuntimeError("Permission denied")

    def stop(self):
        self.stopped += 1

    def close(self):
        self.closed += 1


class Block:
    def __init__(self, values):
        self.values = values

    def __getitem__(self, key):
        return self.values[key[0]]


fake_sd = types.SimpleNamespace(query_devices=lambda **kw: {"default_samplerate": 10},
                                InputStream=Stream, CallbackStop=CallbackStop)
fake_np = types.SimpleNamespace(concatenate=lambda blocks: sum(blocks, []), empty=lambda *a, **kw: [])
with patch.dict(sys.modules, {"numpy": fake_np, "sounddevice": fake_sd}):
    spec = importlib.util.spec_from_file_location("recording", Path(__file__).parent.parent / "local-voice/recording.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


class RecordingTests(unittest.TestCase):
    def test_stops_at_bound_and_preserves_partial_final_block(self):
        capture = module.Recording(seconds=1)
        capture.capture(Block([1] * 6), 6, None, None)
        with self.assertRaises(CallbackStop):
            capture.capture(Block([2] * 6), 6, None, None)
        audio, rate = capture.finish()
        self.assertEqual(audio, [1] * 6 + [2] * 4)
        self.assertEqual(rate, 10)
        capture.close()
        self.assertEqual((capture.stream.started, capture.stream.stopped, capture.stream.closed), (1, 1, 1))

    def test_discard_and_empty_capture_close_without_samples(self):
        capture = module.Recording()
        self.assertEqual(capture.finish(), ([], 10))
        capture.close()
        self.assertEqual(capture.stream.closed, 1)

    def test_overflow_is_visible_and_still_releases_device(self):
        capture = module.Recording()
        capture.capture(Block([1]), 1, None, "input overflow")
        with self.assertRaisesRegex(ValueError, "input overflow"):
            capture.finish()
        self.assertEqual(capture.stream.closed, 1)

    def test_start_failure_releases_device(self):
        stream = Stream()
        stream.fail_start = True
        with patch.object(fake_sd, "InputStream", return_value=stream):
            with self.assertRaisesRegex(RuntimeError, "Permission denied"):
                module.Recording()
        self.assertEqual(stream.closed, 1)


class WorkerTests(unittest.TestCase):
    def run_worker(self, requests):
        captures, writes = [], []

        class Capture:
            def __init__(self):
                self.closed = False
                captures.append(self)

            def finish(self):
                self.close()
                return [0.1] * 1600, 16000

            def close(self):
                self.closed = True

        modules = {"numpy": fake_np, "sounddevice": fake_sd,
                   "mlx_whisper": types.SimpleNamespace(),
                   "soundfile": types.SimpleNamespace(write=lambda *a, **kw: writes.append(a)),
                   "piper": types.SimpleNamespace(PiperVoice=object),
                   "recording": types.SimpleNamespace(Recording=Capture)}
        output = io.StringIO()
        source = io.StringIO("".join(json.dumps({"id": str(i), **r}) + "\n" for i, r in enumerate(requests)))
        old_mask = os.umask(0o077)
        try:
            with patch.dict(sys.modules, modules), patch.object(sys, "stdin", source), patch.object(sys, "stdout", output), patch.object(sys, "argv", ["worker.py", "/tmp/synthetic-voice"]):
                runpy.run_path(str(Path(__file__).parent.parent / "local-voice/worker.py"))
        finally:
            os.umask(old_mask)
        return [json.loads(line) for line in output.getvalue().splitlines()], captures, writes

    def test_start_stop_returns_audio_for_separate_transcription(self):
        replies, captures, writes = self.run_worker([
            {"operation": "record_start"}, {"operation": "record_stop", "file": "test.wav"},
            {"operation": "record_cancel"}])
        self.assertTrue(replies[0]["result"]["recording"])
        self.assertEqual(replies[1]["result"], {"file": "test.wav", "duration_ms": 100})
        self.assertTrue(replies[2]["result"]["cancelled"])
        self.assertTrue(captures[0].closed)
        self.assertEqual(len(writes), 1)

    def test_duplicate_start_discard_and_eof_release_capture(self):
        replies, captures, writes = self.run_worker([
            {"operation": "record_start"}, {"operation": "record_start"},
            {"operation": "record_cancel"}, {"operation": "record_start"}])
        self.assertIn("already in progress", replies[1]["error"])
        self.assertEqual(len(captures), 2)
        self.assertTrue(all(capture.closed for capture in captures))
        self.assertEqual(writes, [])


if __name__ == "__main__":
    unittest.main()
