"""Private JSON-lines worker: persistent MLX Whisper/Piper and timed microphone input.

No network listener, clinic credentials, or shell execution. Bun owns its lifetime.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import time
import wave

os.umask(0o077)
ROOT = Path(sys.argv[1]).resolve()
VOICES = {"en": "en_US-lessac-medium", "es": "es_ES-davefx-medium", "ca": "ca_ES-upc_ona-medium"}

with contextlib.redirect_stdout(sys.stderr):
    import numpy as np
    import mlx_whisper
    import sounddevice as sd
    import soundfile as sf
    from piper import PiperVoice

voices = {}


def audio_path(name):
    path = (ROOT / "audio" / name).resolve()
    if path.parent != ROOT / "audio" or path.suffix != ".wav":
        raise ValueError("Expected a .wav basename in the private audio directory")
    return path


def resample(audio, old_rate, new_rate):
    if old_rate == new_rate:
        return audio
    # scipy's polyphase filter avoids aliasing across the 8 kHz phone boundary.
    from scipy.signal import resample_poly
    from math import gcd
    divisor = gcd(int(old_rate), int(new_rate))
    return resample_poly(audio, new_rate // divisor, old_rate // divisor).astype(np.float32)


def transcribe(path, language):
    audio, rate = sf.read(path, dtype="float32", always_2d=True)
    audio = resample(audio.mean(axis=1), rate, 16000)
    if len(audio) < 1600 or float(np.sqrt(np.mean(audio ** 2))) < 0.002:
        return {"text": "", "language": language or "unknown"}
    result = mlx_whisper.transcribe(audio, path_or_hf_repo=str(ROOT / "whisper"),
                                    language=language or None, verbose=None,
                                    condition_on_previous_text=False, temperature=0.0)
    return {"text": result["text"].strip(), "language": result.get("language", language)}


def handle(request):
    operation = request["operation"]
    if operation == "warmup":
        from mlx_whisper.transcribe import ModelHolder
        import mlx.core as mx
        ModelHolder.get_model(str(ROOT / "whisper"), mx.float16)
        for language, name in VOICES.items():
            voices[language] = PiperVoice.load(str(ROOT / "voices" / (name + ".onnx")))
        return {"ready": True}
    if operation == "speak":
        language = request.get("language", "en")
        if language not in VOICES:
            raise ValueError("Supported speech languages: en, es, ca")
        text = request["text"]
        if not isinstance(text, str) or not text.strip() or len(text) > 4000:
            raise ValueError("Speech text must contain 1–4000 characters")
        voice = voices.get(language)
        if voice is None:
            voice = PiperVoice.load(str(ROOT / "voices" / (VOICES[language] + ".onnx")))
            voices[language] = voice
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as output:
            voice.synthesize_wav(text, output)
        buffer.seek(0)
        audio, rate = sf.read(buffer, dtype="float32")
        if request.get("telephone", True):
            import audioop  # Python 3.12 is pinned by the launcher.
            narrow = resample(audio, rate, 8000)
            pcm = (np.clip(narrow, -1, 1) * 32767).astype("<i2").tobytes()
            decoded = audioop.ulaw2lin(audioop.lin2ulaw(pcm, 2), 2)
            audio = resample(np.frombuffer(decoded, dtype="<i2").astype(np.float32) / 32768, 8000, 16000)
            rate = 16000
        path = audio_path(request["file"])
        sf.write(path, audio, rate, subtype="PCM_16")
        if request.get("play", False):
            sd.play(audio, rate)
            sd.wait()
        return {"file": path.name, "duration_ms": round(len(audio) / rate * 1000)}
    if operation == "transcribe":
        return transcribe(audio_path(request["file"]), request.get("language"))
    if operation == "record":
        seconds = float(request.get("seconds", 8))
        if not 1 <= seconds <= 30:
            raise ValueError("Recording duration must be 1–30 seconds")
        rate = int(sd.query_devices(kind="input")["default_samplerate"])
        audio = sd.rec(int(seconds * rate), samplerate=rate, channels=1, dtype="float32")
        sd.wait()
        path = audio_path(request["file"])
        sf.write(path, resample(audio[:, 0], rate, 16000), 16000, subtype="PCM_16")
        return transcribe(path, request.get("language"))
    raise ValueError("Unknown audio operation")


for line in sys.stdin:
    request = {}
    started = time.monotonic()
    try:
        request = json.loads(line)
        with contextlib.redirect_stdout(sys.stderr):
            result = handle(request)
        response = {"id": request["id"], "result": result,
                    "elapsed_ms": round((time.monotonic() - started) * 1000)}
    except Exception as error:
        response = {"id": request.get("id"), "error": str(error)}
    print(json.dumps(response, ensure_ascii=False), flush=True)
