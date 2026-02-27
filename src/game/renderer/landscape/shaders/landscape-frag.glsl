precision mediump float;

// Barycentric coordinate for wireframe overlay
in vec3 v_barycentric;

// Landscape texture coordinate
in vec2 v_texcoord;

// Height-gradient shading multiplier
in float v_shader_color;

#ifdef HAS_DARKNESS
// x = dark land intensity (0-1), y = fog of war level (0-1)
in vec2 v_darkness;
#endif

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

  vec3 color = texture(u_texture, v_texcoord).rgb * v_shader_color;

  #ifdef HAS_DARKNESS
  // --- Dark land: desaturate + darken + cool tint (preserves texture detail) ---
  if (v_darkness.x > 0.0) {
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    float dark = v_darkness.x;
    // Partial desaturation toward luminance
    color = mix(color, vec3(lum), dark * 0.4);
    // Darken
    color *= 1.0 - dark * 0.3;
    // Cool blue-gray tint
    color *= mix(vec3(1.0), vec3(0.82, 0.84, 0.96), dark);
  }

  // --- Fog of war: gray overlay that obscures detail ---
  if (v_darkness.y > 0.0) {
    float fog = v_darkness.y;
    // Mix toward a neutral gray fog color
    color = mix(color, vec3(0.38, 0.38, 0.42), fog * 0.75);
  }
  #endif

  fragColor = vec4(color, 1.0);

  if (u_debugGrid) {
    // draw triangle border
    if (any(lessThan(v_barycentric, vec3(0.02)))) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
  }
}
