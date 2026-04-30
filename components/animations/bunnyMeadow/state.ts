import type { Bunny, Butterfly, Cloud } from "./bunnyTypes";
import { getRandomSidePosition } from "./scene";

const startBunnyHop = (bunny: Bunny, width: number) => {
  bunny.targetX = getRandomSidePosition(width);
  bunny.direction = bunny.targetX > bunny.x ? 1 : -1;
};

const returnBunnyToSitting = (
  bunny: Bunny,
  timerStart: number,
  timerRange: number,
) => {
  bunny.state = "sitting";
  bunny.stateTimer = timerStart + Math.random() * timerRange;
  bunny.hopHeight = 0;
};

const updateBunnyBlink = (bunny: Bunny) => {
  bunny.blinkTimer--;
  if (bunny.blinkTimer > 0) return;

  bunny.isBlinking = !bunny.isBlinking;
  bunny.blinkTimer = bunny.isBlinking ? 10 : 120 + Math.random() * 180;
};

const chooseNextSittingState = (bunny: Bunny, width: number) => {
  const states: Bunny["state"][] = ["hopping", "eating", "alert", "sitting"];
  bunny.state = states[Math.floor(Math.random() * states.length)];
  bunny.stateTimer = 80 + Math.random() * 150;

  if (bunny.state === "hopping") startBunnyHop(bunny, width);
};

const updateSittingBunny = (bunny: Bunny, width: number) => {
  bunny.hopHeight = 0;
  if (bunny.stateTimer > 0) return;

  chooseNextSittingState(bunny, width);
};

const updateHoppingBunny = (bunny: Bunny) => {
  bunny.hopPhase += 0.15;
  bunny.hopHeight = Math.abs(Math.sin(bunny.hopPhase)) * 30;

  if (Math.sin(bunny.hopPhase) > 0.5) {
    bunny.x += bunny.direction * 2;
    bunny.tailWiggle += 0.3;
  }

  if (Math.abs(bunny.x - bunny.targetX) < 20 || bunny.stateTimer <= 0) {
    returnBunnyToSitting(bunny, 100, 200);
  }
};

const updateEatingBunny = (bunny: Bunny) => {
  bunny.noseWiggle += 0.1;
  if (bunny.stateTimer > 0) return;

  returnBunnyToSitting(bunny, 80, 150);
};

const chooseNextAlertState = (bunny: Bunny, width: number) => {
  bunny.state = "sitting";
  if (Math.random() < 0.5) bunny.state = "hopping";

  bunny.stateTimer = 100 + Math.random() * 150;
  if (bunny.state === "hopping") startBunnyHop(bunny, width);
};

const updateAlertBunny = (bunny: Bunny, width: number) => {
  bunny.earPhase += 0.05;
  if (bunny.stateTimer > 0) return;

  chooseNextAlertState(bunny, width);
};

const updateBunnyState = (bunny: Bunny, width: number) => {
  switch (bunny.state) {
    case "sitting":
      updateSittingBunny(bunny, width);
      break;
    case "hopping":
      updateHoppingBunny(bunny);
      break;
    case "eating":
      updateEatingBunny(bunny);
      break;
    case "alert":
      updateAlertBunny(bunny, width);
      break;
  }
};

export const updateBunny = (bunny: Bunny, width: number) => {
  bunny.stateTimer--;
  bunny.noseWiggle += 0.1;
  updateBunnyBlink(bunny);
  updateBunnyState(bunny, width);
};

export const updateButterfly = (
  butterfly: Butterfly,
  width: number,
  height: number,
  time: number,
) => {
  const dx = butterfly.targetX - butterfly.x;
  const dy = butterfly.targetY - butterfly.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 15) {
    butterfly.targetX = Math.random() * width;
    butterfly.targetY = height * 0.2 + Math.random() * height * 0.4;
  } else {
    butterfly.x += (dx / dist) * 1.2;
    butterfly.y += (dy / dist) * 1.2 + Math.sin(time * 0.05) * 0.5;
  }
};

export const updateCloud = (cloud: Cloud, width: number) => {
  cloud.x += cloud.speed;
  if (cloud.x > width + 100) {
    cloud.x = -100;
  }
};
