export const MODEL = "qwen3.5:4b";
const whisper = "https://huggingface.co/mlx-community/whisper-small-mlx/resolve/45f3915923c7a79a5a5b5a7d909d39aeb0e5630e";
const piper = "https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117";
export interface Asset { path: string; url: string; size?: number; sha256?: string }
// llama.cpp conversion: four RoPE sections [11, 11, 10, 0]. The Ollama
// conversion uses three and a different tensor layout; never share its cache.
const qwenRevision = "e87f176479d0855a907a41277aca2f8ee7a09523";
export const qwenAsset: Asset = {
  path: `models/unsloth-${qwenRevision}/Qwen3.5-4B-Q4_K_M.gguf`, size: 2740937888,
  sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
  url: `https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/${qwenRevision}/Qwen3.5-4B-Q4_K_M.gguf`,
};
export const assets: Asset[] = [
  { path: "whisper/config.json", url: `${whisper}/config.json`, size: 266 },
  { path: "whisper/weights.npz", url: `${whisper}/weights.npz`, size: 481307592, sha256: "55b6674c9b339702d486e2b1573839a66f8ec8f821ed2886993ef717a86b09f5" },
];
for (const [language, voice, hash] of [
  ["en_US", "lessac", "5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f"],
  ["es_ES", "davefx", "6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917"],
  ["ca_ES", "upc_ona", "fdb652db8c11a4475527346cf3241cb064d1ba393cf370f3f2ec09a872d118fd"],
]) {
  const name = `${language}-${voice}-medium`;
  const directory = `${piper}/${language!.split("_")[0]}/${language}/${voice}/medium`;
  assets.push({ path: `voices/${name}.onnx`, url: `${directory}/${name}.onnx`, size: 63201294, sha256: hash });
  assets.push({ path: `voices/${name}.onnx.json`, url: `${directory}/${name}.onnx.json` });
  assets.push({ path: `voices/${name}.MODEL_CARD`, url: `${directory}/MODEL_CARD` });
}

/** Store variants separately: an A/B switch must never reuse another model's weights. */
export function speechAssets(model: "small" | "large-v3-turbo"): Asset[] {
  if (model === "small") return assets;
  const base = "https://huggingface.co/mlx-community/whisper-large-v3-turbo/resolve/a4aaeec0636e6fef84abdcbe3544cb2bf7e9f6fb";
  return [...assets.filter(asset => !asset.path.startsWith("whisper/")),
    { path: "whisper-large-v3-turbo/config.json", url: `${base}/config.json`, size: 268 },
    { path: "whisper-large-v3-turbo/weights.safetensors", url: `${base}/weights.safetensors`, size: 1613977612,
      sha256: "951ed3fc1203e6a62467abb2144a96ce7eafca8fa77e3704fdb8635ff3e7f8a6" },
  ];
}

export const vadAsset: Asset = {
  path: "silero-v6.2.onnx", size: 2327524,
  url: "https://raw.githubusercontent.com/snakers4/silero-vad/be95df9152c0d7618fa1edfeb296fc3dae32376f/src/silero_vad/data/silero_vad.onnx",
};
