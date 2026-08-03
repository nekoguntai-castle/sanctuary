import { DARK_BUNNY_PALETTES, LIGHT_BUNNY_PALETTES } from "./bunnyTypes";
import type { Bunny, BunnyPalette } from "./bunnyTypes";

const fillEllipse = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation = 0,
) => {
  ctx.beginPath();
  ctx.ellipse(x, y, radiusX, radiusY, rotation, 0, Math.PI * 2);
  ctx.fill();
};

const fillCircle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) => {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
};

const getBunnyPalette = (
  color: Bunny["color"],
  darkMode: boolean,
): BunnyPalette => {
  const palettes = darkMode ? DARK_BUNNY_PALETTES : LIGHT_BUNNY_PALETTES;
  return palettes[color];
};

const drawBunnyShadow = (
  ctx: CanvasRenderingContext2D,
  size: number,
  hopOffset: number,
) => {
  ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
  fillEllipse(ctx, 0, hopOffset + size * 0.5, size * 0.5, size * 0.15);
};

const drawBunnyBackLeg = (
  ctx: CanvasRenderingContext2D,
  size: number,
  bunny: Bunny,
  shadowColor: string,
) => {
  if (bunny.state !== "hopping") return;

  ctx.fillStyle = shadowColor;
  fillEllipse(ctx, -size * 0.15, size * 0.35, size * 0.2, size * 0.12, -0.5);
};

const drawBunnyTail = (
  ctx: CanvasRenderingContext2D,
  size: number,
  bunny: Bunny,
  palette: BunnyPalette,
) => {
  const tailWiggle = Math.sin(bunny.tailWiggle) * 3;

  ctx.fillStyle = palette.highlightColor;
  fillCircle(ctx, -size * 0.35 + tailWiggle, size * 0.1, size * 0.15);

  ctx.fillStyle = palette.mainColor;
  fillCircle(ctx, -size * 0.32 + tailWiggle, size * 0.08, size * 0.1);
};

const drawBunnyBody = (
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: BunnyPalette,
) => {
  const bodyGradient = ctx.createRadialGradient(
    size * 0.1,
    -size * 0.1,
    0,
    0,
    0,
    size * 0.5,
  );
  bodyGradient.addColorStop(0, palette.highlightColor);
  bodyGradient.addColorStop(0.7, palette.mainColor);
  bodyGradient.addColorStop(1, palette.shadowColor);

  ctx.fillStyle = bodyGradient;
  fillEllipse(ctx, 0, size * 0.1, size * 0.4, size * 0.35);
};

const drawBunnySpots = (
  ctx: CanvasRenderingContext2D,
  size: number,
  darkMode: boolean,
) => {
  ctx.fillStyle = darkMode ? "#4a3a2a" : "#8B6914";
  fillEllipse(ctx, -size * 0.15, size * 0.05, size * 0.1, size * 0.08, 0.3);
  fillEllipse(ctx, size * 0.1, size * 0.2, size * 0.08, size * 0.06, -0.2);
};

const drawBunnyPawsUp = (ctx: CanvasRenderingContext2D, size: number) => {
  fillEllipse(ctx, size * 0.25, -size * 0.15, size * 0.08, size * 0.12, 0.3);
  fillEllipse(ctx, size * 0.35, -size * 0.1, size * 0.08, size * 0.12, 0.5);
};

const drawBunnyFrontPaws = (
  ctx: CanvasRenderingContext2D,
  size: number,
  bunny: Bunny,
  mainColor: string,
) => {
  ctx.fillStyle = mainColor;

  if (bunny.state === "eating") {
    drawBunnyPawsUp(ctx, size);
    return;
  }

  fillEllipse(ctx, size * 0.2, size * 0.35, size * 0.1, size * 0.06);
};

const drawBunnyHead = (
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: BunnyPalette,
) => {
  const headGradient = ctx.createRadialGradient(
    size * 0.35,
    -size * 0.35,
    0,
    size * 0.3,
    -size * 0.25,
    size * 0.35,
  );
  headGradient.addColorStop(0, palette.highlightColor);
  headGradient.addColorStop(0.6, palette.mainColor);
  headGradient.addColorStop(1, palette.shadowColor);

  ctx.fillStyle = headGradient;
  fillCircle(ctx, size * 0.3, -size * 0.2, size * 0.28);

  ctx.fillStyle = "rgba(255, 182, 193, 0.3)";
  fillEllipse(ctx, size * 0.45, -size * 0.1, size * 0.1, size * 0.08);
};

const drawBunnyEar = (
  ctx: CanvasRenderingContext2D,
  size: number,
  x: number,
  y: number,
  rotation: number,
  mainColor: string,
  darkMode: boolean,
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  ctx.fillStyle = mainColor;
  fillEllipse(ctx, 0, -size * 0.35, size * 0.12, size * 0.35);

  ctx.fillStyle = darkMode ? "#8a6a5a" : "#FFB6C1";
  fillEllipse(ctx, 0, -size * 0.3, size * 0.06, size * 0.25);

  ctx.restore();
};

const drawBunnyEars = (
  ctx: CanvasRenderingContext2D,
  size: number,
  bunny: Bunny,
  earWave: number,
  mainColor: string,
  darkMode: boolean,
) => {
  const earAngle = bunny.state === "alert" ? -0.2 : 0.1;

  drawBunnyEar(
    ctx,
    size,
    size * 0.2,
    -size * 0.4,
    earAngle + earWave * 0.02,
    mainColor,
    darkMode,
  );
  drawBunnyEar(
    ctx,
    size,
    size * 0.35,
    -size * 0.42,
    earAngle - 0.15 - earWave * 0.01,
    mainColor,
    darkMode,
  );
};

const drawBunnySnout = (
  ctx: CanvasRenderingContext2D,
  size: number,
  highlightColor: string,
  noseWiggle: number,
  darkMode: boolean,
) => {
  ctx.fillStyle = highlightColor;
  fillEllipse(ctx, size * 0.48, -size * 0.12, size * 0.12, size * 0.1);

  ctx.fillStyle = darkMode ? "#8a5a4a" : "#FFB6C1";
  fillEllipse(
    ctx,
    size * 0.55 + noseWiggle * 0.3,
    -size * 0.18,
    size * 0.05,
    size * 0.04,
  );
};

const drawBunnyMouth = (
  ctx: CanvasRenderingContext2D,
  size: number,
  darkMode: boolean,
) => {
  ctx.strokeStyle = darkMode ? "#5a4a4a" : "#8B6969";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size * 0.55, -size * 0.14);
  ctx.lineTo(size * 0.55, -size * 0.08);
  ctx.moveTo(size * 0.52, -size * 0.05);
  ctx.lineTo(size * 0.55, -size * 0.08);
  ctx.lineTo(size * 0.58, -size * 0.05);
  ctx.stroke();
};

const drawBunnyOpenEye = (ctx: CanvasRenderingContext2D, size: number) => {
  ctx.fillStyle = "#FFFFFF";
  fillEllipse(ctx, size * 0.38, -size * 0.28, size * 0.08, size * 0.1);

  ctx.fillStyle = "#000000";
  fillCircle(ctx, size * 0.4, -size * 0.27, size * 0.045);

  ctx.fillStyle = "#FFFFFF";
  fillCircle(ctx, size * 0.42, -size * 0.29, size * 0.015);
};

const drawBunnyClosedEye = (ctx: CanvasRenderingContext2D, size: number) => {
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(size * 0.38, -size * 0.27, size * 0.05, 0.3, Math.PI - 0.3);
  ctx.stroke();
};

const drawBunnyEyes = (
  ctx: CanvasRenderingContext2D,
  size: number,
  isBlinking: boolean,
) => {
  if (isBlinking) {
    drawBunnyClosedEye(ctx, size);
    return;
  }

  drawBunnyOpenEye(ctx, size);
};

const drawBunnyFace = (
  ctx: CanvasRenderingContext2D,
  size: number,
  bunny: Bunny,
  palette: BunnyPalette,
  noseWiggle: number,
  darkMode: boolean,
) => {
  drawBunnySnout(ctx, size, palette.highlightColor, noseWiggle, darkMode);
  drawBunnyMouth(ctx, size, darkMode);
  drawBunnyEyes(ctx, size, bunny.isBlinking);
};

export const drawBunny = (
  ctx: CanvasRenderingContext2D,
  bunny: Bunny,
  time: number,
  darkMode: boolean,
) => {
  const size = bunny.size;
  const palette = getBunnyPalette(bunny.color, darkMode);
  const earWave = Math.sin(time * 0.02 + bunny.earPhase) * 3;
  const noseWiggle = Math.sin(time * 0.15 + bunny.noseWiggle) * 2;

  ctx.save();
  ctx.translate(bunny.x, bunny.y - bunny.hopHeight);
  ctx.scale(bunny.direction, 1);

  drawBunnyShadow(ctx, size, bunny.hopHeight);
  drawBunnyBackLeg(ctx, size, bunny, palette.shadowColor);
  drawBunnyTail(ctx, size, bunny, palette);
  drawBunnyBody(ctx, size, palette);
  if (bunny.color === "spotted") drawBunnySpots(ctx, size, darkMode);
  drawBunnyFrontPaws(ctx, size, bunny, palette.mainColor);
  drawBunnyHead(ctx, size, palette);
  drawBunnyEars(ctx, size, bunny, earWave, palette.mainColor, darkMode);
  drawBunnyFace(ctx, size, bunny, palette, noseWiggle, darkMode);

  ctx.restore();
};
