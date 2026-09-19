# El Turno — hackathon workbench

A Bun TUI for rehearsing the Prosper track with local speech on Apple Silicon and either local Qwen or an OpenRouter language model. It includes the complete task archive, real Prosper clinic reads, automated caller/receptionist conversations, microphone practice, result comparison, and a Twilio-compatible WebSocket endpoint for real platform calls.

Add your desk-issued token to a Git-ignored `.env` (see `.env.example`):

```dotenv
PLATFORM_API_KEY=your-team-token
PLATFORM_API_BASE_URL=https://hackspain.getprosperapp.com
```

```sh
bun install
bun start
```

By default the language model is local Qwen. Requires Bun 1.4.2+, Apple Silicon macOS, an interactive terminal, and Homebrew if `uv` or `llama-server` is missing. **`bun start` sets up and starts the local stack automatically:**

- Installs missing `uv`/`llama.cpp` using Homebrew and creates a private Python 3.12 environment with locked audio dependencies.
- Downloads Qwen3.5 4B Q4_K_M for llama.cpp (~2.74 GB), Whisper small for MLX (~481 MB), and Piper English/Spanish/Catalan voices (~190 MB total), plus Silero VAD (~2.3 MB) and runtime dependencies. Allow several GB of disk space and time for the first launch.
- Starts its own loopback-only llama-server process and separate persistent recognition and speech workers, warms the models, then shows **Voice ready**. Cached models/dependencies are reused on later starts.
- Quitting stops only processes owned by this session. An existing Ollama daemon is left alone. A failed setup can be retried from **Voice → Voice stack**.

The stack is sized for your M4 Pro / 48 GB Mac. The first Ollama benchmark exposed serialization and Catalan recognition errors; the replacement llama.cpp profile now completes the synthetic benchmark, but burst latency and Catalan recognition remain unresolved. Live-call capacity is not validated. No paid voice provider, local clinic database, or tunnel is required. Speech smoke tests work without an API token; case rehearsals use the [original Prosper API](https://hackspain.getprosperapp.com/api/redoc). Bun loads `.env` on startup; restart after changing it.

For browsing, manual results, or API exploration without model downloads/startup, use `bun start --offline`. Finite commands such as `bun run doctor` and `bun run check` never start services.

## Optional reception screen

Run `bun run serve --edge` to serve a touch-friendly voice kiosk at `http://127.0.0.1:7860/edge/` on the backend device. Omitting `--edge` keeps the server headless. The screen and voice backend run in one Bun process, with no separate frontend server or build step. Spanish, Catalan and English controls support start, microphone pause, end and directions to in-person help.

Kiosk conversations are explicitly **practice only**: they reuse the voice agent but never submit synthetic calls to Prosper, and their reports/transcripts are not saved by the kiosk transport. The existing backend is a test-call integration, not a hospital booking system. Kiosk access is loopback-only and stays outside the public telephony tunnel. See [kiosk deployment and transport](src/edge/README.md).

## Local inference and concurrency

Comment out `LLM_PROVIDER=openrouter` in your private `.env`, or set `LLM_PROVIDER=local`. Other `OPENROUTER_*` settings are ignored in local mode. The local stack makes no cloud model requests or automatic provider fallbacks. Prosper clinic reads and official test submissions still use its API. The setup phase downloads dependencies/model assets; inference uses cached local files.

| Setting | Default | Purpose |
| --- | --- | --- |
| `LOCAL_LLM_BACKEND` | `llama` | Native llama.cpp server; `ollama` retains the serialized baseline for comparison. |
| `LOCAL_LLM_PARALLEL` | `4` | llama-server slots for one resident Qwen3.5 4B model, 1–8. Remaining turns wait in a bounded queue. Ollama is explicitly limited to one slot. |
| `LOCAL_LLM_CONTEXT` | `16384` | Context tokens per model request, 4096–32768; preserves the previous request context budget. More parallel slots/context increase memory usage. |
| `LOCAL_LLM_MAX_TOKENS` | `512` | Output limit, 128–2048. Thinking stays disabled; truncated responses fail visibly. |
| `LOCAL_TTS_WORKERS` | `2` | Independent persistent Piper workers, 1–4, each loading all three voices. |
| `LOCAL_TTS_THREADS` | `2` | CPU threads per Piper ONNX session, 1–4; inter-op threads are fixed at one. |
| `LOCAL_ASR_MODEL` | `small` | MLX multilingual Whisper; `large-v3-turbo` downloads separate pinned ~1.6 GB weights for comparison. |
| `LOCAL_ASR_DECODER` | `transcribe` | Existing full transcription; `segment` opts into one-encoding, text-only decoding for utterances up to 30 seconds. Synthetic small-model results improved; human speech and live-call quality remain unverified. |

The default llama-server uses Metal, continuous batching and the GGUF's embedded Jinja tool template, with thinking disabled. Startup verifies the server's reported slot count and per-slot context; the total context allocation is `LOCAL_LLM_CONTEXT × LOCAL_LLM_PARALLEL`. The llama backend downloads a separate [pinned Unsloth Qwen3.5 4B Q4_K_M conversion](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/blob/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-Q4_K_M.gguf) (~2.74 GB), verifies its SHA-256 and caches it under its source revision. It never reuses the Ollama blob: that file has three RoPE sections and a different tensor layout, while [the installed llama.cpp loader requires four](https://github.com/ggml-org/llama.cpp/blob/b29c606e2/src/models/qwen35.cpp). Native loading and synthetic inference succeeded with build `b10964-b29c606e2` in `benchmark-1789818581312.json`; startup reported four slots with 16384 context tokens each. The old Ollama cache stays available for its baseline backend. Whisper remains on MLX and Piper on CPU. Increasing slots is a benchmark variable, not a guarantee of lower latency. Twenty admitted calls share these resources; they do not load twenty model copies.

[Ollama 0.34.1 forces Qwen3.5 to one slot](https://github.com/ollama/ollama/blob/v0.34.1/server/sched.go), ignoring a larger `OLLAMA_NUM_PARALLEL`. The previous four-client configuration therefore did not provide four active model slots. The optional Ollama baseline now uses one explicit client/server slot so the wait is visible in the application queue. [llama-server documents parallel decoding, continuous batching and tool calls](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

Platform speech is validated before synthesis. The first short chunk can play while the next is synthesized; only one chunk is prefetched per caller. Interrupted or partially played offers never count as delivered consent. Static greetings/notices retain shared caching; patient-specific speech is not cached. The TUI retains its complete-utterance playback.

Reports include local model queue, prefill, decode and token metrics when the backend provides them; Ollama also supplies load/inference duration. ASR/TTS events retain separate worker/queue timings; TTS events now include chunk indices. Silero state is isolated per call, queued detection is bounded, and disconnect drains already received frames before the final transcription.

### Measure the local profile

Stop the voice TUI/server first, then run this yourself. **The benchmark starts and stops its own local model processes** and may perform first-run setup. It never calls the clinic API or submits actions:

```sh
LLM_PROVIDER=local bun run benchmark
```

The default runs three synchronized batches at each concurrency of 1, 5, 10 and 20. On the first run, it saves the three fixed public synthetic recordings in `.workbench/benchmark-inputs-v1.json`; later runs reuse those exact bytes. Each report includes per-recording and combined `input_audio` SHA-256 hashes. Cached inputs are checked for matching phrases, format and checksums; corrupt/incompatible inputs fail visibly instead of silently changing the test. It records ASR word error rate, structured intent accuracy, native/queue timings and time to the first synthesized response chunk in `.workbench/benchmark-*.json`. Reports also retain the server build/slots/context, llama model asset path and SHA-256, expected and recognized synthetic text, detected language and full operational model metrics. An untimed diagnostic compares automatic language detection with an explicit language hint; production calls still detect language automatically. `successful`/`okay` mean completed jobs with correct intent, not error-free transcription; exact transcription and language scores are separate. Failures remain in the attempted-count denominator. First-chunk latency excludes endpoint detection, transport and playback. Inputs are clean Piper-generated English/Spanish/Catalan speech roundtripped through 8 kHz mu-law: this is an inference stress test, **not human speech quality or live-call capacity proof**. Tool calling, appointment correctness, consent, noise and actual interruption require platform rehearsals separately.

The first run (`benchmark-1789817239476.json`, Ollama 0.34.1, Whisper small) measured:

| Simultaneous synthetic turns | First chunk p50 | First chunk p95 |
| --- | --- | --- |
| 1 | 1.04 s | 1.11 s |
| 5 | 2.47 s | 3.54 s |
| 10 | 4.27 s | 6.90 s |
| 20 | 8.28 s | 13.19 s |

All 108 intents were correct, but the single Catalan source phrase repeatedly had 50% word error rate (English/Spanish: 0%). This is not a general language accuracy estimate. At 20 turns, ASR queue p95 was 5.09 s and model total p95 was 7.60 s; TTS had no measured queue. These are baseline measurements, not results for the new backend.

The next run (`benchmark-1789818581312.json`, llama.cpp b10964, four slots, Whisper small) completed all 108 jobs with correct intents and language detection:

| Simultaneous synthetic turns | First chunk p50 | First chunk p95 |
| --- | --- | --- |
| 1 | 0.98 s | 0.99 s |
| 5 | 2.82 s | 3.43 s |
| 10 | 4.62 s | 5.95 s |
| 20 | 7.96 s | 11.25 s |

At 20 turns, p95 improved about 15%, but median latency improved only about 4%; the 5/10-turn medians worsened. ASR queue p95 reached 6.14 s, model total p95 was 4.99 s, and TTS again had no measured queue. This is still a slow synchronized burst. The Catalan source phrase retained 50% WER: both automatic detection and an explicit `ca` hint produced `Volia saber a quina hora obra l'Atlíntica als dilluns.` for `Voldria saber a quina hora obre la clínica els dilluns.` The language was correctly identified as Catalan; the synthetic TTS/telephone/ASR chain remains the quality issue. No human recordings were evaluated.

The turbo comparison (`benchmark-1789819202722.json`, same llama settings) improved WER on the repeated Catalan phrase to 20%, but still substituted `l'Atlíntica` for `la clínica`. English/Spanish stayed at 0%; all 108 intents were correct. First-chunk p50/p95 were 1.66/1.66 s at one turn, 5.90/6.89 s at five, 10.11/11.69 s at ten, and 17.79/23.32 s at twenty. ASR queue p95 reached 18.89 s at twenty turns. The benchmark has a longer timeout than platform ASR's 12-second operation budget, so its all-completed result does not mean calls would meet that deadline. Keep `small` as the default for now. These repeated synthetic phrases cannot establish general language accuracy or separate synthesis pronunciation from recognition errors.

An opt-in optimization, `LOCAL_ASR_DECODER=segment`, uses MLX Whisper's segment decoder to share encoded audio between language detection and transcription. In the pinned MLX implementation, the existing full-transcription path invokes the encoder separately for language detection and transcription. Segment mode detects language per utterance, uses text-only decoding (no timestamps), retains the no-speech gate, and falls back to full transcription for recordings longer than 30 seconds, low-confidence/repetitive output or possible token exhaustion. It stores no cross-call transcription context. Reports label actual `segment`, `transcribe` or `transcribe_fallback` use. This changes decoding behavior, so accuracy must be checked together with latency; defaults remain unchanged.

The segment run (`benchmark-1789819486185.json`, small, four LLM slots) used segment decoding for all 108 jobs with no fallback or execution failures; all intents and detected languages were correct. Compared with small/transcribe:

| Simultaneous synthetic turns | First chunk p50: transcribe → segment | First chunk p95: transcribe → segment |
| --- | --- | --- |
| 1 | 0.98 → 0.91 s | 0.99 → 0.92 s |
| 5 | 2.82 → 2.50 s | 3.43 → 3.15 s |
| 10 | 4.62 → 4.18 s | 5.95 → 5.40 s |
| 20 | 7.96 → 6.86 s | 11.25 → 10.24 s |

At twenty turns, ASR worker median fell from 339 to 236 ms and ASR queue p95 from 6.14 to 4.30 s. Model queue p95 rose to 4.23 s as recognition supplied turns faster; total model p95 was 5.86 s. TTS queue p95 stayed at zero. Catalan WER on the repeated phrase improved from 50% to 40%, while English/Spanish remained exact. This improved the measured latency, but does not settle Catalan accuracy or validate twenty live calls. Keep segment opt-in until broader utterances are checked.

The eight-slot run (`benchmark-1789819610709.json`, small/segment) regressed at every tested concurrency. At ten turns p50/p95 rose from 4.18/5.40 s to 5.16/6.11 s; at twenty, from 6.86/10.24 s to 9.20/11.74 s. All 108 intents passed with no decoder fallbacks; the repeated Catalan phrase still scored 40% WER. At twenty turns, median decode time per generated token increased from 56.6 to 117.7 ms with the same median output length (29 tokens). Lower model queueing did not compensate for slower decoding, consistent with resource contention rather than longer responses. That comparison favored four over eight slots.

The two-slot run (`benchmark-1789819783968.json`, small/segment) completed all 108 intents without fallback. At ten turns, p50/p95 were 3.54/5.32 s versus four slots' 4.18/5.40 s. At twenty they were 6.34/10.32 s versus 6.86/10.24 s. Median latency improved while the twenty-turn tail was effectively unchanged. Catalan WER changed to 60%, despite unchanged ASR configuration. Earlier runs generated fresh Piper audio each time and did not save audio hashes, so their recognition differences cannot be attributed to slot counts, and their latency comparisons are provisional. These are also repeated measurements of only three phrases, not a broad quality evaluation.

The controlled pair (`benchmark-1789820021198.json`, two slots; `benchmark-1789820084857.json`, four slots) shares input hash `8e1ae762c85da8154b339e503b74b52a7ad0e35c4dc1f06da267ef285ea6eb79`:

| Simultaneous synthetic turns | Two slots p50 / p95 | Four slots p50 / p95 |
| --- | --- | --- |
| 1 | 0.89 / 0.92 s | 0.92 / 1.32 s |
| 5 | 2.18 / 2.83 s | 2.49 / 3.17 s |
| 10 | 3.45 / 5.25 s | 4.18 / 5.38 s |
| 20 | 6.12 / 10.22 s | 6.83 / 10.24 s |

Both completed all 108 intents and detected languages correctly, with identical recognized text, no decoder fallback and no execution failures. The Catalan fixture scored 60% WER in both. Two slots are the preferred measured candidate because of lower median latency without a material tail penalty. This is one sequential pair, not a guarantee of optimal settings or twenty-call readiness. The twenty-turn tail remains about ten seconds. Keep segment decoding opt-in until broader speech, real receptionist tools and consent flows are exercised. No production defaults or private `.env` were changed. Listening without Catalan proficiency did not establish whether the fixture pronunciation was correct. The next quality check uses human recordings with reference transcripts; decoded synthetic inspection copies remain at `.workbench/benchmark-input-{en,es,ca}.wav`.

Reproduce the paired comparison with identical cached inputs when needed (there is no need to repeat it unchanged now). This starts the two stacks sequentially and stops if a run fails:

```sh
for benchmark_slots in 2 4; do
  LLM_PROVIDER=local LOCAL_LLM_BACKEND=llama LOCAL_LLM_PARALLEL="$benchmark_slots" LOCAL_ASR_MODEL=small LOCAL_ASR_DECODER=segment bun run benchmark || break
done
```

To deliberately test new synthesized recordings later, first archive `.workbench/benchmark-inputs-v1.json` under another name; the next run creates a new set and different input hashes. Only the public synthetic phrases are saved there, never caller audio. Do not mix results with different hashes as a controlled ASR comparison.

Qwen remains 4B Q4_K_M, but its GGUF conversion and server both differ from the original Ollama baseline, so that earlier comparison cannot isolate a server-only speedup. Retain each report and change one variable at a time.

`bun run benchmark --help` is finite and starts nothing. Offline verification uses `bun run check`; native codec tests use the already-installed `.workbench/voice/venv/bin/python -m unittest discover -s tests -p '*_test.py'` with synthetic model stubs, not real models/devices.

## Human-recorded recognition check

The synthetic Catalan fixture alone cannot establish whether Piper pronunciation or Whisper recognition caused the errors. `benchmark:asr` compares Whisper small and large-v3-turbo with both `transcribe` and `segment`, using the same human recordings in each profile. It runs 240 serial recognition operations: 30 clips × two audio formats × four profiles. No reference text or language hint is sent to recognition.

The prepared corpus contains ten distinct test sentences each for English (`en_us`), Spanish (`es_419`, Latin America) and Catalan (`ca_es`) from [Google FLEURS](https://huggingface.co/datasets/google/fleurs), revision `70bb2e84b976b7e960aa89f1c648e09c59f894dd`, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Selection takes the first ten distinct sentence IDs per language in archive order with duration 1–20 seconds, before any recognition results are available. Source transcripts are unchanged. Audio is converted to mono 16 kHz PCM16 and separately resampled to 8 kHz mu-law for the telephone comparison. The manifest retains source filenames and hashes; the runner verifies the prepared WAV and telephone audio hashes before starting.

To reproduce the corpus using the already-installed private Python environment, run `.workbench/voice/venv/bin/python scripts/prepare-human-speech.py`. This only downloads and converts recordings; it loads no models. Existing `.workbench/human-speech/manifest.json` is reused. Archive that directory before deliberately regenerating it.

Stop other voice stacks, then run the recognition check yourself:

```sh
bun run benchmark:asr
```

This command starts only recognition workers, one profile at a time, and stops them afterwards. With the default `ASR_PROVIDER=local`, it skips Qwen, Piper, VAD and external inference providers, regardless of `LLM_PROVIDER`. Hosted recognition mode is documented below. First use may install dependencies/download the selected Whisper assets. `bun run benchmark:asr --help` starts nothing. Production settings and `.env` are unchanged.

The report at `.workbench/recognition-*.json` includes references, recognized text, detected language, decoder used, per-sample errors, input hashes and isolated worker timing. Corpus word error rate sums edit errors across reference words; failed operations count as empty transcripts. This small read-speech sample helps separate recognition from synthesis and codec effects. It does not validate clinic vocabulary, conversational speech, Spanish regional coverage, noisy calls or 10–20-call capacity.

The first human-speech run (`recognition-1789820989969.json`, input hash `929bdf5511b439a51a00a4663ec4be72eb616cfdfb46b5e5d747195bd7925638`) exposed a preprocessing bug: six English recordings had RMS 0.00048–0.00119, below the worker's fixed 0.002 cutoff. All four profiles returned empty text and `unknown` in 1–2 ms for those recordings in both channels, without invoking Whisper (48 requests). The reported English WER of about 63–65% includes these dropped inputs, and its median timing is not representative of decoding. Do not use it to rank the English models.

Spanish and Catalan telephone results from that run were:

| Profile | Spanish WER | Catalan WER | Spanish median worker time | Catalan median worker time |
| --- | ---: | ---: | ---: | ---: |
| small / transcribe | 6.7% | 46.0% | 252 ms | 260 ms |
| small / segment | 6.3% | 45.2% | 169 ms | 185 ms |
| turbo / transcribe | 2.4% | 6.6% | 821 ms | 846 ms |
| turbo / segment | 2.4% | 7.0% | 449 ms | 459 ms |

Small detected Catalan correctly on only 5/10 telephone recordings; turbo detected 10/10. Transcript inspection shows small frequently rendering Catalan as Spanish. Some turbo word errors reflect spelling and number formatting (`trenta per cent` versus `30%`), so literal WER is not a semantic error rate. That run identified turbo/segment as the next quality/latency candidate, pending the corrected English evaluation below and a separate concurrent full-stack benchmark. Its isolated serial timing does not establish 10–20-call capacity.

The worker now retains quiet audio for either decoder and skips only input shorter than 100 ms or exact digital silence; Whisper's no-speech handling remains active. Reports expose input RMS, skip reasons, empty-transcript counts and `decoded_worker_ms` excluding bypassed requests, while `worker_ms` continues to include all completed requests. The corrected run below reuses the same cached recordings to measure the correction. Offline regression tests cover quiet clean/telephone input reaching both decoder paths, silence handling and skip-aware reporting; they do not prove live recognition accuracy. Production model defaults and private `.env` remain unchanged.

The corrected run (`recognition-1789821271493.json`) has the same input hash as the first run. All 240 operations decoded nonempty text, with no errors, skips or segment fallbacks. All six previously discarded English clips reached recognition in both audio formats and all four profiles. Spanish/Catalan recognized text was unchanged. Both turbo profiles detected all 60 clip/channel languages correctly; small still misidentified 4/10 clean and 5/10 telephone Catalan clips as Spanish.

| Profile | Telephone EN / ES / CA WER | Telephone EN / ES / CA median ASR time |
| --- | --- | --- |
| small / transcribe | 8.0% / 6.7% / 46.0% | 221 / 256 / 259 ms |
| small / segment | 8.0% / 6.3% / 45.2% | 140 / 170 / 185 ms |
| turbo / transcribe | 4.7% / 2.4% / 6.6% | 791 / 817 / 826 ms |
| turbo / segment | 4.2% / 2.4% / 7.0% | 419 / 436 / 446 ms |

Turbo/segment is the preferred measured multilingual ASR candidate: both turbo decoders made 33 total telephone word errors across 692 reference words, while segment roughly halved median worker time. The per-language mix differs slightly; this is a small fixed sample, not statistical equivalence or clinical validation. Turbo/segment's clean-audio WER was 3.8% / 2.4% / 7.4%, and its telephone p95 was 449 / 468 / 517 ms. Remaining errors include actual substitutions as well as spelling/number formatting differences.

The combined capacity run uses turbo/segment with the previously favored two Qwen slots and two Piper workers. Stop other voice stacks and run this yourself; it starts the local inference stack and reuses the fixed synthetic capacity inputs:

```sh
LLM_PROVIDER=local LOCAL_LLM_BACKEND=llama LOCAL_LLM_PARALLEL=2 LOCAL_ASR_MODEL=large-v3-turbo LOCAL_ASR_DECODER=segment LOCAL_TTS_WORKERS=2 LOCAL_TTS_THREADS=2 bun run benchmark
```

This tests synchronized 1/5/10/20-turn bursts with three rounds each. Compare queueing and first-chunk latency with the two-slot small/segment baseline (`benchmark-1789820021198.json`) only after checking its input hash. Recognition-only timings cannot predict combined GPU contention or certify twenty live calls. The measured result follows; defaults remain unchanged.

The combined turbo/segment run (`benchmark-1789821540417.json`) matches the two-slot small/segment baseline's input hash, Qwen model hash, llama build, context and worker counts. All 108 intents and language detections passed without execution failures or decoder fallbacks; only 72 transcripts were exact. English/Spanish remained exact. The repeated Catalan phrase improved from 60% to 20% WER but still substituted `l'Atlíntica` for `la clínica`, both with automatic detection and an explicit Catalan hint. This synthetic result does not overturn the broader human-speech quality results above.

| Concurrent turns | Small/segment first chunk p50 / p95 | Turbo/segment first chunk p50 / p95 |
| ---: | ---: | ---: |
| 1 | 0.89 / 0.92 s | 1.21 / 1.59 s |
| 5 | 2.18 / 2.83 s | 3.64 / 4.28 s |
| 10 | 3.45 / 5.25 s | 6.30 / 8.17 s |
| 20 | 6.12 / 10.22 s | 11.77 / 15.87 s |

At twenty turns, turbo ASR took 490 ms median per input, versus 196 ms for small. The single recognition lane's queue p95 reached 8.84 s; per-request queue plus recognition p95 was 9.32 s (maximum 9.80 s). No sample exceeded the production ASR operation's 12-second budget, but that alone is not an acceptable conversational-latency result. Qwen queue p95 reached 6.27 s; native model time excluding queue had p95 3.27 s versus 1.45 s for small, with similar output lengths (median 29 tokens). This is consistent with contention while ASR and Qwen share the GPU, not proof of a specific GPU scheduling cause. These stage percentiles are not additive. Piper remained at 91 ms median with zero measured queueing. The one-turn p95 also includes a 490 ms TTS outlier.

Turbo/segment remains the stronger multilingual recognition candidate, but the current stack has not met the low-latency 10–20-call objective. Further throughput work should address recognition serialization and shared model contention; these measurements do not justify increasing Piper workers. Twenty ongoing conversations may have staggered utterances, so this synchronized burst test neither certifies nor rules out that workload. Actual endpointing, paced calls and receptionist tool flows still need validation. No production defaults were promoted and no extra model processes were started during report analysis.

## Hosted transcription with local Qwen and Piper

Set these in your private `.env` and uncomment your existing `OPENROUTER_API_KEY`:

```dotenv
LLM_PROVIDER=local
ASR_PROVIDER=openrouter
LOCAL_LLM_BACKEND=llama
LOCAL_LLM_PARALLEL=2
OPENROUTER_ASR_CONCURRENCY=20
OPENROUTER_ASR_TIMEOUT_MS=12000
```

`ASR_PROVIDER` defaults to `local`; merely configuring an API key does not transmit audio. `openrouter` selects `openai/whisper-large-v3-turbo` through [OpenRouter's transcription endpoint](https://openrouter.ai/docs/guides/overview/multimodal/stt). It uses the same `.env`/Keychain credential as OpenRouter chat, independently of `LLM_PROVIDER`. **OpenRouter manages the upstream provider:** its transcription endpoint does not apply provider-pinning controls, so Groq is not guaranteed and requests may use another provider such as DeepInfra. No Groq-specific routing claim is made in reports.

In hosted mode, microphone captures and completed telephone utterances are sent as WAV to OpenRouter and its selected provider. Qwen chat/action processing and Piper synthesis stay local when `LLM_PROVIDER=local`. Startup skips downloading, importing and warming local Whisper. A model-free capture worker retains microphone controls; Piper and Silero remain local. Native child processes never receive the OpenRouter key. The selected ASR provider/model/routing and available request IDs, usage and provider metadata are recorded in benchmark reports without credentials or raw response bodies.

Up to 20 recognition requests can overlap (configurable from 1–20), with bounded admission and independent caller cancellation. HTTP failure, rate limiting, malformed responses and timeout surface as errors; there is no automatic retry or local/provider fallback in the app. The 12-second default ASR timeout includes adapter admission, upload and response reading; the existing platform operation timeout also covers shared queueing. The provider may still bill a request cancelled after submission. `verbose_json` requests language metadata, normalizing English/Spanish/Catalan names to `en`/`es`/`ca`; absent metadata remains `unknown`, never inferred from a scoring reference. Normal conversation language handling retains its existing text fallback.

Stop other voice stacks and run the human-recorded quality check yourself:

```sh
ASR_PROVIDER=openrouter bun run benchmark:asr
```

This runs **60 billable transcription requests** (30 fixed human clips × two audio formats), using the same references and input hash as the local comparison. It starts no local models and makes no warmup transcription request. The remote `elapsed_ms`/legacy `worker_ms` fields include network and provider time; they are not native compute measurements. The report preserves hosted ASR identity/usage for each sample. Local mode still runs the four local profiles.

To measure the combined stack, run:

```sh
ASR_PROVIDER=openrouter LLM_PROVIDER=local LOCAL_LLM_BACKEND=llama LOCAL_LLM_PARALLEL=2 LOCAL_TTS_WORKERS=2 LOCAL_TTS_THREADS=2 bun run benchmark
```

That benchmark makes **114 billable transcription requests** (six diagnostics plus 108 measured jobs), starts local Qwen/Piper, and reuses the synthetic audio cache. It tests 1/5/10/20 synchronized turns, with no clinic API calls. These commands are user-run; implementation validation uses mocked HTTP and finite offline tests, not live provider accuracy or latency proof. Restart `bun start` or `bun run serve` after changing `.env` to use the same hosted recognition path during real conversations.

The first hosted quality run (`recognition-1789822928401.json`) reused the human corpus input hash `929bdf5511b439a51a00a4663ec4be72eb616cfdfb46b5e5d747195bd7925638`. All 60 HTTP operations completed, but there was one empty English clean transcript and six Spanish language-detection failures across clean/telephone audio. One clean Spanish clip returned Korean text, and another was largely rendered in English. This route is not validated for clinic use.

| Language | Local turbo/segment telephone WER | Hosted telephone WER | Local / hosted median ASR time |
| --- | ---: | ---: | ---: |
| English | 4.2% | 35.8% | 419 / 1118 ms |
| Spanish | 2.4% | 17.8% | 436 / 860 ms |
| Catalan | 7.0% | 8.8% | 446 / 1683 ms |

The response bodies omitted upstream provider identity. Read-only [generation metadata lookups](https://openrouter.ai/docs/api/api-reference/generations/get-generation) for the saved request IDs identified **55 DeepInfra requests and five Groq requests**; the allowlisted lookup results are saved in `.workbench/recognition-1789822928401-providers.json` without changing the original report. All telephone requests, all language-detection failures and the empty English response were served by DeepInfra. The five Groq requests covered only clean audio (one English, two Spanish, two Catalan) and took 471–650 ms. That unequal subset cannot establish a provider accuracy or latency comparison on matched telephone inputs.

Offline checking confirmed every mu-law byte decodes to exactly the same PCM16 value as Python `audioop`; clean WAV inputs bypass this conversion and also regressed. Quiet English clips suffered especially large omissions, but provider preprocessing/decoding is not observable here, so its precise cause remains unconfirmed. The reported usage costs sum to about $0.00267 for 60 requests. This serial quality run cannot establish concurrent throughput; nonetheless, the quality regression must be resolved before treating hosted throughput as a usable improvement. A direct Groq comparison on the same recordings would isolate that provider, but requires a separate Groq credential and implementation choice; no provider switch, local fallback or production configuration change was made during this analysis. No new transcription requests were sent.

## Use an OpenRouter model

Local Qwen remains the default. To replace it for both the receptionist and automated rehearsal caller, put these settings in your git-ignored `.env`:

```dotenv
LLM_PROVIDER=openrouter
OPENROUTER_MODEL=provider/model-id
OPENROUTER_MAX_TOKENS=4096
OPENROUTER_API_KEY=your-openrouter-api-key
```

Replace `provider/model-id` with the exact ID of your chosen [OpenRouter model](https://openrouter.ai/models) supporting tools and structured outputs. There is no automatic model substitution or fallback to Qwen. The same settings apply to `bun start` and `bun run serve`.

Set `OPENROUTER_API_KEY` to your key; never commit your real `.env`. A nonblank environment key takes precedence over Keychain. Alternatively, store the key using `bun start --offline` → **Setup → OpenRouter API key · .env or Keychain**. Input is masked and stored in macOS Keychain under service `el-turno-openrouter`, account `https://openrouter.ai`. Restart after changing the model or key. Set `LLM_PROVIDER=local` to return to Qwen.

In OpenRouter mode, setup **does not install, download or start llama.cpp/Ollama/Qwen**. Piper synthesis remains local. Recognition follows the independent `ASR_PROVIDER` setting (local Whisper by default); the local voice stack still requires Apple Silicon and the audio dependencies. Conversation text and retrieved clinic context are sent to OpenRouter and its selected model provider; audio recordings are sent separately only when `ASR_PROVIDER=openrouter`. Setup makes one model warm-up request, and rehearsals use your OpenRouter credits for both agent and simulated caller. Provider failures are reported without silently retrying billable requests.

The adapter implements OpenRouter's [tool-calling protocol](https://openrouter.ai/docs/guides/features/tool-calling) and [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), including tool-call IDs and preserved reasoning metadata. `OPENROUTER_MAX_TOKENS` accepts 256–32768; increase it if the provider reports truncated output. Requests prefer providers by latency (`OPENROUTER_PROVIDER_SORT=latency`, also accepts `price` or `throughput`), which can select a more expensive provider. `OPENROUTER_TIMEOUT_MS` defaults to 20000. `OPENROUTER_REASONING_EFFORT=auto` requests low effort for Gemini 3 and leaves other models unchanged; use `default` to omit reasoning configuration, or a supported `none`, `minimal`, `low`, `medium`, or `high` value. These follow OpenRouter's [reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) and [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection). Reports include available provider/model IDs and token counts, never reasoning text. No live OpenRouter or speech benchmark is implied by the offline tests.

Platform calls use a fixed greeting in `VOICE_LANGUAGE`, then follow the caller's detected/requested language. Fixed greetings and service notices share synthesized audio across simultaneous calls; patient-specific speech is not cached. After four seconds of model/tool work, callers hear one short wait notice. `VOICE_TURN_TIMEOUT_MS=25000` bounds the entire model/tool turn; `VOICE_WAIT_NOTICE_MS=4000` adjusts the notice delay. Audio queue plus synthesis/transcription waits are limited to 12 seconds per operation. New caller speech cancels stale model work and discards its unsubmitted result. `VOICE_CALL_TIMEOUT_MS=180000` sets the overall call limit; final caller audio may still drain within the submission window.

An empty transcription prompts repetition. A call with no recognized reply receives one reminder after 12 seconds of idle time. These reminders do not confirm an appointment.

Action selection and confirmation meaning are evaluated by `typesafe/jev-1.13` through OpenRouter's [Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request), independently of `LLM_PROVIDER` and `OPENROUTER_MODEL`. Your existing OpenRouter key is sufficient; optional `CONSENT_MODEL` and `CONSENT_TIMEOUT_MS=5000` override the decision model and deadline. This applies even when conversation and transcription use local models. The request includes the latest reply, the exact pending/accepted actions, spoken offer labels and up to six recent transcript turns; it incurs OpenRouter usage. No phrase-matching fallback remains.

Jev distinguishes acceptance, refusal, changed details, clarification and unrelated replies. A selected-choice probability below 0.85 requires clarification. Code still requires a fully delivered offer and binds acceptance to its exact action fields; a model answer cannot authorize an interrupted, unheard or changed offer. Corrections revoke old permission, accepted intents survive unrelated questions, and provider failures cannot authorize completion. Decision timing, model, choice and confidence appear in report `consent` events; failures appear as `consent_error`.

Jev authorizes every candidate clinic read, BOOK/CANCEL/RESCHEDULE/REGISTER offer, NO_ACTION/ESCALATE outcome, and final spoken reply. The conversational model drafts arguments and wording; rejected candidates are never executed or spoken. Tool contracts and recent tool results provide context for catalogue lookups and action checks. At most two rejected candidate repairs are allowed per caller turn. A missing or failed action decision does not fall back to executing the chat model's proposal.

After acceptance, a separate Jev decision checks whether other caller requests remain. If none remain, code validates and records the exact accepted payload and delivers the closing statement directly, with **no further chat-model call**. Multi-intent calls continue only their unresolved requests. Code retains the exact identity, grounding, delivery and consent guards. Explicit acceptance followed by a status check such as “¿queda reservada?” does not require another yes. Reports expose `action_decision` (including raw choice, effective selected action, probability and timing) and direct `resolution` events.

Decision thresholds distinguish intermediate reads/questions/offers (0.60), proposed final outcomes (0.80), and direct completion of accepted actions (0.85). Consent itself still requires 0.85; no action threshold bypasses it. An uncertain decision asks for clarification; rejection never authorizes a candidate. These are application thresholds, not guarantees of model accuracy.

Finite, billable model checks, all without starting servers or submitting clinic writes:

- `bun run test:consent:live`: EN/ES/CA acceptance, corrections, conditions and status questions.
- `bun run test:actions:live`: all six outcome categories, necessary reads, rejected speech, emergency priority and multiple intents.
- `bun run test:actions:flow`: the configured OpenRouter conversation model plus live Jev, with a synthetic clinic. Checks one acceptance completes a booking with zero additional chat calls. Requires `LLM_PROVIDER=openrouter`; never starts local models.

These save `.workbench/consent-evaluation-*.json`, `action-evaluation-*.json` and `action-flow-*.json`. Offline `bun run check` mocks model decisions and verifies transport, exact payloads, interrupted audio, cancellation and state transitions. Text-only live checks do not establish audio-call quality or 10–20-call throughput.

Platform reports distinguish response generation from audio delivery: `at_ms` timestamps each event relative to connection, while `elapsed_ms` measures the individual operation. `tts`/`asr` events separate worker time from `queue_ms`; cached/shared speech has `cache_hit=1` and its shared wait appears in `queue_ms`. `audio_stats` counts incoming frames, frames above the configured speech threshold, detected utterances, empty transcriptions, outgoing frames, and playback acknowledgements. `agent`/`RECEPTIONIST` is emitted only when the first audio frame is sent. `output_sent` means all frames were sent; only `playback_ack` means the peer echoed their mark, and neither proves human comprehension. `end_reason` distinguishes peer stop, socket closure, call timeout, completion, error, and shutdown; a WebSocket close code is included when available. Reports retain no raw audio or model reasoning text. Recognition and synthesis use independent bounded queues; these offline checks do not prove live throughput or diagnose earlier calls retroactively.

## The workbench

| Section | What you can do |
| --- | --- |
| **Cases** | Search 73 public cases across all 18 problems; read objectives, demographics, language/noise conditions and requirements; reveal acceptable answers; compose all six action types, including multiple intents. |
| **API** | Fill schema-derived forms for all 17 documented routes: health, clinic/catalogues, directory, availability, appointments, submissions and six submit routes. Preview requests and inspect response status, latency and body. |
| **Labs** | Exercise submission deadlines/duplicates, inspect interleaved Twilio traces, probe an existing endpoint with 1/5/10/20 sockets, resolve relative dates, validate DNI/NIE, and rank eligible sites by distance. |
| **Results** | Import an evaluation run; compare every field against all acceptable outcomes; inspect privacy signals; export a diagnostic report. Unattempted cases earn zero. |
| **Docs** | Read every archived Markdown document, including the complete API reference, raw schema and public cases. |
| **Setup** | Configure the API origin, optionally store a key in macOS Keychain instead of `.env`, and set an external endpoint. |
| **Voice** | Start a free conversation, inspect/retry setup, run multilingual speech/model smoke tests, or rehearse all 73 public cases sequentially. |

Use `1`–`7`, `Tab`, or `Shift-Tab` to change sections; each section remembers its selection, search, and scroll. `←`/`→` focus the list or details; arrows or `j`/`k` move in that pane. `PgUp`/`PgDn` scroll details even during voice runs, and `Home`/`End` jump to the beginning/end. `/` searches; `Esc` closes details before clearing the filter. `?` shows all shortcuts. In Cases, `Enter` reads the case, `v` runs a voice rehearsal, `m` opens microphone mode, `e` enters an outcome and `a` reveals answers. `i` imports results; `x` exports a report. `c` cancels a running voice test; `q` or `Ctrl-C` quits. Forms support cursor editing, `Enter` to accept, `Esc` to cancel, and `Ctrl-U` to clear. Set `NO_COLOR=1` for plain rendering. Minimum terminal size is 40×12; at 90 columns the list and details appear side by side, and smaller terminals show the focused pane.

## First rehearsal

**To try it without a script:** press `f` from any section, or open **Voice → Free conversation**. Choose `en`, `es` or `ca`, then talk to the receptionist about whatever you want to test. Press **Space** to start recording and **Space** again to send your reply. Press `t` to type, or Esc to end the call. While recording, Esc discards the take and returns to the caller controls. The recording timer stops automatically at 30 seconds; silence lets you try again. The agent can also finish after you confirm your final intents; press `f` to start another conversation.

Free conversations use the current connection time and real Prosper clinic data, with no case selection, persona, answer key, score, scripted turn cap or three-minute deadline. Individual operations still have their usual timeouts. Transcripts, timings and any proposed actions are saved separately to `.workbench/free-*.json`; case results stay unchanged. Speech remains turn-based and actions remain local. The transcript follows new turns automatically; PgUp pauses following and End resumes it. Microphone controls appear after the receptionist finishes speaking. Availability is limited to the clinic API's published calendar (7 September–16 October 2026).

1. Run `bun start` and wait for local setup to finish. In **Voice**, run **Speech + model smoke tests** to measure English, Spanish and Catalan TTS → 8 kHz mu-law → ASR word error rates and timings.
2. Open **Cases**, select a case and press `v`. A separate local model plays the caller from their public persona/objectives. The receptionist receives the simulated connection time and real clinic tools; neither model receives the expected-answer oracle.
3. Watch the transcript and stage timings. Proposed actions are validated against retrieved patient/slot/appointment IDs and saved locally. The agent has no platform submission tools. `c` cancels; if cancellation interrupts native audio, retry setup before the next call.
4. Press `m` instead to play the caller yourself. Read the objectives, listen to the receptionist, then press Space to start your reply and Space again to send it (up to 30 seconds). macOS may request microphone permission. Press `t` to type instead, Esc while recording to discard, or Esc at the caller controls to end the call. Use headphones to avoid speaker feedback.
5. Inspect **Results** and `.workbench/voice-*-<case-index>.json` for transcripts, stage timings, actions and differences. **Voice → Rehearse all 73 public cases** runs sequentially, checkpointing after each case. Each call has a three-minute budget; a complete run can take hours.

This is a turn-based local rehearsal. It does **not** reproduce the organiser's caller model, published background-noise beds, streaming/barge-in, concurrent-call performance or official scoring. Noise cases currently use clean audio. Clinic reads use the live API while the simulated date uses the archived case timestamp; inspect mismatches if the live world changes. Proposed bookings/cancellations are never written by the voice runner. Use dashboard practice for official evidence.

Local completion is a mock of the track's resolution, not an appointment write. The receptionist first calls `offer_actions` with one grounded write action. The application reads its public doctor/site names and computed Madrid date and time, then waits for clear acceptance. Only fully delivered offers can authorize `complete_call` with `{ "actions": [...] }`; questions, interrupted speech and changed action fields cannot authorize a write. Accepted intents are retained while the remaining requests are resolved. The workbench validates the fields and retrieved patient/slot/appointment data, saves the resolution, plays a closing message with the accepted action details, and ends the chat without another model turn or confirmation. Three rejected completion attempts end the run with a visible error instead of an endless loop.

The finished screen and saved free/case reports contain the exact `record: { "actions": [...] }` shape used by the track, plus `platform_submission: false` and a `submission_preview` with one `POST /api/v1/submit/<action>` payload per action. These requests are **never sent**. Their `<start.callSid>` value is an explicit placeholder; only an official test's incoming call ID can replace it, never the local conversation UUID. `REGISTER` retains `new_patient` in the record and flattens its demographics in the submission preview. See [the track contract](task/contract.md#3-post-apiv1submitaction).

For manual evaluation:

1. Start with `bun start --offline`, select a case, and read the caller's objectives. Keep answers hidden while solving it.
2. Press `e`, choose an action, and enter observed values. Add each additional intent separately. `REGISTER` demographics are nested in a result record, but flattened automatically in the corresponding API form.
3. Supply a transcript JSON file if available. Protected-data cases without agent transcript evidence remain **needs_review**.
4. Supply the actual connection timestamp for live results. Blank means you are rehearsing the archived fixture at its saved anchor.
5. Review the differences, or import a whole batch using `i`. Export with `x` before replacing a run to retain results from repeated rehearsals.

For a noninteractive evaluation:

```sh
bun src/cli.ts cases
bun src/cli.ts template > /tmp/turno-results.json
# Fill in the actual records in /tmp/turno-results.json, then:
bun run evaluate /tmp/turno-results.json
```

Results have this format. The record below is only a demonstration, not an agent result:

```json
[
  {
    "case_id": "doctor_and_site-570e40a3f718",
    "reference_time": "2026-09-18T09:00:00+02:00",
    "record": {
      "actions": [{ "action": "NO_ACTION", "reason": "provider_not_found" }]
    },
    "transcript": [
      { "role": "caller", "text": "I only want Dr. Fuentes." },
      { "role": "agent", "text": "That doctor is not in the clinic directory." }
    ]
  }
]
```

The CLI prints JSON and does not save input. Exit code `0` means all supplied results passed the **local** comparison, `1` means a failed/unverified/empty evaluation, and `2` means invalid input. A partial batch can exit `0`; the report always shows attempted coverage against all 73 cases. Use the full template when testing complete coverage. Duplicate case IDs in one run are rejected.

## Simulate a call without Prosper's call runner

The standalone caller connects to your already-running `/ws` endpoint, speaking and listening over paced 20 ms, 8 kHz mu-law audio. This exercises the server's VAD, ASR, agent tools, TTS and final resolution. It generates a random **BOOK, CANCEL or RESCHEDULE** request in **English, Spanish or Catalan** from current Prosper directory, appointment and eligible-availability reads. The expected action is computed from those live records, separately from the caller LLM; neither the caller nor receptionist gets the expected record.

In terminal 1, stop any live-mode receptionist and start it yourself in dry-run mode:

```sh
bun run serve --dry-run
```

Wait for **Ready**, then in terminal 2, from this same checkout:

```sh
bun run simulate:call
```

Both sides play live through your Mac's selected audio output by default. The monitor plays the actual telephone audio frames as they cross the socket, including the greeting and wait notices, without waiting for transcription or a complete turn. It never opens the microphone. Use the Mac's volume/output controls to adjust listening, or add `--mute` to run silently:

```sh
bun run simulate:call --language es --kind book --seed test-1 --mute
```

Playback uses the existing private Python environment and an output-only sounddevice stream; it loads no extra models. Its short buffers drop stale monitor audio instead of delaying the call. If the output device is unavailable, the script warns and continues with transcripts and recordings; playback warnings are also saved in the report.

The existing `PLATFORM_API_KEY` and `OPENROUTER_API_KEY` are enough. For conversation the caller selects `SIM_CALLER_MODEL`, then your existing `OPENROUTER_MODEL`, then `openai/gpt-4.1-mini` if neither is configured. It inherits the `OPENROUTER_MAX_TOKENS`, timeout, reasoning and provider-sort settings, even when `LLM_PROVIDER=local`. It uses hosted Whisper Turbo to hear the receptionist and its own Piper workers to speak (one for a single call, up to four for a batch). It does not launch another Qwen server or change the receptionist's model/ASR settings. Caller chat and listening incur OpenRouter usage; the normal local runtime may prepare missing Piper dependencies/assets on first use. Override only the caller model with `SIM_CALLER_MODEL` if desired. A 404 reporting no endpoints matching your account data policy means the selected model has no permitted route; choose a model allowed by your account. The simulator never relaxes privacy or parameter requirements or silently switches models after a failure. `VOICE_SERVER_TOKEN` is reused for the local socket handshake.

Choose a language/request or repeat a seeded selection:

```sh
bun run simulate:call --language es --kind book --seed clinic-1
bun run simulate:call --language ca --kind cancel
bun run simulate:call --language en --kind reschedule
```

To inspect a live-data scenario without starting any caller processes or placing a call:

```sh
bun run simulate:call --prepare-only --language es --kind book --seed clinic-1
```

`--endpoint ws://127.0.0.1:7861/ws` selects another local port in this checkout. The default follows `VOICE_PORT`, falling back to 7860. This local mode rejects live-mode servers and non-loopback endpoints. Synthetic call IDs are never sent to Prosper's submission API by the local dry-run receptionist: it only accepts IDs created by its own runner. Reads use the real API; resulting actions remain in the receptionist's dry-run report.

To test another team implementation, use `--ws-url` with any `ws://` or `wss://` endpoint, including a different local implementation:

```sh
bun run simulate:call --ws-url wss://teammate.example/voice --language es --mute
```

The target must speak the same Twilio-compatible audio/mark protocol and be configured for synthetic calls. This mode skips the checkout-specific `/healthz` check and report lookup, so it cannot verify the target's submission mode or grade its actions. It saves transcripts and WAVs and reports `CONNECTED_AND_CLOSED` for a normal socket close, or `FAIL` for transport/caller errors. External reports explicitly mark actions `not_graded` and platform submission as `unknown`; exit code 0 indicates only a clean transport/caller run. `SIM_TARGET_TOKEN`, when set, supplies the external Bearer token; your local `VOICE_SERVER_TOKEN` is never automatically forwarded. `--ws-url` and `--endpoint` are mutually exclusive.

Use `--calls N` (1–50, default 1) to launch N simultaneous calls against either target mode:

```sh
bun run simulate:call --ws-url wss://teammate.example/voice --calls 10 --language es
bun run simulate:call --calls 5 --seed load-test
```

All scenarios are prepared before the sockets open. Each call has an independent ID, scenario, transcript and audio directory; batch seeds derive from `<seed>:1`, `<seed>:2`, etc. Console lines identify their call. Speaker playback is automatically muted for multiple calls. The callers share up to four Piper workers and 20 concurrent ASR requests, so caller-side queues and provider rate limits can affect the load. One call failing does not stop its peers; Ctrl+C stops the batch. In addition to per-call reports, `.workbench/simulation-batch-<id>.json` records counts, elapsed time, individual statuses and report paths. Any failed/unverified call makes the command exit 1. `--prepare-only --calls N` prepares N scenarios without opening sockets or starting caller models.

The script prints the conversation, expected/actual records and **PASS / FAIL / NEEDS_REVIEW**, then saves `.workbench/simulation-<id>.json`. This includes the live scenario snapshot, actual receptionist report, caller speech, what the caller ASR heard, timing data and action differences. `.workbench/simulation-<id>-audio/` contains playable per-turn WAV recordings for both sides (long turns are split at 30 seconds). Compare caller speech with `receptionist.transcript` and listen to those files when recognition is wrong. The artifacts contain clinic-persona data and are private/Git-ignored. Exit code 0 means a completed, matching local result; 1 also covers incomplete/unverified runs and setup failures.

This follows the [published wire contract](task/contract.md) and [action normalization](task/scoring.md), but is **not the official caller or judge**. It samples adult existing-patient identities from the public personas, then refreshes their records live; it cannot enumerate all 2,900 patients through the lookup-only directory. Requests use a specific eligible slot, or a current appointment to cancel/move. There are no noise beds, deliberate interruptions or third-party/privacy scenarios. Playback marks determine caller turn boundaries. Caller LLM/ASR delays contribute to total duration, so this is not a receptionist latency benchmark. Selection is repeatable for the same seed, date and DB state; speech and model outputs are nondeterministic. An expired booking calendar fails visibly instead of inventing availability.

## Run real Prosper platform tests

The separate server mode accepts the track's Twilio Media Streams format at `/ws`, speaks with the existing local models, and submits confirmed resolutions to the six documented test routes using the incoming `start.callSid`. No Twilio account or phone number is needed. The TUI remains local-only.

Quit an existing voice-enabled TUI first to avoid running two copies of the models. With your existing API key configured, start the endpoint yourself:

```sh
bun run serve
```

Wait for `Ready: ws://127.0.0.1:7860/ws`, then start a WebSocket-capable tunnel in another terminal:

```sh
ngrok http 7860
```

In **Prosper → Settings → Integration**, set **Endpoint** to `wss://<your-ngrok-host>/ws`. Use the public host printed by ngrok; include both `wss://` and `/ws`. Keep both terminals running, then use **Call** beside one public case before trying **Run All**. If ngrok is not installed/authenticated, complete its [agent setup](https://ngrok.com/docs/getting-started/) first. This application does not start or configure a tunnel.

For endpoint authentication, set `VOICE_SERVER_TOKEN` to a separate shared secret and restart the server. Configure **Headers** in Prosper as `Authorization: Bearer <that same secret>`. The value is never printed by the server or passed to the local model/audio processes. Without this setting, anyone who knows the public URL can connect. Do not use your Prosper API key as the endpoint token.

```sh
curl http://127.0.0.1:7860/healthz
bun run serve --help
# For transport/audio diagnostics without result POSTs:
bun run serve --dry-run
```

`serve` performs **real test submissions**; `--dry-run` never submits. Synthetic `workbench-…` probe IDs are rejected in live mode. A `200` receipt acknowledges an action, and `409` means it was already received; neither proves a passing score. Failed actions are saved and are not retried automatically. Multi-intent calls submit one request per action. A caller disconnect flushes the last spoken turn and permits bounded completion within the contract's 30-second window; incomplete calls do not invent a fallback resolution.

Every connection gets separate conversation, audio buffers, call/stream IDs, and submission state. Up to 20 calls are admitted by default. Outbound audio is paced in 20 ms, mono, 8 kHz mu-law frames without WAV headers. Caller speech stops further playback locally; the implementation does not rely on the harness honoring `clear`. Audio is transcribed after a detected pause, so this is utterance-based ASR, not streaming recognition. The initial greeting uses `VOICE_LANGUAGE` (Spanish by default), and ASR language detection plus clear caller text switches subsequent turns among English, Spanish, and Catalan. Explicit language requests persist. The active language controls model instructions, offer/closing wording and speech synthesis; bounded retries reject obvious wrong-language drafts.

The models are shared: one recognition worker, two CPU speech workers, and four local model inference slots by default; cancelling one caller does not kill other callers' native jobs. **20 isolated sessions in mocked tests do not establish real-time performance for 10/20 live calls.** Start with one public practice case. Speech detection uses Silero v6.2 on CPU with isolated state per call, 120 ms onset and a 480 ms end pause. Detection and interruption accuracy still need testing against the live noise beds. Set `VOICE_VAD=energy` only for comparison with the previous energy detector; Silero startup failures are reported without silently changing detectors.

| Setting | Default | Purpose |
| --- | --- | --- |
| `VOICE_HOST` / `VOICE_PORT` | `127.0.0.1` / `7860` | Loopback listener for your tunnel; `--port` overrides the port. |
| `VOICE_LANGUAGE` | `es` | Initial greeting: `en`, `es`, or `ca`. |
| `VOICE_MAX_CALLS` | `20` | Concurrent connection limit, 1–20. |
| `VOICE_SERVER_TOKEN` | unset | Optional Bearer authentication on `/ws`. |
| `VOICE_VAD` | `silero` | CPU neural detector; `energy` selects the previous detector explicitly. |
| `VOICE_VAD_PROBABILITY` | `0.5` | Silero speech threshold, 0.1–0.9; exit uses a 0.15 hysteresis margin. |
| `VOICE_VAD_THRESHOLD` | `0.015` | Normalized RMS threshold for `energy` mode only. |
| `VOICE_SILENCE_MS` | `480` | Pause before transcribing a caller turn, 200–3000 ms. |

The `serve` terminal prints live **CALLER** and **RECEPTIONIST** turns, with numbered conversation labels on every line and start/end separators. Each start shows the platform call ID; overlapping calls keep their own label. Caller text appears after transcription, receptionist text before playback, and interruptions are labeled explicitly. Call endings show status, accepted actions, and the saved report path.

Reports are private `.workbench/platform-<session-id>.json` files with the real `call_id`, intended record, per-action receipts, generated transcript, stage/interruption events, and errors. Generated text is not proof that every word was played; interruption events identify superseded answers. Raw incoming audio stays in bounded memory and is not saved. Ctrl-C stops this server's owned processes and saves partial call reports. A failed runtime makes `/healthz` return `503`; restart the server after inspecting its output.

The transport and route shapes follow [the archived track contract](task/contract.md), [Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams/websocket-messages), and [Bun 1.4.2 WebSockets](https://github.com/oven-sh/bun/blob/bun-v1.4.2/docs/runtime/http/websockets.mdx). No listening server, tunnel, or authenticated platform call was started during automated verification.

## Live clinic and action testing

The default API origin is `https://hackspain.getprosperapp.com`. `PLATFORM_API_KEY` in `.env` is sent as `X-Api-Key`. `PLATFORM_API_BASE_URL` can override the origin. Environment credentials stay scoped to that origin and are excluded from local model/audio child processes. `.env` is Git-ignored; do not put its contents into reports or commits.

Alternatively, **Setup** accepts a masked key stored using [Bun's native secrets API](https://bun.sh/docs/runtime/secrets) in macOS Keychain. Keys are scoped to the configured origin; `.env` takes precedence for its own origin. Keychain may ask for OS access when first saving/reading a key. The workbench does not print or save tokens in its configuration or reports.

In **API**, select an endpoint and complete its form. Read-only requests require `y` at the preview; an action POST requires typing `submit`. Forms do not prefill from the answer key. Each submission is one real action for the exact `start.callSid`; use the API again for another intent. No automatic retries are made. `409` means an identical action was already accepted; `410` means the window has closed; `200` acknowledges receipt, not success on a case. Previously accepted actions cannot be undone by sending a corrected one, so submit the caller's final request.

Use directory lookups to identify patients, real availability for eligible slots and `payable_with`, and the upcoming appointments endpoint for cancellation/rescheduling IDs. The API explorer does not prove identity, consent, eligibility, patient history or a final spoken confirmation for you.

**Practice, Run All, integration settings and recordings remain dashboard workflows.** They have no routes in the archived public schema. The workbench does not guess private endpoints. The read-only submissions endpoint returns records; it does not expose per-case verdicts or recordings.

## Wire and concurrency diagnostics

The protocol follows the [track contract](task/contract.md) and [Twilio message shapes](https://www.twilio.com/docs/voice/media-streams/websocket-messages). Import an inbound trace with a connection label for each socket:

```json
[
  {
    "connection": "socket-1",
    "message": { "event": "connected", "protocol": "Call", "version": "1.0.0" }
  }
]
```

This incomplete example intentionally reports missing `start`/`stop`. A full trace includes the actual `start`, `media`, and `stop` events. `sequenceNumber`, `chunk`, and `timestamp` must be strings. `start.callSid` is the submission ID. Each inbound 20 ms mu-law frame has 160 bytes.

```sh
bun src/cli.ts trace /path/to/inbound-trace.json
bun run doctor
```

When **you have started** your agent and tunnel, configure its `ws://` or `wss://` URL in Setup and use **Labs → Probe an existing endpoint**. It opens 1/5/10/20 sockets, sends synthetic call IDs and one second of silence in paced frames, observes output for five seconds, and reports malformed output/cross-stream messages. Configure your agent to treat `workbench-…` IDs as local diagnostics; they are not registered platform calls and cannot be submitted there. The probe currently supports endpoints without custom authentication headers. Connecting can incur charges if your agent starts a provider session.

This is a **transport probe**, not a successful call benchmark. It does not speak, recognize speech, test scheduling, mix the published noise recordings, assess language, or verify barge-in. Non-silence bytes do not prove intelligible audio. The 20-session offline self-check tests the workbench's own simulator only. The TUI rehearsal runner stays separate from `bun run serve`. Use the server mode above and your own tunnel for official calls. The TUI probe cannot supply the optional Bearer header; use it only against a deliberately unauthenticated dry-run endpoint.

## What the local comparator does—and its limits

- Reads original fixtures directly from `task/`; no generated answer catalogue or invented clinic data.
- Compares exact IDs and action multiplicity; normalizes demographic accents, surname order, phone/email/national ID, free-text enums and slot instants to the minute. Rejects invalid national IDs, missing offsets and unknown fields. API forms remain strict.
- Assumes multi-action order does not matter locally; the published contract does not explicitly guarantee that tolerance. Confirm it with organisers. Extra/missing/duplicate actions fail.
- Scans **agent** transcript turns for protected IDs/phones, including literal values and digit-by-digit English/Spanish/Catalan. It is not the organiser's complete speech normalizer. Letter names, number phrases and transcription errors still need audio review. `no_leak_detected` is not a privacy certification.
- Flags different Madrid date anchors as **needs_review** rather than declaring an outdated booking answer correct. Invalid records and detected leaks still fail. No live re-anchoring is attempted: the archive lacks the clinic world/availability generator needed to do that reliably.
- Calculates diagnostic weights over all public cases, including unopened problems; this is **not the official leaderboard** (which uses four private cases per open problem). Switchboard has zero weight. Maximum diagnostic weight is 49.

The archive is anchored to **18 September 2026 at 09:00 Europe/Madrid**. Live public answers change daily; release flags in the docs are a snapshot. The source also disagrees on starter-kit availability and treatment of harness failures. See [task provenance](task/README.md). Do not infer current contest state from these saved documents.

The receptionist is a starting implementation with isolated call state, real clinic tools, slot provenance checks and transcript/timing reports. Identity checks require a caller-supplied name and matching second identifier before exposing the chart; ambiguous spellings or dates require clarification. Consent checks require an exact, delivered offer and a supported clear acceptance. These conservative checks have offline regression coverage; natural speech, accent/noise handling, concurrent inference performance and end-to-end call outcomes still need live validation. The server now implements the Twilio-compatible transport and official resolution submission boundary. **Labs → Track & jury readiness** maps the evidence needed across every problem and the jury criteria.

## Local data and verification

The TUI saves the current run to `.workbench/results.json` and configuration to `.workbench/config.json`. Exports are timestamped `.workbench/report-*.json` files; voice runs also save per-case reports and batch checkpoints. The directory is Git-ignored and uses `0700`, with `0600` reports. Reports can contain patient details and conversation transcripts. Raw clinic responses stay in memory. Audio scratch files are removed after each turn; interrupted processes may leave remnants in `.workbench/voice/audio`. Models, voice cards and the Python environment live under `.workbench/voice`. The task archive remains unchanged.

```sh
bun run check
python3 tests/recording_test.py
```

Checks use finite CLI commands, in-memory protocol sessions, mocked inference and mocked HTTP; no servers are started. They also test the server handlers and overlapping socket state machines in memory without opening a port. They cover every archived acceptable outcome as **validator fixtures**, negative/multi-action outcomes, privacy signals, date boundaries, API encoding/statuses, local file permissions, terminal layout, agent tool restrictions/provenance, caller answer isolation, audio cleanup, cancellation, and persistence of failed voice runs. Passing these tests does not verify native installation/inference speed, microphone quality, Keychain integration, a live terminal session, tunnel, or authenticated organiser endpoint.

When the private Python dependencies are already installed, the finite wire-codec check uses synthetic models and no audio devices:

```sh
.workbench/voice/venv/bin/python -W ignore::DeprecationWarning tests/telephony_worker_test.py
```
