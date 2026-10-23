import { ApplicationCommandOptionType, type RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10";

export const dragonCommand = {
  name: "generate_dragon",
  description: "発表ドラゴンジェネレーターの画像です.",
  options: [
    {
      type: ApplicationCommandOptionType.String,
      name: "title",
      description: "下部のタイトル",
      required: true,
      max_length: 200,
    },
    {
      type: ApplicationCommandOptionType.String,
      name: "type",
      description: "contentのタイプ",
      required: true,
      choices: [
        { name: "テキスト", value: "text" },
        { name: "画像", value: "image" },
        { name: "テキスト＋画像", value: "text_image" },
      ],
    },
    {
      type: ApplicationCommandOptionType.String,
      name: "content",
      description: "吹き出しのテキスト（\\nで改行）",
      max_length: 1000,
    },
    {
      type: ApplicationCommandOptionType.Attachment,
      name: "image",
      description: "吹き出し内の画像（PNG・JPEG・GIF）",
    },
  ],
} satisfies RESTPostAPIApplicationCommandsJSONBody;
