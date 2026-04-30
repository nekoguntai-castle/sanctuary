import type { Butterfly, Cloud, Flower, Grass } from "./bunnyTypes";
import type { BunnyMeadowScene } from "./scene";
import { drawBunny } from "./bunnyDrawing";
import { updateBunny, updateButterfly, updateCloud } from "./state";

const drawBackground = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  darkMode: boolean,
) => {
  const skyGradient = ctx.createLinearGradient(0, 0, 0, height * 0.5);
  if (darkMode) {
    skyGradient.addColorStop(0, "#0a1a2a");
    skyGradient.addColorStop(1, "#1a3a4a");
  } else {
    skyGradient.addColorStop(0, "#87CEEB");
    skyGradient.addColorStop(1, "#E0F6FF");
  }
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, width, height);

  const meadowGradient = ctx.createLinearGradient(0, height * 0.4, 0, height);
  if (darkMode) {
    meadowGradient.addColorStop(0, "#1a3a2a");
    meadowGradient.addColorStop(0.5, "#2a4a3a");
    meadowGradient.addColorStop(1, "#1a3020");
  } else {
    meadowGradient.addColorStop(0, "#90EE90");
    meadowGradient.addColorStop(0.3, "#7CCD7C");
    meadowGradient.addColorStop(1, "#228B22");
  }
  ctx.fillStyle = meadowGradient;
  ctx.fillRect(0, height * 0.4, width, height * 0.6);

  ctx.fillStyle = darkMode ? "#2a4a3a" : "#8FBC8F";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(0, height * 0.5 + i * 30);
    for (let x = 0; x <= width; x += 50) {
      const hillY = height * 0.5 + i * 30 + Math.sin(x * 0.005 + i) * 20;
      ctx.lineTo(x, hillY);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
  }
};

const drawCloud = (
  ctx: CanvasRenderingContext2D,
  cloud: Cloud,
  darkMode: boolean,
) => {
  ctx.save();
  ctx.translate(cloud.x, cloud.y);

  ctx.fillStyle = darkMode
    ? "rgba(60, 80, 100, 0.5)"
    : "rgba(255, 255, 255, 0.9)";
  cloud.puffs.forEach((puff) => {
    ctx.beginPath();
    ctx.arc(puff.x, puff.y, puff.size, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
};

const drawGrass = (
  ctx: CanvasRenderingContext2D,
  grass: Grass,
  time: number,
  darkMode: boolean,
) => {
  const sway = Math.sin(time * 0.002 + grass.swayPhase) * 3;

  ctx.save();
  ctx.translate(grass.x, grass.y);

  for (let i = 0; i < grass.blades; i++) {
    const bladeX = (i - grass.blades / 2) * 4;
    const bladeHeight = grass.height * (0.7 + Math.random() * 0.3);
    const bladeSway = sway * (0.8 + i * 0.1);

    ctx.strokeStyle = darkMode ? "#3a5a3a" : "#228B22";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bladeX, 0);
    ctx.quadraticCurveTo(
      bladeX + bladeSway * 0.5,
      -bladeHeight * 0.5,
      bladeX + bladeSway,
      -bladeHeight,
    );
    ctx.stroke();
  }

  ctx.restore();
};

const drawFlower = (
  ctx: CanvasRenderingContext2D,
  flower: Flower,
  time: number,
  darkMode: boolean,
) => {
  const sway = Math.sin(time * 0.002 + flower.swayPhase) * 2;

  ctx.save();
  ctx.translate(flower.x + sway, flower.y);

  ctx.strokeStyle = darkMode ? "#2a4a2a" : "#228B22";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(sway * 0.5, -flower.size, sway, -flower.size * 2);
  ctx.stroke();

  ctx.save();
  ctx.translate(sway, -flower.size * 2);

  for (let i = 0; i < flower.petalCount; i++) {
    const angle = (i / flower.petalCount) * Math.PI * 2;
    ctx.save();
    ctx.rotate(angle);

    const petalGradient = ctx.createRadialGradient(
      flower.size * 0.4,
      0,
      0,
      flower.size * 0.4,
      0,
      flower.size * 0.5,
    );
    petalGradient.addColorStop(0, "#FFFFFF");
    petalGradient.addColorStop(0.5, flower.color);
    petalGradient.addColorStop(1, flower.color);

    ctx.fillStyle = petalGradient;
    ctx.beginPath();
    ctx.ellipse(
      flower.size * 0.4,
      0,
      flower.size * 0.4,
      flower.size * 0.2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = "#FFD700";
  ctx.beginPath();
  ctx.arc(0, 0, flower.size * 0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  ctx.restore();
};

const drawButterfly = (
  ctx: CanvasRenderingContext2D,
  butterfly: Butterfly,
  time: number,
) => {
  const wingAngle = Math.sin(time * 0.1 + butterfly.wingPhase) * 0.5;

  ctx.save();
  ctx.translate(butterfly.x, butterfly.y);

  const dx = butterfly.targetX - butterfly.x;
  ctx.scale(dx > 0 ? 1 : -1, 1);

  ctx.fillStyle = butterfly.color;
  ctx.globalAlpha = 0.7;

  ctx.save();
  ctx.rotate(wingAngle);
  ctx.beginPath();
  ctx.ellipse(
    -butterfly.size * 0.3,
    -butterfly.size * 0.5,
    butterfly.size * 0.4,
    butterfly.size * 0.5,
    -0.3,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.rotate(-wingAngle);
  ctx.beginPath();
  ctx.ellipse(
    -butterfly.size * 0.3,
    butterfly.size * 0.5,
    butterfly.size * 0.4,
    butterfly.size * 0.5,
    0.3,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.globalAlpha = 1;

  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.ellipse(
    0,
    0,
    butterfly.size * 0.08,
    butterfly.size * 0.25,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.restore();
};

export const drawBunnyMeadowFrame = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  scene: BunnyMeadowScene,
  time: number,
  darkMode: boolean,
) => {
  const { width, height } = canvas;

  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, width, height, darkMode);

  scene.clouds.forEach((cloud) => {
    updateCloud(cloud, width);
    drawCloud(ctx, cloud, darkMode);
  });

  scene.grassPatches.forEach((grass) => drawGrass(ctx, grass, time, darkMode));
  scene.flowers.forEach((flower) => drawFlower(ctx, flower, time, darkMode));
  scene.butterflies.forEach((butterfly) => {
    updateButterfly(butterfly, width, height, time);
    drawButterfly(ctx, butterfly, time);
  });
  scene.bunnies.forEach((bunny) => {
    updateBunny(bunny, width);
    drawBunny(ctx, bunny, time, darkMode);
  });
};
