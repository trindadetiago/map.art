import { describe, expect, it } from 'vitest';
import { StubImageModel } from '../src/stub';

describe('StubImageModel', () => {
  it('echoes the input image back and reports model=stub', async () => {
    const model = new StubImageModel();
    const input = Buffer.from([1, 2, 3, 4]);
    const result = await model.generate({ input, prompt: 'ignored' });
    expect(result.image).toBe(input);
    expect(result.metadata.model).toBe('stub');
    expect(result.metadata.prompt).toBe('ignored');
  });
});
