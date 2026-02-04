you are working o e2e test that renders some terrain and compares to screenshot. but you are stuck on screenshot being black.

Maybe viewport is outside the map in the wrong position or maybe something else.

dont overthink it, but instead add some more debug logs or debug rendered elements to see more whats going on


Root cause?: All tile instances are being clipped because they fall outside map bounds.

From the logs:

viewPoint x: 187.07, y: 125, zoom: 0.1
Instance grid: 41x42 starting at (0, 0)
In the vertex shader at landscape-vert.glsl:137:


vec2 pixelCoord = instancePos + viewPoint;
The uniform is set as (-viewPoint.x, -viewPoint.y) = (-187, -125) at renderer.ts:100. So for every instance (0..40, 0..41):

pixelCoord = (0, 0) + (-187, -125) = (-187, -125) → fails bounds check at line 140
All 1,722 instances get clipped (gl_Position.z = 2.0) → black screen
The instance positions tile the screen starting from (0,0), but the viewPoint offset pushes all map lookups to negative coordinates. The instances would need to start near (187, 125) for the map lookups to hit valid coordinates — but then gl_Position (which also uses instancePos directly at line 171) would place everything off-screen.

This is a mismatch between setPosition's coordinate math and how the shader uses the viewPoint. Want me to dig into the fix, or do you want to take it from here with this diagnosis?