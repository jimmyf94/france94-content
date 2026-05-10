declare module 'heic-convert' {
  export default function convert(opts: {
    buffer: Buffer;
    format: 'JPEG' | 'PNG';
    /** JPEG only; 0–1 */
    quality?: number;
  }): Promise<Buffer>;
}
