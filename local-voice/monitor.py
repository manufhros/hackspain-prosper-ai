"""Output-only live call monitor. No models, microphone, network or credentials."""
import audioop
import base64
from collections import deque
import json
import sys
import threading
import time


class Mixer:
    """Bound each lane to 200ms; a slow audio device must never delay the call."""
    def __init__(self):
        self.lanes = {"caller": deque(maxlen=3200), "agent": deque(maxlen=3200)}
        self.lock = threading.Lock()

    def push(self, role, payload):
        if role not in self.lanes or not isinstance(payload, str) or len(payload) > 216:
            raise ValueError("Expected one 20ms mu-law frame")
        raw = base64.b64decode(payload, validate=True)
        if len(raw) != 160:
            raise ValueError("Expected 160 mu-law bytes")
        pcm = audioop.ulaw2lin(raw, 2)
        with self.lock:
            self.lanes[role].extend(pcm)

    def render(self, frames):
        count = frames * 2
        with self.lock:
            channels = [bytes(lane.popleft() for _ in range(min(count, len(lane)))).ljust(count, b"\0")
                        for lane in self.lanes.values()]
        return audioop.add(channels[0], channels[1], 2)

    def pending(self):
        with self.lock:
            return any(self.lanes.values())


def main():
    import sounddevice as sd
    mixer = Mixer()

    def output(outdata, frames, _timing, _status):
        outdata[:] = mixer.render(frames)

    # RawOutputStream never requests microphone permission. CoreAudio uses the
    # Mac's selected output device, including headphones; PortAudio handles 8kHz.
    with sd.RawOutputStream(samplerate=8000, blocksize=160, channels=1,
                            dtype="int16", latency="low", callback=output):
        print("ready", flush=True)
        while True:
            line = sys.stdin.buffer.readline(1024)
            if not line:
                break
            if len(line) >= 1024:
                raise ValueError("Oversized monitor frame")
            message = json.loads(line)
            mixer.push(message["role"], message["payload"])
        # EOF drains the short speaker buffer; Ctrl-C is handled by the owner.
        deadline = time.monotonic() + 0.3
        while mixer.pending() and time.monotonic() < deadline:
            time.sleep(0.01)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Audio output unavailable. Check the Mac output device.", file=sys.stderr, flush=True)
        sys.exit(1)
