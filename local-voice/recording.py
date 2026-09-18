"""Bounded, non-blocking microphone capture used by the JSON-lines worker."""
import numpy as np
import sounddevice as sd


class Recording:
    def __init__(self, seconds=30):
        self.rate = int(sd.query_devices(kind="input")["default_samplerate"])
        self.limit = int(self.rate * seconds)
        self.frames = 0
        self.blocks = []
        self.error = None
        self.closed = False
        self.stream = sd.InputStream(samplerate=self.rate, channels=1,
                                     dtype="float32", callback=self.capture)
        try:
            self.stream.start()
        except BaseException:
            self.stream.close()
            raise

    def capture(self, data, frames, timing, status):
        if status:
            self.error = str(status)
        count = min(frames, self.limit - self.frames)
        if count > 0:
            self.blocks.append(data[:count, 0].copy())
            self.frames += count
        if self.frames >= self.limit:
            raise sd.CallbackStop

    def close(self):
        if not self.closed:
            self.closed = True
            try:
                self.stream.stop()
            finally:
                self.stream.close()

    def finish(self):
        self.close()
        if self.error:
            raise ValueError("Microphone capture failed: " + self.error)
        if not self.frames:
            return np.empty(0, dtype="float32"), self.rate
        return np.concatenate(self.blocks), self.rate
