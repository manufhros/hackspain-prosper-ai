export function encodeMulaw(samples: Float32Array): Uint8Array {
  return Uint8Array.from(samples, (sample) => {
    let pcm = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
    const sign = pcm < 0 ? 128 : 0;
    pcm = Math.min(Math.abs(pcm), 32635) + 132;
    let exponent = 7;
    for (let mask = 16384; exponent > 0 && !(pcm & mask); mask >>= 1)
      exponent--;
    return ~(sign | (exponent << 4) | ((pcm >> (exponent + 3)) & 15)) & 255;
  });
}
export function decodeMulaw(bytes: Uint8Array): Float32Array {
  return Float32Array.from(bytes, (byte) => {
    const u = ~byte & 255;
    const value = ((((u & 15) << 3) + 132) << ((u >> 4) & 7)) - 132;
    return (u & 128 ? -value : value) / 32768;
  });
}
