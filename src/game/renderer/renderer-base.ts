import { ShaderProgram } from './shader-program';

export class RendererBase {
    protected shaderProgram: ShaderProgram = new ShaderProgram();

    public initShader(gl: WebGL2RenderingContext, vertCode: string, fragCode: string): void {
        this.shaderProgram.init(gl);

        this.shaderProgram.attachShaders(vertCode, fragCode);

        this.shaderProgram.create();
    }

    public drawBase(gl: WebGL2RenderingContext, projection: Float32Array): void {
        const sp = this.shaderProgram;
        if (!sp) {
            return;
        }

        // activate shader and bind its VAO
        sp.use();
        sp.setMatrix('projection', projection);
    }
}
