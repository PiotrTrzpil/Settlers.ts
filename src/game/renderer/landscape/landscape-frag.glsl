precision mediump float;

#ifdef DEBUG_TRIANGLE_BORDER
  // Barycentric coordinate for wireframe overlay
  varying vec3 v_barycentric;
#endif

// Landscape texture coordinate
varying vec2 v_texcoord;

// Height-gradient shading multiplier
varying float v_shader_color;

// The texture.
uniform sampler2D u_texture;

void main() {
  // Discard fragments from out-of-bounds tiles (vertex shader sets -1,-1)
  if (v_texcoord.x < 0.0) {
    discard;
  }

  gl_FragColor = texture2D(u_texture, v_texcoord) * vec4(v_shader_color, v_shader_color, v_shader_color, 1.0);

  #ifdef DEBUG_TRIANGLE_BORDER
    // draw triangle border
    if (any(lessThan(v_barycentric, vec3(0.02)))) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
  #endif
}
