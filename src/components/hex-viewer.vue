<template>
  <div class="optionSelect">
    <input type="radio" id="none" value="" v-model="type">
    <label for="none">none</label>

    <input type="radio" id="text" value="text" v-model="type">
    <label for="text">text</label>

    <input type="radio" id="hex" value="hex" v-model="type">
    <label for="hex">hex</label>

    <template v-if="width">
      <input type="radio" id="img" value="img" v-model="type">
      <label for="img">image</label>
    </template>

    <button @click="onSaveFile()">save</button>
  </div>

  <br />

  <template v-if="type!=='img'">
    <pre class="content">{{content}}</pre>

    <a href="#" v-if="isTrimmed" @click="showAll">show all</a>
  </template>

 <div v-show="type==='img'">
    <label>Bytes per Pixle:
      <input type="number" v-model.number="bytePerPixel" @change="updateContent" />
    </label>

    <label> Byte offset:
      <input type="number" v-model.number="byteOffset" @change="updateContent" />
    </label>

    <label> Width:
      <input type="number" v-model.number="useWidth" @change="updateContent" />
    </label>

    <br />
    {{imagePointInfo}}
    <br />

    <canvas
      height="800"
      width="800"
      ref="cav"
      class="cav"
      @mousemove="onMouseMove"
    />
  </div>

</template>

<script setup lang="ts">
import { ref, watch, useTemplateRef } from 'vue';
import { BinaryReader } from '@/resources/file/binary-reader';

const props = defineProps<{
    value?: BinaryReader;
    width?: number;
    height?: number;
}>();

const cav = useTemplateRef<HTMLCanvasElement>('cav');

const useWidth = ref(props.width ?? 128);
const imagePointInfo = ref('');
const bytePerPixel = ref(4);
const byteOffset = ref(0);
const isTrimmed = ref(false);
const doNotTrim = ref(false);
const content = ref('');
const type = ref('');

function showAll() {
    doNotTrim.value = true;
    updateContent();
}

function onSaveFile() {
    if (props.value == null) {
        return;
    }

    const a = window.document.createElement('a');
    const url = window.URL.createObjectURL(new Blob([props.value.getBuffer()]));
    a.download = props.value.filename;
    a.href = url;
    a.click();

    setTimeout(() => {
        window.URL.revokeObjectURL(url);
    }, 100);
}

function onMouseMove(evt: MouseEvent) {
    if (!props.value) {
        return;
    }

    const rect = (evt.target as HTMLCanvasElement).getBoundingClientRect();
    const x = Math.trunc(evt.clientX - rect.left);
    const y = Math.trunc(evt.clientY - rect.top);

    imagePointInfo.value =
        ' x: ' + x +
        ' y: ' + y +
        ' value: ' + peekValue(
            props.value,
            x, y,
            bytePerPixel.value, byteOffset.value,
            useWidth.value ?? 1);
}

function peekValue(data: BinaryReader, x: number, y: number, bpp: number, offset: number, w: number) {
    const intX = Math.floor(x);
    if ((intX < 0) || (intX >= w)) {
        return;
    }

    const buffer = data.getBuffer();
    const bufferPos = (Math.floor(x) + Math.floor(y) * w) * bpp + offset;

    return buffer[bufferPos];
}

function updateContent() {
    if (!props.value) {
        content.value = '';
        return;
    }

    switch (type.value) {
    case 'hex':
        content.value = toHex(props.value);
        break;
    case 'text':
        content.value = toText(props.value);
        break;
    case 'img':
        content.value = '';
        {
            const cavEl = cav.value;
            if (cavEl) {
                toImg(
                    props.value,
                    bytePerPixel.value, byteOffset.value,
                    useWidth.value ?? 1, props.height ?? 1,
                    cavEl);
            }
        }
        break;
    default:
        content.value = '';
    }
}

function toImg(data: BinaryReader, bpp: number, offset: number, w: number, h: number, cavEl: HTMLCanvasElement) {
    if ((!cavEl) || (!cavEl.getContext)) {
        return;
    }

    if ((w > 5000) || (h > 5000)) {
        return;
    }

    const img = new ImageData(w, h);
    const imgData = img.data;

    const buffer = data.getBuffer();
    let j = 0;
    const length = Math.min(buffer.length - offset, w * h * bpp);

    for (let i = offset; i < length; i += bpp) {
        const value = buffer[i];

        imgData[j++] = value; // r
        imgData[j++] = value; // g
        imgData[j++] = value; // b
        imgData[j++] = 255; // alpha
    }

    cavEl.height = h;
    const context = cavEl.getContext('2d');
    if (!context) {
        return;
    }

    context.putImageData(img, 0, 0);
}

function createHexLine(hexValues: string, asciiValues: string) {
    if (hexValues.length > 0) {
        return hexValues + '\t' + asciiValues + '\n';
    } else {
        return '';
    }
}

function getMaxLengthAndSetTrimmed(source: BinaryReader) {
    if ((doNotTrim.value) || (source.length <= 10000)) {
        isTrimmed.value = false;
        return source.length;
    }

    isTrimmed.value = true;
    return 10000;
}

function toText(source: BinaryReader): string {
    const maxLen = getMaxLengthAndSetTrimmed(source);
    return source.readString(maxLen, 0);
}

function toHex(source: BinaryReader): string {
    let maxLen = getMaxLengthAndSetTrimmed(source);
    source.setOffset(0);

    let lineLetters = '';
    let lineHex = '';
    let length = 0;
    let result = '';

    while (!source.eof() && maxLen > 0) {
        maxLen--;

        const char = source.readByte();

        lineHex += (char < 16 ? '0' : '') + char.toString(16) + ' ';
        lineLetters += (char < 16) ? '' : String.fromCharCode(char);
        length++;

        if (length > 32) {
            result += createHexLine(lineHex, lineLetters);
            lineHex = '';
            lineLetters = '';
            length = 0;
        }
    }

    return result + createHexLine(lineHex, lineLetters);
}

watch(() => props.value, () => {
    doNotTrim.value = false;
    updateContent();
});

watch(() => props.width, () => {
    useWidth.value = props.width ?? 128;
});

watch(type, () => {
    updateContent();
});
</script>

<style scoped>

.content{
  font-family:"Courier New", Courier, monospace;
  text-align: left;
  white-space: pre-wrap;
}

.cav {
  margin: 3px;
  border: 1px solid red;
}

.optionSelect input, .optionSelect button {
  margin-left: 10px;
}

</style>
