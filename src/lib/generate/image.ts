import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { parse, type Font } from "opentype.js";
import { readBytes } from "../http";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type ImageInput = {
  url: string;
  width: number;
  height: number;
  contentType: string;
};

export type DragonInput = {
  subtitle: string;
  type: "text" | "image" | "text_image";
  content: string;
  image?: ImageInput;
};

// Only the Wasm runtime is shared. Assets, fonts and rendering data belong to each request.
let wasmReady: Promise<void> | undefined;

export async function generateDragon(input: DragonInput, assets: Fetcher): Promise<Uint8Array<ArrayBuffer>> {
  const [, fontBytes, balloon, dragon, contentImage] = await Promise.all([
    wasmReady ??= initWasm(resvgWasm),
    loadAsset(assets, "/font/GenJyuuGothic-Normal.ttf", 16 * 1024 * 1024),
    loadAsset(assets, "/img/balloon.png", MAX_IMAGE_BYTES),
    loadAsset(assets, "/img/dragon.png", MAX_IMAGE_BYTES),
    input.image ? loadContentImage(input.image) : undefined,
  ]);
  const font = parse(fontBytes.buffer, { lowMemory: true });
  const svg = createDragonSvg(input, font, balloon, dragon, contentImage);
  const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
  try {
    const rendered = renderer.render();
    try {
      return new Uint8Array(rendered.asPng());
    } finally {
      rendered.free();
    }
  } finally {
    renderer.free();
  }
}

function createDragonSvg(
  input: DragonInput,
  font: Font,
  balloon: Uint8Array,
  dragon: Uint8Array,
  contentImage?: Uint8Array,
): string {
  const elements = [
    '<rect width="1600" height="900" fill="white"/>',
    svgImage(balloon, "image/png", 0, 0, 1600, 900),
    svgImage(dragon, "image/png", 0, 0, 1600, 900),
    textPaths(font, [input.subtitle], { x: 80, y: 755, width: 1440, height: 100 }, 90),
  ];
  if (input.image && contentImage) {
    const maxHeight = input.type === "image" ? 300 : 200;
    const scale = Math.min(450 / input.image.width, maxHeight / input.image.height);
    const width = input.image.width * scale;
    const height = input.image.height * scale;
    const centerY = input.type === "image" ? 300 : 245;
    elements.push(svgImage(contentImage, input.image.contentType, 425 - width / 2, centerY - height / 2, width, height));
  }
  if (input.type !== "image") {
    const lines = input.content.split(/\\n|\r?\n/);
    const box = input.type === "text"
      ? { x: 200, y: 150, width: 450, height: 320 }
      : { x: 200, y: 365, width: 450, height: 110 };
    elements.push(textPaths(font, lines, box, input.type === "text" ? 90 : 75));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1600" height="900" viewBox="0 0 1600 900">${elements.join("")}</svg>`;
}

function fittedFontSize(font: Font, lines: string[], size: number, width: number): number {
  const maxWidth = Math.max(...lines.map((line) => font.getAdvanceWidth(line, size)));
  return maxWidth > width ? size * width / maxWidth : size;
}

function textPaths(
  font: Font,
  lines: string[],
  box: { x: number; y: number; width: number; height: number },
  preferredSize: number,
): string {
  const size = Math.min(fittedFontSize(font, lines, preferredSize, box.width), box.height / lines.length);
  // Keep glyphs separate: a single long path can be truncated by the SVG rasterizer.
  const paths = lines.flatMap((line, index) => font.getPaths(line, -font.getAdvanceWidth(line, size) / 2, index * size, size));
  const bounds = paths.filter((path) => path.commands.length).map((path) => path.getBoundingBox());
  if (!bounds.length) return "";
  const left = Math.min(...bounds.map((bound) => bound.x1));
  const right = Math.max(...bounds.map((bound) => bound.x2));
  const top = Math.min(...bounds.map((bound) => bound.y1));
  const bottom = Math.max(...bounds.map((bound) => bound.y2));
  const scale = Math.min(1, box.width / (right - left || 1), box.height / (bottom - top || 1));
  const x = box.x + box.width / 2 - (left + right) / 2 * scale;
  const y = box.y + box.height / 2 - (top + bottom) / 2 * scale;
  // Preserve every glyph contour when serializing SVG.
  const content = paths.map((path) => `<path d="${path.toPathData({ decimalPlaces: 3, optimize: false, flipY: false })}"/>`).join("");
  return `<g fill="black" transform="translate(${x} ${y}) scale(${scale})">${content}</g>`;
}

function svgImage(bytes: Uint8Array, mime: string, x: number, y: number, width: number, height: number): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return `<image x="${x}" y="${y}" width="${width}" height="${height}" xlink:href="data:${mime};base64,${btoa(binary)}"/>`;
}

async function loadAsset(assets: Fetcher, path: string, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const response = await assets.fetch(`https://assets.internal${path}`);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`素材を読み込めませんでした: ${path}`);
  }
  return readBytes(response, maxBytes);
}

async function loadContentImage(image: ImageInput): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(image.url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("添付画像を取得できませんでした。");
  }
  return readBytes(response, MAX_IMAGE_BYTES);
}
