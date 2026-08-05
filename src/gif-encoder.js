/* Small, dependency-free GIF89a encoder using a fixed 3-3-2 colour palette. */
"use strict";
  const bytes = (value, count) => Array.from({ length: count }, (_, i) => (value >> (i * 8)) & 255);
  function palette() {
    const out = [];
    for (let i = 0; i < 256; i++) out.push(Math.round(((i >> 5) & 7) * 255 / 7), Math.round(((i >> 2) & 7) * 255 / 7), (i & 3) * 85);
    return out;
  }
  function indexPixels(rgba, width) {
    const result = new Uint8Array(rgba.length / 4);
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const clamp = value => Math.max(0, Math.min(255, value));
    for (let p = 0, i = 0; p < rgba.length; p += 4, i++) {
      const x = i % width, y = Math.floor(i / width), threshold = bayer[(y % 4) * 4 + (x % 4)] - 7.5;
      const red = clamp(rgba[p] + threshold * 1.6), green = clamp(rgba[p + 1] + threshold * 1.6), blue = clamp(rgba[p + 2] + threshold * 3.2);
      result[i] = (red & 0xe0) | ((green & 0xe0) >> 3) | (blue >> 6);
    }
    return result;
  }
  function lzw(data) {
    const clear = 256, end = 257;
    let codeSize = 9, nextCode = 258, dictionary = new Map(), bitBuffer = 0, bitCount = 0;
    const output = [];
    const write = code => {
      bitBuffer |= code << bitCount; bitCount += codeSize;
      while (bitCount >= 8) { output.push(bitBuffer & 255); bitBuffer >>>= 8; bitCount -= 8; }
    };
    const reset = () => { dictionary = new Map(); codeSize = 9; nextCode = 258; };
    write(clear);
    if (!data.length) { write(end); return output; }
    let prefix = data[0];
    for (let i = 1; i < data.length; i++) {
      const value = data[i], key = prefix * 256 + value;
      if (dictionary.has(key)) { prefix = dictionary.get(key); continue; }
      write(prefix);
      if (nextCode < 4096) {
        dictionary.set(key, nextCode++);
        // The decoder creates its matching entry one code later, so keep the
        // old width through the boundary code and grow immediately after it.
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else { write(clear); reset(); }
      prefix = value;
    }
    write(prefix); write(end);
    if (bitCount) output.push(bitBuffer & 255);
    return output;
  }
  function blocks(data) {
    const out = [];
    for (let i = 0; i < data.length; i += 255) { const size = Math.min(255, data.length - i); out.push(size, ...data.slice(i, i + size)); }
    out.push(0); return out;
  }
  function append(target, values) {
    // Avoid spreading a whole compressed frame: large frames can exceed the
    // JavaScript engine's maximum function-argument count on mobile browsers.
    for (let i = 0; i < values.length; i += 8192) target.push(...values.slice(i, i + 8192));
  }
  export function makeGif(frames, width, height, delay, progress) {
    const out = [...new TextEncoder().encode("GIF89a"), ...bytes(width, 2), ...bytes(height, 2), 0xf7, 0, 0, ...palette()];
    out.push(0x21, 0xff, 0x0b, ...new TextEncoder().encode("NETSCAPE2.0"), 3, 1, 0, 0, 0);
    frames.forEach((rgba, i) => {
      const indexed = indexPixels(rgba, width);
      out.push(0x21, 0xf9, 4, 4, ...bytes(Math.max(2, Math.round(delay / 10)), 2), 0, 0);
      out.push(0x2c, 0, 0, 0, 0, ...bytes(width, 2), ...bytes(height, 2), 0, 8);
      append(out, blocks(lzw(indexed)));
      if (progress) progress((i + 1) / frames.length);
    });
    out.push(0x3b);
    return new Blob([new Uint8Array(out)], { type: "image/gif" });
  }
