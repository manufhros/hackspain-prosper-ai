import { expect, test } from 'bun:test';
import { CaptureFrames, encodeSample, decodeSample, KioskWire, Playback } from '../src/edge/public/audio.js';
import { WireInspector } from '../src/protocol';

test('G.711 silence and signed reference samples decode correctly', () => {
  expect(encodeSample(0)).toBe(255);
  expect(decodeSample(255)).toBe(0);
  expect(decodeSample(0)).toBe(-32124 / 32768);
  expect(decodeSample(128)).toBe(32124 / 32768);
  for (const sample of [-.9, -.5, -.1, .1, .5, .9]) expect(Math.abs(decodeSample(encodeSample(sample)) - sample)).toBeLessThan(.025);
});
test('fractional downsampling emits exactly 50 telephone frames per second across render boundaries', () => {
  for (const rate of [44100, 48000, 96000]) {
    const frames = [];
    const capture = new CaptureFrames(rate, frame => frames.push(frame));
    for (let offset = 0; offset < rate; offset += 128) capture.push(new Float32Array(Math.min(128, rate - offset)));
    expect(frames).toHaveLength(50);
    expect(frames.every(frame => frame.length === 160 && frame.every(value => value === 255))).toBe(true);
    expect(new Set(frames).size).toBe(50);
  }
});
test('microphone frames interleaved with playback marks obey the backend protocol', () => {
  const inspector = new WireInspector(), messages = [];
  const wire = new KioskWire(raw => { const message = JSON.parse(raw); messages.push(message); inspector.receive(message); }, 'fixture');
  wire.start(); wire.media(new Uint8Array(160).fill(255)); wire.mark('heard'); wire.media(new Uint8Array(160).fill(255));
  wire.message('stop');
  expect(inspector.finish().errors).toEqual([]);
  expect(messages.at(-2).media.timestamp).toBe('20');
  expect(inspector.callId.startsWith('workbench-edge-')).toBe(true);
});
test('playback clear stops all queued sources and never acknowledges discarded output', async () => {
  let stops = 0, acknowledgements = 0;
  const context = { currentTime: 0, state: 'running', destination: {},
    createBuffer: (_, length, rate) => ({ duration: length / rate, getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() {}, stop() { stops++; } }),
  };
  const playback = new Playback(context, () => {});
  playback.push(btoa(String.fromCharCode(...new Uint8Array(160).fill(255))));
  playback.mark(() => acknowledgements++);
  playback.clear();
  await Bun.sleep(100);
  expect(stops).toBe(1); expect(acknowledgements).toBe(0); expect(playback.sources.size).toBe(0);
  expect(() => playback.push('invalid')).toThrow();
});
test('playback buffers once and keeps packets contiguous despite small arrival jitter', () => {
  const starts = [];
  const context = { currentTime: 0, state: 'running', destination: {},
    createBuffer: (_, length, rate) => ({ duration: length / rate, getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ connect() {}, disconnect() {}, start(at) { starts.push(at); }, stop() {} }),
  };
  const playback = new Playback(context, () => {});
  const frame = btoa(String.fromCharCode(...new Uint8Array(160).fill(255)));
  playback.push(frame);
  context.currentTime = .023; playback.push(frame);
  context.currentTime = .041; playback.push(frame);
  expect(starts).toEqual([.06, .08, .1]);
  playback.clear();
});
