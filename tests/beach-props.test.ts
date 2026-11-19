import { describe, expect, it } from 'vitest';
import { buildBeachProps } from '../src/render/beach/beachProps';

describe('Yoo Plage props batch (triangle budget)', () => {
  const g = buildBeachProps().geometry; const tri = g.attributes.position.count / 3;
  it('stays one batch under 16 500 triangles (was 19 008 before hidden geometry was trimmed)', () => {
    expect(tri).toBeLessThanOrEqual(16500);
    expect(tri).toBeGreaterThan(14000); // nothing went missing
  });
  it('keeps the same footprint (bounds of the whole beach scenery)', () => {
    g.computeBoundingBox(); const b = g.boundingBox!;
    // dunes and pier piles reach below the sand; the trimmed dunes now stop at their centre (y = -0.25)
    expect(b.max.y).toBeGreaterThan(2); expect(b.min.y).toBeLessThan(-0.5);
  });
});
