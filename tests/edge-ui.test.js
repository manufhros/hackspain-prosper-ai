import { expect, test } from 'bun:test';
import { copy } from '../src/edge/public/locale.js';

test('every supported locale defines the same controls and interaction states', () => {
  for (const locale of ['ca', 'en']) expect(Object.keys(copy[locale]).sort()).toEqual(Object.keys(copy.es).sort());
});
test('browser and AudioWorklet entrypoints bundle without backend imports or external dependencies', async () => {
  for (const entry of ['app.js', 'capture.js']) {
    const result = await Bun.build({ entrypoints: [`${import.meta.dir}/../src/edge/public/${entry}`], target: 'browser', write: false });
    expect(result.success).toBe(true);
    expect(result.outputs).toHaveLength(1);
  }
});
