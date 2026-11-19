import { describe, it, expect } from 'vitest';
import { keyboardLayout } from '../src/app/viewportFill';

describe('chat layout above the iOS keyboard', () => {
  it('keeps the full card when there is room and degrades by visible height', () => {
    expect(keyboardLayout(false, 100)).toBe('none');
    expect(keyboardLayout(true, 170)).toBe('normal');
    expect(keyboardLayout(true, 125)).toBe('normal');
    expect(keyboardLayout(true, 124)).toBe('tight');
    expect(keyboardLayout(true, 90)).toBe('tight');
    expect(keyboardLayout(true, 89)).toBe('min');
  });
});
