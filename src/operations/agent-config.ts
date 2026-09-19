export async function checkAgent() {
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(process.env.ELEVENLABS_AGENT_ID ?? "")}`, {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`No se pudo comprobar el agente ElevenLabs (${response.status}).`);
  const agent = await response.json() as {
    conversation_config?: { agent?: { language?: string; first_message?: string; prompt?: { prompt?: string; tool_ids?: string[] } };
      asr?: { user_input_audio_format?: string }; tts?: { agent_output_audio_format?: string }; conversation?: { client_events?: string[] } };
    platform_settings?: { overrides?: { conversation_config_override?: {
      conversation?: { text_only?: boolean };
      agent?: { first_message?: boolean; language?: boolean; prompt?: { prompt?: boolean } };
      tts?: { voice_id?: boolean };
    } } };
  };
  const config = agent.conversation_config;
  const overrides = agent.platform_settings?.overrides?.conversation_config_override;
  if (!config?.agent?.first_message || (config.agent.prompt?.tool_ids?.length ?? 0) < 9 ||
      config.asr?.user_input_audio_format !== "ulaw_8000" || config.tts?.agent_output_audio_format !== "ulaw_8000" ||
      !["conversation_initiation_metadata", "agent_response", "user_transcript", "client_tool_call", "audio"].every(event => config.conversation?.client_events?.includes(event)) ||
      !overrides?.conversation?.text_only || !overrides.agent?.first_message || !overrides.agent.language ||
      !overrides.agent.prompt?.prompt || !overrides.tts?.voice_id) {
    throw new Error("El agente no tiene la configuración de esta rama. Ejecuta npm run agent:configure con tus credenciales.");
  }
}
