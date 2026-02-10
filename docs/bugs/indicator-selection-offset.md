# Building Indicator Selection Offset Bug

## Symptom
When hovering over a building placement indicator, the indicator does NOT highlight when the mouse is centered on it. Instead, the indicator highlights when the mouse is positioned at the **bottom-right corner** of the indicator.

In other words: the tile selection hitbox is offset DOWN and to the RIGHT relative to where the indicator is visually rendered.

## What This Means
- Visual indicator position: (x, y)
- Mouse position that selects that tile: (x + offset, y + offset)

The offset is consistent - always down-right.

## Investigation Summary

### Coordinate Transform Math - VERIFIED CORRECT
The forward and reverse transforms are mathematically correct inverses:

**tileToWorld** (renders indicator at tile center):
```
worldX = 0.25 + instanceX - instanceY * 0.5 - vpFracX + vpFracY * 0.5
worldY = (0.5 + instanceY - height - vpFracY) * 0.5
```

**worldToTileFractional** (picks tile from mouse position):
```
instanceY = worldY * 2 - 0.5 + height + vpFracY
instanceX = worldX - 0.25 + instanceY * 0.5 + vpFracX - vpFracY * 0.5
```

Substitution confirms these are true inverses.

### Projection Matrix - VERIFIED CORRECT
The projection in renderer.ts and the reverse in ndcToWorld match:
- `worldX = ((ndcX + zoom) * aspect) / zoom`
- `worldY = (zoom - ndcY) / zoom`

### Height Lookup - VERIFIED CONSISTENT
Both GLSL and TypeScript use `h * 20 / 255` for height conversion.

### Aspect Ratio - VERIFIED CONSISTENT
Both projection and tile picking use the same aspect ratio formula.

### Roundtrip Tests - PASS
The unit tests for tile → world → screen → tile roundtrip all pass.

## What Has NOT Been Checked
1. **Actual runtime values** - Need to add debug logging to see actual mouse coords, world coords, and picked tiles
2. **Browser/canvas coordinate offsets** - Could there be padding, borders, or other CSS affecting mouse position?
3. **Event coordinate extraction** - InputManager uses `clientX - rect.left`, is this correct for all browsers?
4. **Timing/async issues** - Is there any frame delay between mouse position and render state?

## Possible Causes (Hypotheses)
1. **Canvas CSS offset** - If the canvas has padding/border, mouse coordinates might be off
2. **getBoundingClientRect() issue** - Could return outdated values during scroll/resize
3. **Sub-pixel rendering** - HiDPI scaling might cause fractional pixel offsets
4. **Parallelogram hit-testing** - Using Math.round() on fractional tile coords might not match parallelogram geometry

## Next Steps
1. Add debug overlay showing: mouse screen coords, computed world coords, picked tile, and expected tile center
2. Compare indicator visual position to where screenToTile says that tile is
3. Check if offset is consistent in pixels or in tiles (zoom-dependent?)
