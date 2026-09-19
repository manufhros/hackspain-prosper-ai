"""Private JSON-lines worker: persistent MLX Whisper/Piper and push-to-talk microphone input.

No network listener, clinic credentials, or shell execution. Bun owns its lifetime.
"""
import base64
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
ROLE = sys.argv[2] if len(sys.argv) > 2 else "all"
ASR_ROOT = ROOT / ("whisper-large-v3-turbo" if os.environ.get("LOCAL_ASR_MODEL") == "large-v3-turbo" else "whisper")
VOICES = {"en": "en_US-lessac-medium", "es": "es_ES-davefx-medium", "ca": "ca_ES-upc_ona-medium"}

with contextlib.redirect_stdout(sys.stderr):
    import numpy as np
    if ROLE != "tts":
        import mlx_whisper
    import sounddevice as sd
    import soundfile as sf
    if ROLE != "asr":
        from piper import PiperVoice
    from recording import Recording

def load_voice(language):
    # Construct the pinned Piper voice with bounded CPU threads, avoiding one thread pool per core per voice.
    import onnxruntime as ort
    from piper.config import PiperConfig
    name = ROOT / "voices" / (VOICES[language] + ".onnx")
    options = ort.SessionOptions()
    options.intra_op_num_threads = int(os.environ.get("LOCAL_TTS_THREADS", "2"))
    options.inter_op_num_threads = 1
    return PiperVoice(config=PiperConfig.from_dict(json.loads(Path(str(name) + ".json").read_text())),
                      session=ort.InferenceSession(str(name), sess_options=options, providers=["CPUExecutionProvider"]))


voices = {}
recording = None


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
    return transcribe_audio(audio, language)


def transcribe_audio(audio, language):
    if not np.isfinite(audio).all():
        raise ValueError("Recognition audio must contain finite samples")
    rms = float(np.sqrt(np.mean(audio ** 2))) if len(audio) else 0.0
    # Quiet speech is still speech. Leave speech/no-speech decisions to Whisper;
    # only bypass decoding for too-short input or exact digital silence.
    skip = "too_short" if len(audio) < 1600 else "digital_silence" if not np.any(audio) else None
    if skip:
        return {"text": "", "language": language or "unknown", "decoder": "skipped",
                "skip_reason": skip, "input_rms": rms}
    if os.environ.get("LOCAL_ASR_DECODER", "transcribe") == "segment":
        from recognition import transcribe_segment
        return {**transcribe_segment(audio, str(ASR_ROOT), language), "input_rms": rms}
    result = mlx_whisper.transcribe(audio, path_or_hf_repo=str(ASR_ROOT),
                                    language=language or None, verbose=None,
                                    condition_on_previous_text=False, temperature=0.0)
    return {"text": result["text"].strip(), "language": result.get("language", language),
            "decoder": "transcribe", "input_rms": rms}


def handle(request):
    global recording
    operation = request["operation"]
    if operation == "warmup":
        if ROLE != "tts":
            from mlx_whisper.transcribe import ModelHolder
            import mlx.core as mx
            ModelHolder.get_model(str(ASR_ROOT), mx.float16)
            # Loading weights alone does not compile the MLX transcription graph.
            transcribe_audio(np.random.default_rng(0).normal(0, 0.01, 16000).astype(np.float32), "en")
        if ROLE != "asr":
            for language in VOICES:
                voices[language] = load_voice(language)
                with wave.open(io.BytesIO(), "wb") as output:
                    voices[language].synthesize_wav({"en": "Ready.", "es": "Hola.", "ca": "Hola."}[language], output)
        return {"ready": True}
    if operation == "transcribe_mulaw":
        import audioop
        payload = request.get("payload", "")
        if not isinstance(payload, str) or not 1 <= len(payload) <= 320000:
            raise ValueError("Expected at most 30 seconds of mu-law audio")
        raw = base64.b64decode(payload, validate=True)
        if not 1 <= len(raw) <= 240000:
            raise ValueError("Expected at most 30 seconds of mu-law audio")
        pcm = np.frombuffer(audioop.ulaw2lin(raw, 2), dtype="<i2").astype(np.float32) / 32768
        return transcribe_audio(resample(pcm, 8000, 16000), request.get("language"))
    if operation == "speak":
        language = request.get("language", "en")
        if language not in VOICES:
            raise ValueError("Supported speech languages: en, es, ca")
        text = request["text"]
        if not isinstance(text, str) or not text.strip() or len(text) > 4000:
            raise ValueError("Speech text must contain 1–4000 characters")
        voice = voices.get(language)
        if voice is None:
            voice = load_voice(language)
            voices[language] = voice
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as output:
            voice.synthesize_wav(text, output)
        buffer.seek(0)
        audio, rate = sf.read(buffer, dtype="float32")
        if request.get("wire", False):
            import audioop
            narrow = resample(audio, rate, 8000)
            if len(narrow) > 8000 * 60:
                raise ValueError("Spoken turn exceeds 60 seconds")
            pcm = (np.clip(narrow, -1, 1) * 32767).astype("<i2").tobytes()
            return {"payload": base64.b64encode(audioop.lin2ulaw(pcm, 2)).decode("ascii"),
                    "duration_ms": round(len(narrow) / 8)}
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
    if operation == "record_start":
        if recording is not None:
            raise ValueError("A recording is already in progress")
        recording = Recording()
        return {"recording": True}
    if operation in ("record_stop", "record_cancel"):
        capture, recording = recording, None
        if capture is None:
            if operation == "record_cancel":
                return {"cancelled": True}
            raise ValueError("No recording is in progress")
        try:
            if operation == "record_cancel":
                return {"cancelled": True}
            audio, rate = capture.finish()
            if len(audio) < rate / 10:
                return {"text": "", "duration_ms": 0}
            path = audio_path(request["file"])
            sf.write(path, resample(audio, rate, 16000), 16000, subtype="PCM_16")
            return {"file": path.name, "duration_ms": round(len(audio) / rate * 1000)}
        finally:
            capture.close()
    raise ValueError("Unknown audio operation")


try:
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
finally:
    if recording is not None:
        recording.close()
