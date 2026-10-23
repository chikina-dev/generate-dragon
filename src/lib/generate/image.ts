import { Canvas, createCanvas, Image, PNGStream } from "canvas";
import { CanvasRenderingContext2D } from "canvas";

type TextDragonType = {
	subtitle: string;
	content: string;
	balloonImage: Image;
	dragonImage: Image;
}

type ImageDragonType = {
	subtitle: string;
	content: Image;
	balloonImage: Image;
	dragonImage: Image;
}

type ImageTextDragonType = {
	subtitle: string;
	content: string;
	contentImg: Image;
	balloonImage: Image;
	dragonImage: Image;
}

type DragonBaseType = {
	canvas: Canvas;
	context: CanvasRenderingContext2D;
	subtitle: string;
	balloonImage: Image;
	dragonImage: Image;
}

const fontSize = 90;
const fontStyle = '"GenJyuuGothic-Normal", sans-serif'

function adjustText(context: CanvasRenderingContext2D, text: string, width: number, height: number, followWidth?: number) {
	const TextWidth = context.measureText(text).width;
	if (TextWidth > width * 0.9) {
		context.font = `${(width * 0.9 / TextWidth) * fontSize}px ${fontStyle}`;
	}
	context.fillText(text, (followWidth ?? 0) + (width - context.measureText(text).width) / 2, height);
	context.font = `${fontSize}px ${fontStyle}`;
}

function adjustTexts(context: CanvasRenderingContext2D, texts: string[], width: number, height: number, followWidth?: number, optionFontSize?: number) {
	const targetFontSize = optionFontSize ?? fontSize;
	const maxLineWidth = Math.max(...texts.map(text => context.measureText(text).width));
	const formatTextSize = () => {
		let size = targetFontSize;
		if (maxLineWidth > width * 0.9) {
			size = (width * 0.9 / maxLineWidth) * targetFontSize;
		}
		if (texts.length * size > 400) {
			size = 400 / texts.length * 0.9;
		}
		return size;
	}
	const formatSize = formatTextSize();
	context.font = `${formatSize}px ${fontStyle}`;
	for (let i = 0; i < texts.length; i++) {
		context.fillText(texts[i], (followWidth ?? 0) + (width - context.measureText(texts[i]).width) / 2, (height - formatSize * texts.length / 2) + i * formatSize);
	}
	context.font = `${targetFontSize}px ${fontStyle}`;
}


function generateDragonBase({ canvas, context, subtitle, balloonImage, dragonImage }: DragonBaseType) {
	context.fillStyle = 'rgb( 255, 255, 255)';
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.drawImage(balloonImage, 0, 0, canvas.width, canvas.height);
	context.drawImage(dragonImage, 0, 0, canvas.width, canvas.height);
	context.font = `${fontSize}px ${fontStyle}`;
	context.fillStyle = 'black';
	adjustText(context, subtitle, canvas.width, 844);
}

function GenerateDragonText({ subtitle, content, balloonImage, dragonImage }: TextDragonType): PNGStream {
	const canvas = createCanvas(balloonImage.width, balloonImage.height);
	const context = canvas.getContext('2d');
	generateDragonBase({ canvas, context, subtitle, balloonImage, dragonImage });
	adjustTexts(context, content.split('\\n'), 500, 360, 175);
	return canvas.createPNGStream();
}

function GenerateDragonImage({ subtitle, content, balloonImage, dragonImage }: ImageDragonType): PNGStream {
	const canvas = createCanvas(balloonImage.width, balloonImage.height);
	const context = canvas.getContext('2d');
	generateDragonBase({ canvas, context, subtitle, balloonImage, dragonImage });
	const [width, height] = calcContentSize(content.width, content.height, dragonImage.height / 3);
	context.drawImage(content, 425 - width / 2, 300 - height / 2, width, height);
	return canvas.createPNGStream();
}

function GenerateDragonImageAndText({ subtitle, content, contentImg, balloonImage, dragonImage }: ImageTextDragonType): PNGStream {
	const canvas = createCanvas(balloonImage.width, balloonImage.height);
	const context = canvas.getContext('2d');
	generateDragonBase({ canvas, context, subtitle, balloonImage, dragonImage });
	const [width, height] = calcContentSize(contentImg.width, contentImg.height, dragonImage.height / 4);
	context.drawImage(contentImg, 425 - width / 2, 250 - height / 2, width, height);
	context.font = `${fontSize - 15}px ${fontStyle}`;
	adjustTexts(context, content.split('\\n'), 500, 500, 175, fontSize - 15);
	return canvas.createPNGStream();
}

function calcContentSize(width: number, height: number, size: number): [number, number] {
	const ratio = width / height;
	if (ratio > 1) {
		return [size * ratio, size];
	} else {
		return [size, size / ratio];
	}
}

export { GenerateDragonText, GenerateDragonImage, GenerateDragonImageAndText }
