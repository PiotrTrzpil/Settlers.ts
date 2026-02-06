import { LogHandler } from '@/utilities/log-handler';
import { ShaderObject } from './shader-object';

export enum ShaderType {
        VERTEX_SHADER,
        FRAGMENT_SHADER
}

export class ShaderProgram implements ShaderObject {
    private static log = new LogHandler('ShaderProgram');
    private gl: WebGL2RenderingContext | null = null;
    private shaders: WebGLShader[] = [];
    private shaderProgram: WebGLProgram | null = null;
    private defines: string[] = [];

    /** Vertex Array Object – captures attribute state so we don't rebind every frame */
    private vao: WebGLVertexArrayObject | null = null;

    /** Cached WebGL buffers keyed by attribute name to avoid leaking GPU memory */
    private bufferCache: Map<string, WebGLBuffer> = new Map();

    constructor() {
        Object.seal(this);
    }

    public init(gl: WebGL2RenderingContext): void {
        this.gl = gl;
    }

    private shaderTypeToNumber(shaderType: ShaderType) {
        if (!this.gl) {
            return 0;
        }

        switch (shaderType) {
        case ShaderType.VERTEX_SHADER:
            return this.gl.VERTEX_SHADER;
        case ShaderType.FRAGMENT_SHADER:
            return this.gl.FRAGMENT_SHADER;
        default:
            return 0;
        }
    }

    public create(): boolean {
        if (!this.gl) {
            return false;
        }

        // Clean up existing program if reinitializing (handles HMR)
        if (this.shaderProgram) {
            this.gl.deleteProgram(this.shaderProgram);
        }
        if (this.vao) {
            this.gl.deleteVertexArray(this.vao);
            this.vao = null;
        }

        // Create a shader program object to store combined shader program
        this.shaderProgram = this.gl.createProgram();

        if (!this.shaderProgram) {
            ShaderProgram.log.error('Unable to create new shader Program');
            return false;
        }

        // Attach all shaders
        for (const s of this.shaders) {
            this.gl.attachShader(this.shaderProgram, s);
        }

        // Link programs
        this.gl.linkProgram(this.shaderProgram);

        // Check link status
        if (!this.gl.getProgramParameter(this.shaderProgram, this.gl.LINK_STATUS)) {
            ShaderProgram.log.error('Shader program link failed: ' + this.gl.getProgramInfoLog(this.shaderProgram));
            return false;
        }

        // Create a VAO to capture attribute state for this program
        this.vao = this.gl.createVertexArray();

        return true;
    }

    public use(): void {
        if ((!this.shaderProgram) || (!this.gl)) {
            return;
        }

        // Use the shader program object
        this.gl.useProgram(this.shaderProgram);

        // Bind this program's VAO so its attribute state is active
        if (this.vao) {
            this.gl.bindVertexArray(this.vao);
        }
    }

    public setDefine(defineName: string, value: number | string): void {
        this.defines.push('#define ' + defineName + ' ' + value);
    }

    public setMatrix(name: string, values: Float32Array): void {
        const gl = this.gl;
        if ((!this.shaderProgram) || (!gl)) {
            return;
        }

        const uniformLocation = gl.getUniformLocation(this.shaderProgram, name);
        if (uniformLocation === null) {
            ShaderProgram.log.debug(`Uniform '${name}' not found or optimized away`);
            return;
        }

        gl.uniformMatrix4fv(uniformLocation, false, values);
    }

    public setVector2(name: string, a1: number, a2: number): void {
        const gl = this.gl;
        if ((!this.shaderProgram) || (!gl)) {
            return;
        }

        const uniformLocation = gl.getUniformLocation(this.shaderProgram, name);
        if (uniformLocation === null) {
            ShaderProgram.log.debug(`Uniform '${name}' not found or optimized away`);
            return;
        }

        gl.uniform2fv(uniformLocation, [a1, a2]);
    }

    public setArrayFloat(name: string, values: Float32Array, size: number, divisor = 0): void {
        if (!this.gl) {
            return;
        }

        this.setAttribute(name, values, size, this.gl.FLOAT, divisor);
    }

    public setArrayShort(name: string, values: Int16Array, size: number, divisor = 0): void {
        if (!this.gl) {
            return;
        }

        this.setAttribute(name, values, size, this.gl.SHORT, divisor);
    }

    public setAttribute(name: string, values: BufferSource, size: number, type: number, divisor: number): void {
        const gl = this.gl;
        if ((!this.shaderProgram) || (!gl)) {
            return;
        }

        const attribLocation = gl.getAttribLocation(this.shaderProgram, name);
        gl.enableVertexAttribArray(attribLocation);

        // Reuse an existing buffer for this attribute or create one.
        // Previously a new buffer was created every frame, leaking GPU memory.
        let buffer = this.bufferCache.get(name);
        if (!buffer) {
            buffer = gl.createBuffer()!;
            this.bufferCache.set(name, buffer);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW);

        gl.vertexAttribPointer(attribLocation, size, type, false, 0, 0);

        if (divisor) {
            // Native WebGL2 instancing – no extension needed
            gl.vertexAttribDivisor(attribLocation, divisor);
        }
    }

    /** Draw instanced geometry using native WebGL2 instancing */
    public drawArraysInstanced(mode: GLenum, first: number, count: number, instanceCount: number): void {
        if (!this.gl) {
            return;
        }
        this.gl.drawArraysInstanced(mode, first, count, instanceCount);
    }

    public getAttribLocation(name: string): number {
        if (!this.gl || !this.shaderProgram) return -1;
        return this.gl.getAttribLocation(this.shaderProgram, name);
    }

    public getUniformLocation(name: string): WebGLUniformLocation | null {
        if (!this.gl || !this.shaderProgram) return null;
        return this.gl.getUniformLocation(this.shaderProgram, name);
    }

    public bindTexture(name: string, textureId: number): void {
        if ((!this.shaderProgram) || (!this.gl)) {
            return;
        }

        const location = this.gl.getUniformLocation(this.shaderProgram, name);
        if (location === null) {
            ShaderProgram.log.debug(`Texture uniform '${name}' not found or optimized away`);
            return;
        }

        this.gl.uniform1i(location, textureId);
    }

    public free(): void {
        if (!this.gl) {
            return;
        }

        if (this.vao) {
            this.gl.deleteVertexArray(this.vao);
        }

        if (this.shaderProgram) {
            this.gl.deleteProgram(this.shaderProgram);
        }

        while (this.shaders.length > 0) {
            const s = this.shaders.pop();
            if (s) {
                this.gl.deleteShader(s);
            }
        }

        for (const buf of this.bufferCache.values()) {
            this.gl.deleteBuffer(buf);
        }
        this.bufferCache.clear();
    }

    /**
     * setup, compiles shaders and links GLSL program
     */
    public attachShaders(srcVertex: string, srcFragment: string): boolean {
        // Clean up any existing shaders first (handles HMR reinitialization)
        if (this.shaders.length > 0 && this.gl) {
            for (const s of this.shaders) {
                this.gl.deleteShader(s);
            }
            this.shaders.length = 0;
        }

        const r1 = this.attachShader(srcVertex, ShaderType.VERTEX_SHADER);
        const r2 = this.attachShader(srcFragment, ShaderType.FRAGMENT_SHADER);

        return r1 && r2;
    }

    /**
     * setup, compiles one shader and links GLSL program
     */
    public attachShader(src: string, shaderType: ShaderType): boolean {
        if (!this.gl) {
            return false;
        }

        // Create a shader object.
        const newShader = this.gl.createShader(this.shaderTypeToNumber(shaderType));

        if (!newShader) {
            ShaderProgram.log.error('Unable to createShader: ' + shaderType);
            return false;
        }

        // #version 300 es MUST be the very first line in GLSL ES 3.0 shaders,
        // before any #define directives or other source code.
        src = '#version 300 es\n' + this.defines.join('\n') + '\n' + src;

        // Compile the shader
        this.gl.shaderSource(newShader, src);
        this.gl.compileShader(newShader);

        const compileStatus = !!this.gl.getShaderParameter(newShader, this.gl.COMPILE_STATUS);

        if (!compileStatus) {
            ShaderProgram.log.error('Unable to compile shader:' + this.gl.getShaderInfoLog(newShader));
            return false;
        }

        this.shaders.push(newShader);

        return true;
    }
}
