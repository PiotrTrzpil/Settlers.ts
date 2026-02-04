precision mediump float;

// Barycentric coordinate for wireframe overlay
in vec3 v_barycentric;

// Landscape texture coordinate
in vec2 v_texcoord;

// Height-gradient shading multiplier
in float v_shader_color;

// The texture.
uniform sampler2D u_texture;

// Runtime toggle for debug grid wireframe
uniform bool u_debugGrid;

out vec4 fragColor;

void main() {
  // Discard fragments from out-of-bounds tiles (vertex shader sets -1,-1)
  if (v_texcoord.x < 0.0) {
    discard;
  }

  fragColor = texture(u_texture, v_texcoord) * vec4(v_shader_color, v_shader_color, v_shader_color, 1.0);

  if (u_debugGrid) {
    // draw triangle border
    if (any(lessThan(v_barycentric, vec3(0.02)))) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
  }
}
