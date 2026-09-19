"""Finite live-monitor mixer tests: no sounddevice import or audio device opened."""
import audioop
import base64
from pathlib import Path
import runpy
import struct
import unittest

Mixer = runpy.run_path(str(Path(__file__).resolve().parents[1] / "local-voice/monitor.py"))["Mixer"]


class MonitorTests(unittest.TestCase):
    def push(self, mixer, role, value):
        mixer.push(role, base64.b64encode(bytes([value]) * 160).decode())

    def test_underflow_is_silence_and_each_lane_is_audible(self):
        mixer = Mixer()
        self.assertEqual(mixer.render(160), bytes(320))
        for lane in ["caller", "agent"]:
            self.push(mixer, lane, 0x81)
            self.assertEqual(mixer.render(160), audioop.ulaw2lin(bytes([0x81]) * 160, 2))
        self.assertFalse(mixer.pending())

    def test_overlap_mixes_and_clips_without_wrapping(self):
        mixer = Mixer()
        self.push(mixer, "caller", 0x80)
        self.push(mixer, "agent", 0x80)
        self.assertEqual(mixer.render(160), struct.pack("<h", 32767) * 160)

    def test_queue_is_bounded_and_old_frames_are_dropped(self):
        mixer = Mixer()
        for _ in range(50):
            self.push(mixer, "caller", 0x81)
        for _ in range(10):
            self.push(mixer, "caller", 0xff)
        self.assertEqual(mixer.render(1600), bytes(3200))
        self.assertFalse(mixer.pending())

    def test_invalid_frames_are_rejected(self):
        mixer = Mixer()
        for role, payload in [("unknown", ""), ("caller", "%%%"), ("agent", "YQ=="), ("caller", "A" * 1024)]:
            with self.assertRaises(ValueError):
                mixer.push(role, payload)


if __name__ == "__main__":
    unittest.main()
