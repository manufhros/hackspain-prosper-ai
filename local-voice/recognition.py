"""Opt-in single-window decoding for endpointed speech (no cross-call state)."""
import math


def transcribe_segment(audio, model_path, language):
    import mlx.core as mx
    import mlx_whisper
    from mlx_whisper.audio import N_FRAMES, N_SAMPLES, log_mel_spectrogram, pad_or_trim
    from mlx_whisper.decoding import DecodingOptions
    from mlx_whisper.transcribe import ModelHolder

    def full():
        result = mlx_whisper.transcribe(audio, path_or_hf_repo=model_path, language=language or None,
                                        verbose=None, condition_on_previous_text=False, temperature=0.0)
        return {"text": result["text"].strip(), "language": result.get("language", language),
                "decoder": "transcribe_fallback"}

    # Never trim a long microphone recording to one window.
    if len(audio) > N_SAMPLES:
        return full()
    model = ModelHolder.get_model(model_path, mx.float16)
    mel = log_mel_spectrogram(audio, n_mels=model.dims.n_mels, padding=N_SAMPLES)
    mel = pad_or_trim(mel, N_FRAMES, axis=-2).astype(mx.float16)
    # DecodingTask encodes once, then uses those features for both language
    # detection and transcription. Text-only decoding covers the whole window.
    result = model.decode(mel, DecodingOptions(language=language or None, task="transcribe",
                                              temperature=0.0, without_timestamps=True, fp16=True))
    if not all(math.isfinite(value) for value in (result.no_speech_prob, result.avg_logprob, result.compression_ratio)):
        return full()
    # Match transcribe's no-speech gate before considering quality fallback.
    if result.no_speech_prob > 0.6 and result.avg_logprob <= -1.0:
        return {"text": "", "language": result.language, "decoder": "segment"}
    # The pinned decoder loop runs sample_len - 1 steps and appends EOT even
    # when exhausted. Do not accept that potentially truncated text as complete.
    if len(result.tokens) >= model.dims.n_text_ctx // 2 - 1 or result.compression_ratio > 2.4 or result.avg_logprob < -1.0:
        return full()
    return {"text": result.text.strip(), "language": result.language, "decoder": "segment"}
