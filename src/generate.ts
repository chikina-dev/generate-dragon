import {
  ApplicationCommandOptionType,
  type APIChatInputApplicationCommandInteractionData,
  type APIApplicationCommandInteraction,
} from "discord-api-types/v10";
import { generateDragon, MAX_IMAGE_BYTES, type DragonInput, type ImageInput } from "./lib/generate/image";
import { editReply } from "./lib/send";

const imageTypes = new Set(["image/png", "image/jpeg", "image/gif"]);

export function readDragonInput(data: APIChatInputApplicationCommandInteractionData): DragonInput | string {
  const options = data.options ?? [];
  const getString = (name: string) => {
    const option = options.find((option) => option.name === name);
    return option?.type === ApplicationCommandOptionType.String ? option.value : undefined;
  };
  const subtitle = getString("title");
  const type = getString("type");
  const content = getString("content");
  if (!subtitle?.trim() || !type) return "タイトルとタイプを入力してください。";
  if (subtitle.length > 200) return "タイトルは200文字以内にしてください。";
  if (type !== "text" && type !== "image" && type !== "text_image") return "タイプが不正です。";
  if (type !== "image" && !content?.trim()) return "内容を入力してください。";
  if (content && (content.length > 1000 || content.split(/\\n|\r?\n/).length > 40)) {
    return "内容は1000文字・40行以内にしてください。";
  }
  let image: ImageInput | undefined;
  if (type !== "text") {
    const option = options.find((option) => option.name === "image");
    const attachment = option?.type === ApplicationCommandOptionType.Attachment
      ? data.resolved?.attachments?.[option.value]
      : undefined;
    if (!attachment) return "画像を入力してください。";
    if (!attachment.content_type || !imageTypes.has(attachment.content_type)) {
      return "PNG・JPEG・GIF画像を指定してください。";
    }
    if (attachment.size > MAX_IMAGE_BYTES) return "画像は8MB以内にしてください。";
    const { width, height } = attachment;
    if (!width || !height || width > 4096 || height > 4096 || width * height > 8_000_000) {
      return "画像は各辺4096px・合計800万画素以内にしてください。";
    }
    const url = new URL(attachment.url);
    if (url.protocol !== "https:" || !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname)) {
      return "Discordに添付した画像を指定してください。";
    }
    image = { url: url.href, width, height, contentType: attachment.content_type };
  }
  return { subtitle, type, content: content ?? "", image };
}

export async function completeGeneration(
  interaction: APIApplicationCommandInteraction,
  input: DragonInput,
  env: Env,
): Promise<void> {
  try {
    const png = await generateDragon(input, env.ASSETS);
    if (png.byteLength > interaction.attachment_size_limit) {
      throw new Error("生成した画像がDiscordの添付サイズ上限を超えました。");
    }
    await editReply(interaction.application_id, interaction.token, { png });
    console.log({ event: "dragon.generated", interactionId: interaction.id, type: input.type });
  } catch (error) {
    console.error({ event: "dragon.failed", interactionId: interaction.id, message: error instanceof Error ? error.message : "Unknown error" });
    try {
      await editReply(interaction.application_id, interaction.token, { error: "画像の生成・送信に失敗しました。画像やテキストを確認して、もう一度お試しください。" });
    } catch {
      console.error({ event: "dragon.error_reply_failed", interactionId: interaction.id });
    }
  }
}
