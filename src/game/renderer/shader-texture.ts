import { ShaderObject } from './shader-object';

// https://stackoverflow.com/questions/60614318/how-to-use-data-textures-in-webgl
// https://webglfundamentals.org/webgl/lessons/webgl-data-textures.html
// https://webglfundamentals.org/webgl/lessons/webgl-pulling-vertices.html

export class ShaderTexture implements ShaderObject {
    protected texture: WebGLTexture | null = null;
    private gl: WebGL2RenderingContext | null = null;
    private textureIndex: number;

    public constructor(textureIndex: number) {
        this.textureIndex = textureIndex;
    }

    protected bind(gl: WebGL2RenderingContext): void {
        this.gl = gl;

        // Reuse existing texture object if already created.
        if (!this.texture) {
            this.texture = gl.createTexture();
        }

        gl.activeTexture(gl.TEXTURE0 + this.textureIndex);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    public free(): void {
        if (!this.gl) {
            return;
        }

        this.gl.deleteTexture(this.texture);
    }
}
