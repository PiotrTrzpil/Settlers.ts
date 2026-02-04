import { ShaderTexture } from './shader-texture';

// https://stackoverflow.com/questions/60614318/how-to-use-data-textures-in-webgl
// https://webglfundamentals.org/webgl/lessons/webgl-data-textures.html
// https://webglfundamentals.org/webgl/lessons/webgl-pulling-vertices.html

export class ShaderDataTexture extends ShaderTexture {
    public imgData: Uint8Array | null = null;
    public width: number;
    public height: number;
    public numberOfElements: number;

    /** Whether the texture data has been uploaded to the GPU */
    private uploaded = false;

    public constructor(width: number, height: number, numberOfElements: number, textureIndex: number) {
        super(textureIndex);

        this.width = width;
        this.height = height;
        this.numberOfElements = numberOfElements;
        this.imgData = new Uint8Array(width * height * numberOfElements);

        Object.seal(this);
    }

    public update(x: number, y: number, r: number, g = 0, b = 0, a = 0): void {
        if (!this.imgData) {
            return;
        }

        const index = (x + y * this.width) * this.numberOfElements;

        switch (this.numberOfElements) {
        case 1:
            this.imgData[index + 0] = r;
            break;
        case 2:
            this.imgData[index + 0] = r;
            this.imgData[index + 1] = g;
            break;
        default:
            this.imgData[index + 0] = r;
            this.imgData[index + 1] = g;
            this.imgData[index + 2] = b;
            this.imgData[index + 3] = a;
            break;
        }
    }

    /** Upload the texture data to the GPU (first call) or just bind the
     *  existing texture to its slot (subsequent calls). The map data is
     *  static so there is no need to re-upload every frame. */
    public create(gl: WebGL2RenderingContext): void {
        super.bind(gl);

        if (this.uploaded) {
            return;
        }

        // WebGL2 sized internal formats with matching unsized format enums.
        // R8 replaces ALPHA, RG8 replaces LUMINANCE_ALPHA.
        let internalFormat: GLenum = gl.RGBA8;
        let format: GLenum = gl.RGBA;

        switch (this.numberOfElements) {
        case 1:
            internalFormat = gl.R8;
            format = gl.RED;
            break;
        case 2:
            internalFormat = gl.RG8;
            format = gl.RG;
            break;
        default:
            internalFormat = gl.RGBA8;
            format = gl.RGBA;
            break;
        }

        const level = 0;
        const border = 0;
        const type = gl.UNSIGNED_BYTE;

        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, this.width, this.height, border,
            format, type, this.imgData);

        this.uploaded = true;
    }
}
