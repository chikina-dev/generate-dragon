import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { convertV4MiniflareOptions, Miniflare, Response } from "miniflare";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".wrangler/generation-validation");
const config = JSON.parse(await readFile(resolve(root, "wrangler.jsonc"), "utf8"));
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyHex = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const pending = new Map();
const fixtures = new Map();
const results = [];
let worker;
let nextId = 0;

before(async () => {
  await mkdir(output, { recursive: true });
  for (const [name, width, height, format] of [
    ["landscape", 600, 200, "png"],
    ["portrait", 100, 600, "png"],
    ["jpeg", 300, 200, "jpeg"],
    ["gif", 300, 200, "gif"],
  ]) {
    const svg = `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#19b878"/><rect width="${width / 4}" height="100%" fill="#ed4855"/><rect x="${width * 3 / 4}" width="${width / 4}" height="100%" fill="#386be8"/></svg>`;
    const bytes = await sharp(Buffer.from(svg)).toFormat(format).toBuffer();
    fixtures.set(name, { width, height, bytes, mime: `image/${format}` });
  }
  const files = await readdir(resolve(root, "dist"));
  worker = new Miniflare(convertV4MiniflareOptions({
    name: config.name,
    compatibilityDate: config.compatibility_date,
    cf: false,
    modulesRoot: resolve(root, "dist"),
    modules: [
      { type: "ESModule", path: resolve(root, "dist/index.js") },
      ...files.filter((file) => file.endsWith(".wasm")).map((file) => ({ type: "CompiledWasm", path: resolve(root, "dist", file) })),
    ],
    bindings: { DISCORD_PUBLIC_KEY: publicKeyHex },
    assets: { ...config.assets, directory: resolve(root, config.assets.directory), routerConfig: { has_user_worker: true } },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.hostname === "cdn.discordapp.com") {
        const fixture = fixtures.get(url.pathname.slice(1));
        return fixture
          ? new Response(fixture.bytes, { headers: { "content-type": fixture.mime } })
          : new Response("Not found", { status: 404 });
      }
      if (url.hostname === "discord.com" && request.method === "PATCH") {
        const token = url.pathname.split("/")[5];
        const form = await request.formData();
        const payload = JSON.parse(form.get("payload_json"));
        const file = form.get("files[0]");
        pending.get(token)?.resolve({ payload, file: file && Buffer.from(await file.arrayBuffer()), filename: file?.name });
        return Response.json({ id: "test-response" });
      }
      throw new Error(`Unexpected outbound request: ${request.method} ${url.origin}${url.pathname}`);
    },
  }));
  await worker.ready;
});

after(async () => {
  await worker?.dispose();
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  if (results.length) {
    const thumbs = await Promise.all(results.map(async (result, index) => ({
      input: await sharp(resolve(output, `${result.name}.png`)).resize(480, 270).png().toBuffer(),
      left: (index % 2) * 480,
      top: Math.floor(index / 2) * 270,
    })));
    await sharp({ create: { width: 960, height: Math.ceil(thumbs.length / 2) * 270, channels: 3, background: "white" } })
      .composite(thumbs).png().toFile(resolve(output, "contact-sheet.png"));
  }
});

function signedBody(interaction) {
  const body = JSON.stringify(interaction);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-timestamp": timestamp,
      "x-signature-ed25519": sign(null, Buffer.from(timestamp + body), privateKey).toString("hex"),
    },
    body,
  };
}

function command({ type = "text", title = "好きな惣菜発表ドラゴン", content = "唐揚げ\\nハンバーグ\\nエビフライ", fixture }) {
  const id = String(++nextId);
  const options = [{ type: 3, name: "title", value: title }, { type: 3, name: "type", value: type }];
  if (content !== undefined) options.push({ type: 3, name: "content", value: content });
  const data = { id: "100", name: "generate_dragon", type: 1, options };
  if (fixture) {
    const file = fixtures.get(fixture) ?? { width: 300, height: 200, bytes: Buffer.alloc(0), mime: "image/png" };
    options.push({ type: 11, name: "image", value: "200" });
    data.resolved = { attachments: { "200": {
      id: "200", filename: fixture, size: file.bytes.length, width: file.width, height: file.height,
      content_type: file.mime, url: `https://cdn.discordapp.com/${fixture}`, proxy_url: `https://cdn.discordapp.com/${fixture}`,
    } } };
  }
  return { id, application_id: "300", token: `test-${id}`, type: 2, version: 1, attachment_size_limit: 20 * 1024 * 1024, data };
}

async function generate(name, input) {
  const interaction = command(input);
  const deferred = Promise.withResolvers();
  pending.set(interaction.token, deferred);
  const start = performance.now();
  try {
    const response = await worker.dispatchFetch("https://bot.test/interactions", signedBody(interaction));
    assert.equal(response.status, 200, response.status !== 200 ? await response.text() : undefined);
    assert.deepEqual(await response.json(), { type: 5 });
    const ackMs = performance.now() - start;
    assert.ok(ackMs < 3000, `Initial response took ${ackMs}ms`);
    const reply = await Promise.race([deferred.promise, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("No reply within 25 seconds")), 25_000);
      timer.unref();
    })]);
    assert.ok(reply.file, `Generation failed: ${JSON.stringify(reply.payload)}`);
    assert.equal(reply.filename, "hapyou-dragon.png");
    const metadata = await sharp(reply.file).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 1600);
    assert.equal(metadata.height, 900);
    const result = { name, milliseconds: Math.round(performance.now() - start), ackMs: Math.round(ackMs), bytes: reply.file.length };
    results.push(result);
    await writeFile(resolve(output, `${name}.png`), reply.file);
    console.log(JSON.stringify(result));
    return reply.file;
  } finally {
    pending.delete(interaction.token);
  }
}

async function raw(buffer) {
  return sharp(buffer).removeAlpha().raw().toBuffer();
}

function darkPixels(pixels, x, y, width, height) {
  let count = 0;
  for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) {
    const offset = (row * 1600 + column) * 3;
    if (pixels[offset] < 80 && pixels[offset + 1] < 80 && pixels[offset + 2] < 80) count++;
  }
  return count;
}

test("signed PING succeeds and invalid signatures are rejected", async () => {
  const ping = await worker.dispatchFetch("https://bot.test/interactions", signedBody({ type: 1 }));
  assert.equal(ping.status, 200, ping.status !== 200 ? await ping.text() : undefined);
  assert.deepEqual(await ping.json(), { type: 1 });
  const bad = signedBody({ type: 1 });
  bad.headers["x-signature-ed25519"] = "0".repeat(128);
  assert.equal((await worker.dispatchFetch("https://bot.test/interactions", bad)).status, 401);
});

test("Japanese text and title render into the PNG", { timeout: 30_000 }, async () => {
  const pixels = await raw(await generate("text", {}));
  assert.ok(darkPixels(pixels, 200, 140, 450, 360) > 3000, "Balloon text is missing");
  assert.ok(darkPixels(pixels, 100, 760, 1400, 100) > 3000, "Title is missing");
});

test("literal and actual newlines have identical output", { timeout: 30_000 }, async () => {
  const a = await generate("literal-newlines", { content: "唐揚げ\\nハンバーグ\\nエビフライ" });
  const b = await generate("actual-newlines", { content: "唐揚げ\nハンバーグ\nエビフライ" });
  assert.deepEqual(a, b);
});

for (const fixture of ["landscape", "portrait", "jpeg", "gif"]) {
  test(`${fixture} attachment is rendered with correct colour`, { timeout: 30_000 }, async () => {
    const pixels = await raw(await generate(`image-${fixture}`, { type: "image", fixture }));
    const offset = (300 * 1600 + 425) * 3;
    assert.ok(Math.abs(pixels[offset] - 25) < 10 && Math.abs(pixels[offset + 1] - 184) < 10 && Math.abs(pixels[offset + 2] - 120) < 10,
      `Image center has unexpected colour: ${pixels.subarray(offset, offset + 3)}`);
  });
}

test("image and Japanese text render together", { timeout: 30_000 }, async () => {
  const pixels = await raw(await generate("text-image", { type: "text_image", fixture: "landscape", content: "好きなものを\\n発表します" }));
  const offset = (250 * 1600 + 425) * 3;
  assert.ok(pixels[offset + 1] > 150 && pixels[offset] < 50, "Image is missing");
  assert.ok(darkPixels(pixels, 200, 365, 450, 110) > 2000, "Text is missing");
  assert.equal(darkPixels(pixels, 250, 480, 350, 10), 0, "Text touches the balloon border");
});

test("long text and XML special characters render", { timeout: 30_000 }, async () => {
  const pixels = await raw(await generate("long-text", { title: "長いタイトルの縮小を確認します".repeat(10), content: "日本語とEnglishが混ざった長いテキスト".repeat(10) + "\\n<&>\"'" }));
  assert.ok(darkPixels(pixels, 1400, 755, 120, 100) > 20, "End of long title was truncated");
});

test("XML special characters remain visible", { timeout: 30_000 }, async () => {
  const pixels = await raw(await generate("special-characters", { title: "記号 <&> も表示", content: "A < B & C > D\\n引用 \" ' 日本語" }));
  assert.ok(darkPixels(pixels, 200, 150, 450, 320) > 1000);
});

test("40 lines render without failure", { timeout: 30_000 }, async () => {
  const pixels = await raw(await generate("forty-lines", { content: Array.from({ length: 40 }, (_, index) => `${index + 1}行目：好きな惣菜`).join("\\n") }));
  assert.equal(darkPixels(pixels, 250, 515, 350, 100), 0, "Text overflows below the balloon");
});

test("concurrent requests keep rendering state separate", { timeout: 30_000 }, async () => {
  const images = await Promise.all([generate("concurrent-text", { content: "同時生成その一" }), generate("concurrent-image", { type: "image", fixture: "landscape" })]);
  assert.notDeepEqual(images[0], images[1]);
});

test("missing attachment receives an immediate error", async () => {
  const response = await worker.dispatchFetch("https://bot.test/interactions", signedBody(command({ type: "image" })));
  const body = await response.json();
  assert.equal(body.type, 4);
  assert.match(body.data.content, /画像/);
});

test("failed attachment download updates the deferred reply with an error", { timeout: 30_000 }, async () => {
  const interaction = command({ type: "image", fixture: "missing" });
  const deferred = Promise.withResolvers();
  pending.set(interaction.token, deferred);
  try {
    const response = await worker.dispatchFetch("https://bot.test/interactions", signedBody(interaction));
    assert.deepEqual(await response.json(), { type: 5 });
    const reply = await deferred.promise;
    assert.equal(reply.file, null);
    assert.match(reply.payload.content, /失敗/);
  } finally {
    pending.delete(interaction.token);
  }
});
