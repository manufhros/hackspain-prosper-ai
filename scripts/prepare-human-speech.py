"""Download a fixed FLEURS subset and prepare codecs; never loads models or devices."""
import argparse
import audioop
import base64
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import urllib.request

REVISION = "70bb2e84b976b7e960aa89f1c648e09c59f894dd"
BASE = f"https://huggingface.co/datasets/google/fleurs/resolve/{REVISION}/data"
LANGUAGES = {"en": "en_us", "es": "es_419", "ca": "ca_es"}


def prepare(directory):
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly
    from math import gcd

    os.umask(0o077)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest = directory / "manifest.json"
    if manifest.exists():
        print(f"Reusing {manifest}; archive the directory to deliberately regenerate.")
        return
    clips = []
    for language, config in LANGUAGES.items():
        print(f"Preparing {language}: first 10 distinct test sentences, 1–20 seconds, in archive order…", flush=True)
        with urllib.request.urlopen(f"{BASE}/{config}/test.tsv", timeout=30) as response:
            rows = list(csv.reader(io.StringIO(response.read(4 * 1024 * 1024).decode("utf-8")), delimiter="\t"))
        references = {row[1]: row for row in rows if len(row) >= 7}
        seen = set()
        with urllib.request.urlopen(f"{BASE}/{config}/audio/test.tar.gz", timeout=30) as response:
            with tarfile.open(fileobj=response, mode="r|gz") as archive:
                for member in archive:
                    name = Path(member.name).name
                    row = references.get(name)
                    if not member.isfile() or not row or row[0] in seen or not 44 < member.size <= 2 * 1024 * 1024:
                        continue
                    original = archive.extractfile(member).read()
                    audio, rate = sf.read(io.BytesIO(original), dtype="float32", always_2d=True)
                    if not 1 <= len(audio) / rate <= 20:
                        continue
                    audio = audio.mean(axis=1)
                    divisor = gcd(rate, 16000)
                    clean = resample_poly(audio, 16000 // divisor, rate // divisor) if rate != 16000 else audio
                    clean = np.clip(clean, -1, 1)
                    # Match the worker's 16 kHz -> 8 kHz polyphase/mu-law path.
                    narrow = resample_poly(clean, 1, 2).astype(np.float32)
                    pcm = (np.clip(narrow, -1, 1) * 32767).astype("<i2").tobytes()
                    wire = audioop.lin2ulaw(pcm, 2)
                    clip_id = f"{language}-{Path(name).stem}"
                    filename = f"{clip_id}.wav"
                    sf.write(directory / filename, clean, 16000, subtype="PCM_16")
                    clips.append({"id": clip_id, "language": language, "sentence_id": row[0],
                        "reference": row[2], "config": config, "source_member": member.name,
                        "source_sha256": hashlib.sha256(original).hexdigest(),
                        "clean_file": filename, "clean_sha256": hashlib.sha256((directory / filename).read_bytes()).hexdigest(),
                        "wire_payload": base64.b64encode(wire).decode("ascii"), "wire_sha256": hashlib.sha256(wire).hexdigest(),
                        "duration_ms": round(len(clean) / 16)})
                    seen.add(row[0])
                    if len(seen) == 10:
                        break
        if len(seen) != 10:
            raise ValueError(f"Expected 10 distinct {language} sentences, found {len(seen)}")
    value = {"version": 1, "source": "google/fleurs", "revision": REVISION,
        "source_url": "https://huggingface.co/datasets/google/fleurs", "license": "CC-BY-4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/", "split": "test",
        "selection": "First 10 distinct sentence IDs per language in archive order with duration 1–20 s; selected before recognition. Spanish is es_419 (Latin America).",
        "modifications": "Mono 16 kHz PCM16 WAV and polyphase-resampled 8 kHz mu-law; transcripts unchanged.", "clips": clips}
    temporary = directory / "manifest.json.tmp"
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(manifest)
    print(f"Saved {len(clips)} clips: {manifest}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent.parent / ".workbench/human-speech")
    prepare(parser.parse_args().output)
