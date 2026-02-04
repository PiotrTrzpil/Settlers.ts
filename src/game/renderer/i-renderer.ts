import { IViewPoint } from './i-view-point';

export interface IRenderer {
        init(gl: WebGL2RenderingContext): Promise<boolean>;
        draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void;
}
