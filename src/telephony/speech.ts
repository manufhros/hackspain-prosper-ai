/** Split only validated speech, preserving words, numbers and the complete offer order. */
export function speechChunks(text: string): string[] {
  const words = text.trim().split(/\s+/), chunks: string[] = [];
  let chunk = "";
  for (const word of words) {
    if (chunk && chunk.length + word.length + 1 > 180) { chunks.push(chunk); chunk = ""; }
    chunk += (chunk ? " " : "") + word;
    const boundary = /[.!?;:]$/.test(word) && !/^(?:Dr|Dra|Sr|Sra|Mr|Mrs|Ms|St)\.$/i.test(word);
    if (chunk.length >= 60 && boundary) { chunks.push(chunk); chunk = ""; }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
