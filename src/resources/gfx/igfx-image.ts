import { ImageType } from './image-type';

export interface IGfxImage {
        imageType: ImageType;
        getImageData(): ImageData;
        height: number;
        width: number;
        /** left (x) offset to display the image */
        left: number;
        /** top (y) offset to display the image */
        top: number;
        flag1: number;
        flag2: number;
        getDataSize(): number;

        /** start of image data */
        dataOffset: number;
}
