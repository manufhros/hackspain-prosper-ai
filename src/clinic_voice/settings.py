from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    port: int = 7860
    platform_api_base_url: str = "https://hackspain.getprosperapp.com"
    platform_api_key: SecretStr = SecretStr("")
    openai_api_key: SecretStr = SecretStr("")
    openai_base_url: str = "https://api.openai.com/v1"
    llm_model: str = Field(
        "gpt-4.1-mini", validation_alias=AliasChoices("LLM_MODEL", "OPENAI_TEXT_MODEL")
    )
    stt_provider: Literal["openai", "deepgram"] = "openai"
    stt_model: str = ""
    deepgram_api_key: SecretStr = SecretStr("")
    tts_provider: Literal["elevenlabs", "openai", "cartesia"] = "elevenlabs"
    tts_model: str = ""
    elevenlabs_api_key: SecretStr = SecretStr("")
    elevenlabs_voice_id: str = ""
    cartesia_api_key: SecretStr = SecretStr("")
    cartesia_voice_id: str = ""
    openai_voice: str = "coral"
    console_token: SecretStr = SecretStr("")
    transport_token: SecretStr = SecretStr("")
    data_dir: Path = Path("data/voice")
    log_transcripts: bool = True
    max_calls: int = Field(24, ge=1, le=100)
    call_timeout_seconds: int = Field(200, ge=30, le=1800)
    # Compatibility with lucia-work's observed pre-09:00 judge anchor.
    # Set call_date to follow the written call-date contract instead.
    clock_mode: Literal["lucia_9am", "call_date"] = "lucia_9am"
    smart_turn_enabled: bool = True
    geocoder_url: str = "https://photon.komoot.io/api/"

    @model_validator(mode="after")
    def provider_defaults(self):
        if not self.stt_model:
            self.stt_model = {"openai": "gpt-4o-transcribe", "deepgram": "nova-3"}[
                self.stt_provider
            ]
        if not self.tts_model:
            self.tts_model = {
                "elevenlabs": "eleven_flash_v2_5",
                "openai": "gpt-4o-mini-tts",
                "cartesia": "sonic-3",
            }[self.tts_provider]
        return self

    def missing_credentials(self) -> list[str]:
        required = ["platform_api_key", "openai_api_key"]
        if self.stt_provider == "deepgram":
            required.append("deepgram_api_key")
        if self.tts_provider == "elevenlabs":
            required += ["elevenlabs_api_key", "elevenlabs_voice_id"]
        elif self.tts_provider == "cartesia":
            required += ["cartesia_api_key", "cartesia_voice_id"]
        return [name.upper() for name in required if not self.value(name)]

    def value(self, name: str) -> str:
        value = getattr(self, name)
        return value.get_secret_value() if isinstance(value, SecretStr) else str(value)
