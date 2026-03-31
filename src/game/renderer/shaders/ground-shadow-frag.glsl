// Ground shadow fragment shader
// Renders a soft elliptical shadow using radial gradient falloff.
// UV ranges from -1 to 1 across the quad; the elliptical shape
// is determined by the quad aspect ratio in world space.

precision mediump float;

in vec2 v_uv;

uniform float u_opacity;

out vec4 fragColor;

void main() {
    // Circular distance in UV space (ellipse shape comes from quad geometry)
    float dist = dot(v_uv, v_uv);

    // Smooth gaussian-like falloff: dense center, soft edges
    // smoothstep(1.0, 0.0, dist) gives linear-ish falloff from center to edge
    // Squaring it concentrates opacity toward the center for a more natural look
    float falloff = smoothstep(1.0, 0.0, dist);
    float alpha = falloff * falloff * u_opacity;

    fragColor = vec4(0.0, 0.0, 0.0, alpha);
}
