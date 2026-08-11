/**
 * The renderer's currency is `ImageData`, which node does not provide. The real
 * one is a plain data holder — width, height, and an RGBA `Uint8ClampedArray` —
 * so a faithful stand-in is a few lines and lets every pixel pass be tested
 * without a canvas, a browser, or jsdom.
 */
class NodeImageData implements ImageData {
  readonly data: Uint8ClampedArray<ArrayBuffer>
  readonly width: number
  readonly height: number
  readonly colorSpace: PredefinedColorSpace = 'srgb'
  readonly pixelFormat: ImageDataPixelFormat = 'rgba-unorm8'

  constructor(
    dataOrWidth: Uint8ClampedArray<ArrayBuffer> | number,
    widthOrHeight: number,
    height?: number,
  ) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = dataOrWidth
      this.width = widthOrHeight
      this.height = height ?? dataOrWidth.length / 4 / widthOrHeight
    }
  }
}

// `in` rather than `??=`: the DOM lib types ImageData as always present, so a
// nullish check reads as dead code to the linter even though it is not at
// runtime under node.
if (!('ImageData' in globalThis)) {
  globalThis.ImageData = NodeImageData as unknown as typeof ImageData
}
