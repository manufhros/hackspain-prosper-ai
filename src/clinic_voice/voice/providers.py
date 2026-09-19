from clinic_voice.settings import Settings


def create_services(settings: Settings):
    from pipecat.services.openai.llm import OpenAILLMService

    llm = OpenAILLMService(
        api_key=settings.value("openai_api_key"),
        base_url=settings.openai_base_url,
        settings=OpenAILLMService.Settings(model=settings.llm_model),
    )
    if settings.stt_provider == "openai":
        from pipecat.services.openai.stt import OpenAIRealtimeSTTService

        stt = OpenAIRealtimeSTTService(
            api_key=settings.value("openai_api_key"),
            turn_detection=False,
            settings=OpenAIRealtimeSTTService.Settings(
                model=settings.stt_model,
                language=None,
                noise_reduction=None,
                prompt="Clínica Arenal. Centro, Norte, Sur. DNI, NIE. Sáez, Sáenz, Iglesias, Iglesia, Requena, Cid.",
            ),
        )
    else:
        from pipecat.services.deepgram.stt import DeepgramSTTService

        stt = DeepgramSTTService(
            api_key=settings.value("deepgram_api_key"),
            settings=DeepgramSTTService.Settings(model=settings.stt_model, language="multi"),
        )
    if settings.tts_provider == "elevenlabs":
        from pipecat.services.elevenlabs.tts import ElevenLabsTTSService

        tts = ElevenLabsTTSService(
            api_key=settings.value("elevenlabs_api_key"),
            sample_rate=24000,
            settings=ElevenLabsTTSService.Settings(
                model=settings.tts_model, voice=settings.elevenlabs_voice_id
            ),
        )
    elif settings.tts_provider == "cartesia":
        from pipecat.services.cartesia.tts import CartesiaTTSService

        tts = CartesiaTTSService(
            api_key=settings.value("cartesia_api_key"),
            sample_rate=24000,
            settings=CartesiaTTSService.Settings(
                model=settings.tts_model, voice=settings.cartesia_voice_id
            ),
        )
    else:
        from pipecat.services.openai.tts import OpenAITTSService

        tts = OpenAITTSService(
            api_key=settings.value("openai_api_key"),
            sample_rate=24000,
            settings=OpenAITTSService.Settings(
                model=settings.tts_model, voice=settings.openai_voice
            ),
        )
    return stt, llm, tts
