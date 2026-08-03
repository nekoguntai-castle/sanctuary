/**
 * Japanese Train Station Animation
 * Trains arriving and departing with passengers moving on platforms
 */

import { useRef, useEffect } from 'react';

interface Train {
  x: number;
  y: number;
  length: number;
  height: number;
  speed: number;
  targetSpeed: number;
  direction: number; // 1 = right, -1 = left
  state: 'arriving' | 'stopped' | 'departing' | 'passing';
  stateTimer: number;
  colorScheme: number;
  opacity: number;
  carriages: number;
}

interface Passenger {
  x: number;
  y: number;
  targetX: number;
  size: number;
  speed: number;
  walkPhase: number;
  direction: number;
  colorScheme: number;
  opacity: number;
  state: 'waiting' | 'boarding' | 'exiting' | 'walking';
  hasUmbrella: boolean;
  hasBag: boolean;
}

interface Platform {
  y: number;
  width: number;
}

interface TrainColorScheme {
  body: number[];
  stripe: number[];
  window: number[];
}

interface PassengerColorScheme {
  body: number[];
  skin: number[];
}

interface TrainStationScene {
  platforms: Platform[];
  passengers: Passenger[];
  trains: Train[];
}

const DARK_TRAIN_COLORS: TrainColorScheme[] = [
  { body: [220, 220, 225], stripe: [200, 60, 60], window: [80, 120, 160] }, // white with red stripe
  { body: [60, 120, 60], stripe: [240, 200, 80], window: [80, 120, 160] }, // green with yellow
  { body: [60, 80, 140], stripe: [200, 200, 200], window: [80, 120, 160] }, // blue
  { body: [180, 100, 60], stripe: [240, 180, 80], window: [80, 120, 160] }, // orange (JR)
];

const LIGHT_TRAIN_COLORS: TrainColorScheme[] = [
  { body: [200, 200, 205], stripe: [180, 40, 40], window: [60, 100, 140] },
  { body: [40, 100, 40], stripe: [220, 180, 60], window: [60, 100, 140] },
  { body: [40, 60, 120], stripe: [180, 180, 180], window: [60, 100, 140] },
  { body: [160, 80, 40], stripe: [220, 160, 60], window: [60, 100, 140] },
];

const DARK_PASSENGER_COLORS: PassengerColorScheme[] = [
  { body: [80, 80, 90], skin: [220, 190, 170] },
  { body: [60, 60, 80], skin: [210, 180, 160] },
  { body: [100, 70, 70], skin: [225, 195, 175] },
  { body: [70, 90, 70], skin: [215, 185, 165] },
  { body: [90, 80, 100], skin: [220, 190, 170] },
];

const LIGHT_PASSENGER_COLORS: PassengerColorScheme[] = [
  { body: [60, 60, 70], skin: [200, 170, 150] },
  { body: [40, 40, 60], skin: [190, 160, 140] },
  { body: [80, 50, 50], skin: [205, 175, 155] },
  { body: [50, 70, 50], skin: [195, 165, 145] },
  { body: [70, 60, 80], skin: [200, 170, 150] },
];

const DOOR_POSITIONS = [0.25, 0.75];
const WHEEL_POSITIONS = [0.2, 0.8];

const getTrainColors = (darkMode: boolean) =>
  darkMode ? DARK_TRAIN_COLORS : LIGHT_TRAIN_COLORS;

const getPassengerColors = (darkMode: boolean) =>
  darkMode ? DARK_PASSENGER_COLORS : LIGHT_PASSENGER_COLORS;

const createTrain = (
  canvas: HTMLCanvasElement,
  forcePlatform?: number,
): Train => {
  const direction = Math.random() < 0.5 ? 1 : -1;
  const platformIndex =
    forcePlatform !== undefined ? forcePlatform : Math.floor(Math.random() * 2);

  return {
    x: direction > 0 ? -400 : canvas.width + 400,
    y: canvas.height * (0.4 + platformIndex * 0.25),
    length: 280 + Math.random() * 100,
    height: 40 + Math.random() * 15,
    speed: 0,
    targetSpeed: 3 + Math.random() * 2,
    direction,
    state: 'arriving',
    stateTimer: 0,
    colorScheme: Math.floor(Math.random() * 4),
    opacity: 0.15 + Math.random() * 0.1,
    carriages: 2 + Math.floor(Math.random() * 2),
  };
};

const createPlatforms = (canvas: HTMLCanvasElement): Platform[] => [
  { y: canvas.height * 0.4, width: canvas.width },
  { y: canvas.height * 0.65, width: canvas.width },
];

const createInitialPassengers = (
  canvas: HTMLCanvasElement,
  platforms: Platform[],
): Passenger[] => {
  const passengerCount = Math.floor(canvas.width / 80) + 5;
  const passengers: Passenger[] = [];

  platforms.forEach((platform) => {
    for (let i = 0; i < passengerCount / 2; i++) {
      passengers.push(createPassenger(canvas, platform.y));
    }
  });

  return passengers;
};

const createTrainStationScene = (
  canvas: HTMLCanvasElement,
): TrainStationScene => {
  const platforms = createPlatforms(canvas);

  return {
    platforms,
    passengers: createInitialPassengers(canvas, platforms),
    trains: [createTrain(canvas, 0), createTrain(canvas, 1)],
  };
};

const drawPlatform = (
  ctx: CanvasRenderingContext2D,
  platform: Platform,
  opacityMult: number,
  darkMode: boolean,
) => {
  const platformColor = darkMode ? [80, 75, 70] : [60, 55, 50];
  const lineColor = darkMode ? [200, 180, 60] : [180, 160, 40];
  const edgeColor = darkMode ? [100, 95, 90] : [80, 75, 70];

  // Platform surface
  ctx.fillStyle = `rgba(${platformColor[0]}, ${platformColor[1]}, ${platformColor[2]}, ${
    0.08 * opacityMult
  })`;
  ctx.fillRect(0, platform.y, platform.width, 25);

  // Yellow safety line
  ctx.fillStyle = `rgba(${lineColor[0]}, ${lineColor[1]}, ${lineColor[2]}, ${
    0.12 * opacityMult
  })`;
  ctx.fillRect(0, platform.y, platform.width, 3);

  // Platform edge
  ctx.fillStyle = `rgba(${edgeColor[0]}, ${edgeColor[1]}, ${edgeColor[2]}, ${
    0.1 * opacityMult
  })`;
  ctx.fillRect(0, platform.y - 5, platform.width, 5);
};

const drawTrainWindows = (
  ctx: CanvasRenderingContext2D,
  train: Train,
  colors: TrainColorScheme,
  carriageX: number,
  carriageLength: number,
  opacityMult: number,
) => {
  const windowCount = 5;
  const windowWidth = (carriageLength - 30) / windowCount;

  for (let w = 0; w < windowCount; w++) {
    ctx.beginPath();
    ctx.roundRect(
      carriageX + 15 + w * windowWidth,
      -train.height * 0.85,
      windowWidth * 0.7,
      train.height * 0.35,
      2,
    );
    ctx.fillStyle = `rgba(${colors.window[0]}, ${colors.window[1]}, ${colors.window[2]}, ${
      train.opacity * opacityMult * 0.6
    })`;
    ctx.fill();
  }
};

const drawTrainDoors = (
  ctx: CanvasRenderingContext2D,
  train: Train,
  colors: TrainColorScheme,
  carriageX: number,
  carriageLength: number,
  opacityMult: number,
) => {
  DOOR_POSITIONS.forEach((pos) => {
    ctx.fillStyle = `rgba(${colors.body[0] - 20}, ${colors.body[1] - 20}, ${
      colors.body[2] - 20
    }, ${train.opacity * opacityMult})`;
    ctx.fillRect(
      carriageX + pos * carriageLength - 8,
      -train.height * 0.9,
      16,
      train.height * 0.85,
    );
  });
};

const drawTrainWheels = (
  ctx: CanvasRenderingContext2D,
  train: Train,
  carriageX: number,
  carriageLength: number,
  opacityMult: number,
) => {
  WHEEL_POSITIONS.forEach((pos) => {
    ctx.beginPath();
    ctx.arc(carriageX + pos * carriageLength, 0, 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(40, 40, 45, ${train.opacity * opacityMult})`;
    ctx.fill();
  });
};

const drawTrainCarriage = (
  ctx: CanvasRenderingContext2D,
  train: Train,
  colors: TrainColorScheme,
  carriageX: number,
  carriageLength: number,
  opacityMult: number,
) => {
  // Main body
  ctx.beginPath();
  ctx.roundRect(carriageX, -train.height, carriageLength, train.height, 4);
  ctx.fillStyle = `rgba(${colors.body[0]}, ${colors.body[1]}, ${colors.body[2]}, ${
    train.opacity * opacityMult
  })`;
  ctx.fill();

  // Stripe
  ctx.fillStyle = `rgba(${colors.stripe[0]}, ${colors.stripe[1]}, ${colors.stripe[2]}, ${
    train.opacity * opacityMult * 0.8
  })`;
  ctx.fillRect(
    carriageX,
    -train.height * 0.4,
    carriageLength,
    train.height * 0.15,
  );

  drawTrainWindows(ctx, train, colors, carriageX, carriageLength, opacityMult);
  drawTrainDoors(ctx, train, colors, carriageX, carriageLength, opacityMult);
  drawTrainWheels(ctx, train, carriageX, carriageLength, opacityMult);
};

const drawTrainNose = (
  ctx: CanvasRenderingContext2D,
  train: Train,
  colors: TrainColorScheme,
  carriageLength: number,
  opacityMult: number,
) => {
  const noseX = train.carriages * (carriageLength + 5);

  // Front/nose
  ctx.beginPath();
  ctx.moveTo(noseX - 5, -train.height);
  ctx.lineTo(noseX + 20, -train.height * 0.3);
  ctx.lineTo(noseX + 20, 0);
  ctx.lineTo(noseX - 5, 0);
  ctx.closePath();
  ctx.fillStyle = `rgba(${colors.body[0]}, ${colors.body[1]}, ${colors.body[2]}, ${
    train.opacity * opacityMult
  })`;
  ctx.fill();

  // Front window
  ctx.beginPath();
  ctx.moveTo(noseX, -train.height * 0.8);
  ctx.lineTo(noseX + 12, -train.height * 0.35);
  ctx.lineTo(noseX + 12, -train.height * 0.15);
  ctx.lineTo(noseX, -train.height * 0.15);
  ctx.closePath();
  ctx.fillStyle = `rgba(${colors.window[0]}, ${colors.window[1]}, ${colors.window[2]}, ${
    train.opacity * opacityMult * 0.6
  })`;
  ctx.fill();

  // Headlight
  ctx.beginPath();
  ctx.arc(noseX + 15, -5, 3, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 240, 200, ${
    train.opacity * opacityMult * (train.state === 'arriving' ? 0.8 : 0.3)
  })`;
  ctx.fill();
};

const drawTrain = (
  ctx: CanvasRenderingContext2D,
  train: Train,
  opacityMult: number,
  trainColors: TrainColorScheme[],
) => {
  const colors = trainColors[train.colorScheme];

  ctx.save();
  ctx.translate(train.x, train.y);
  if (train.direction < 0) ctx.scale(-1, 1);

  const carriageLength = train.length / train.carriages;

  for (let carriage = 0; carriage < train.carriages; carriage++) {
    const carriageX = carriage * (carriageLength + 5);
    drawTrainCarriage(
      ctx,
      train,
      colors,
      carriageX,
      carriageLength,
      opacityMult,
    );
  }

  drawTrainNose(ctx, train, colors, carriageLength, opacityMult);
  ctx.restore();
};

const drawPassengerLegs = (
  ctx: CanvasRenderingContext2D,
  passenger: Passenger,
  colors: PassengerColorScheme,
  legPhase: number,
  opacityMult: number,
) => {
  ctx.beginPath();
  ctx.moveTo(-passenger.size * 0.15, 0);
  ctx.lineTo(-passenger.size * 0.15 + legPhase * 3, passenger.size * 0.5);
  ctx.strokeStyle = `rgba(${colors.body[0]}, ${colors.body[1]}, ${colors.body[2]}, ${
    passenger.opacity * opacityMult
  })`;
  ctx.lineWidth = passenger.size * 0.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(passenger.size * 0.15, 0);
  ctx.lineTo(passenger.size * 0.15 - legPhase * 3, passenger.size * 0.5);
  ctx.stroke();
};

const drawPassengerBody = (
  ctx: CanvasRenderingContext2D,
  passenger: Passenger,
  colors: PassengerColorScheme,
  opacityMult: number,
) => {
  ctx.beginPath();
  ctx.ellipse(
    0,
    -passenger.size * 0.3,
    passenger.size * 0.3,
    passenger.size * 0.5,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = `rgba(${colors.body[0]}, ${colors.body[1]}, ${colors.body[2]}, ${
    passenger.opacity * opacityMult
  })`;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, -passenger.size * 0.9, passenger.size * 0.25, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${colors.skin[0]}, ${colors.skin[1]}, ${colors.skin[2]}, ${
    passenger.opacity * opacityMult
  })`;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, -passenger.size * 0.95, passenger.size * 0.22, Math.PI, 0);
  ctx.fillStyle = `rgba(${colors.body[0] - 30}, ${colors.body[1] - 30}, ${
    colors.body[2] - 30
  }, ${passenger.opacity * opacityMult})`;
  ctx.fill();
};

const drawPassengerAccessories = (
  ctx: CanvasRenderingContext2D,
  passenger: Passenger,
  colors: PassengerColorScheme,
  opacityMult: number,
) => {
  if (passenger.hasBag) {
    ctx.beginPath();
    ctx.roundRect(
      passenger.size * 0.25,
      -passenger.size * 0.4,
      passenger.size * 0.3,
      passenger.size * 0.4,
      2,
    );
    ctx.fillStyle = `rgba(${colors.body[0] + 20}, ${colors.body[1] + 15}, ${
      colors.body[2] + 10
    }, ${passenger.opacity * opacityMult})`;
    ctx.fill();
  }

  if (passenger.hasUmbrella) {
    ctx.beginPath();
    ctx.moveTo(-passenger.size * 0.4, -passenger.size * 0.5);
    ctx.lineTo(-passenger.size * 0.4, -passenger.size * 1.8);
    ctx.strokeStyle = `rgba(100, 80, 60, ${passenger.opacity * opacityMult})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
};

const drawPassenger = (
  ctx: CanvasRenderingContext2D,
  passenger: Passenger,
  opacityMult: number,
  passengerColors: PassengerColorScheme[],
  time: number,
) => {
  const colors = passengerColors[passenger.colorScheme];
  const isMoving =
    passenger.state === 'walking' ||
    passenger.state === 'boarding' ||
    passenger.state === 'exiting';
  const walkBob = isMoving
    ? Math.abs(Math.sin(time * 8 + passenger.walkPhase)) * 2
    : 0;
  const legPhase = Math.sin(time * 8 + passenger.walkPhase);

  ctx.save();
  ctx.translate(passenger.x, passenger.y - walkBob);
  ctx.scale(passenger.direction, 1);

  if (walkBob > 0)
    drawPassengerLegs(ctx, passenger, colors, legPhase, opacityMult);
  drawPassengerBody(ctx, passenger, colors, opacityMult);
  drawPassengerAccessories(ctx, passenger, colors, opacityMult);

  ctx.restore();
};

const movePassengersForArrivingTrain = (
  train: Train,
  passengers: Passenger[],
) => {
  passengers.forEach((passenger) => {
    if (Math.abs(passenger.y - train.y - 20) >= 30) return;

    if (Math.random() < 0.3) {
      passenger.state = 'exiting';
      passenger.targetX = passenger.x + (Math.random() - 0.5) * 200;
      return;
    }

    if (Math.random() < 0.3) {
      passenger.state = 'boarding';
      passenger.targetX = train.x + train.length / 2;
    }
  });
};

const hasTrainReachedStop = (train: Train, canvasWidth: number) => {
  const stopX = train.direction > 0 ? canvasWidth * 0.3 : canvasWidth * 0.7;
  if (train.direction > 0) return train.x > stopX;
  return train.x < stopX;
};

const updateArrivingTrain = (
  train: Train,
  canvasWidth: number,
  passengers: Passenger[],
) => {
  train.speed += (train.targetSpeed - train.speed) * 0.02;
  train.x += train.speed * train.direction;

  if (!hasTrainReachedStop(train, canvasWidth)) return;

  train.state = 'stopped';
  train.stateTimer = 200 + Math.random() * 200;
  movePassengersForArrivingTrain(train, passengers);
};

const updateStoppedTrain = (train: Train) => {
  train.speed *= 0.9;
  train.stateTimer--;
  if (train.stateTimer <= 0) {
    train.state = 'departing';
  }
};

const isTrainPastCanvas = (train: Train, canvasWidth: number) =>
  train.x < -train.length - 50 || train.x > canvasWidth + train.length + 50;

const updateDepartingTrain = (
  train: Train,
  index: number,
  canvas: HTMLCanvasElement,
  trains: Train[],
) => {
  train.speed += train.targetSpeed * 0.01;
  train.x += train.speed * train.direction;

  if (isTrainPastCanvas(train, canvas.width)) {
    trains[index] = createTrain(canvas);
  }
};

const updateTrain = (
  train: Train,
  index: number,
  canvas: HTMLCanvasElement,
  trains: Train[],
  passengers: Passenger[],
) => {
  switch (train.state) {
    case 'arriving':
      updateArrivingTrain(train, canvas.width, passengers);
      break;
    case 'stopped':
      updateStoppedTrain(train);
      break;
    case 'departing':
      updateDepartingTrain(train, index, canvas, trains);
      break;
    case 'passing':
      break;
  }
};

const platformHasTrain = (
  trains: Train[],
  canvasHeight: number,
  platformRatio: number,
) =>
  trains.some((train) => Math.abs(train.y - canvasHeight * platformRatio) < 20);

const spawnTrainForPlatform = (
  trains: Train[],
  canvas: HTMLCanvasElement,
  platformIndex: number,
  platformRatio: number,
) => {
  if (
    platformHasTrain(trains, canvas.height, platformRatio) ||
    Math.random() >= 0.008
  )
    return;

  trains.push(createTrain(canvas, platformIndex));
};

const spawnPlatformTrains = (trains: Train[], canvas: HTMLCanvasElement) => {
  spawnTrainForPlatform(trains, canvas, 0, 0.4);
  spawnTrainForPlatform(trains, canvas, 1, 0.65);
};

const startPassengerWalking = (passenger: Passenger) => {
  passenger.state = 'walking';
  passenger.targetX = passenger.x + (Math.random() - 0.5) * 150;
};

const updateWaitingPassenger = (passenger: Passenger) => {
  if (Math.random() < 0.002) {
    startPassengerWalking(passenger);
  }
};

const movePassengerTowardTarget = (
  passenger: Passenger,
  stopDistance: number,
) => {
  const dx = passenger.targetX - passenger.x;
  if (Math.abs(dx) <= stopDistance) return true;

  passenger.direction = dx > 0 ? 1 : -1;
  passenger.x += passenger.speed * passenger.direction;
  return false;
};

const updateWalkingPassenger = (passenger: Passenger) => {
  if (movePassengerTowardTarget(passenger, 2)) {
    passenger.state = 'waiting';
  }
};

const updateBoardingPassenger = (
  passenger: Passenger,
  index: number,
  canvas: HTMLCanvasElement,
  platforms: Platform[],
  passengers: Passenger[],
) => {
  if (!movePassengerTowardTarget(passenger, 5)) return;

  const platformY = platforms[Math.floor(Math.random() * platforms.length)].y;
  passengers[index] = createPassenger(canvas, platformY);
};

const updatePassenger = (
  passenger: Passenger,
  index: number,
  canvas: HTMLCanvasElement,
  platforms: Platform[],
  passengers: Passenger[],
) => {
  switch (passenger.state) {
    case 'waiting':
      updateWaitingPassenger(passenger);
      break;
    case 'walking':
    case 'exiting':
      updateWalkingPassenger(passenger);
      break;
    case 'boarding':
      updateBoardingPassenger(passenger, index, canvas, platforms, passengers);
      break;
  }
};

const wrapPassengerToScreen = (passenger: Passenger, canvasWidth: number) => {
  if (passenger.x < 0) passenger.x = canvasWidth;
  if (passenger.x > canvasWidth) passenger.x = 0;
};

const drawTrainStationFrame = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  scene: TrainStationScene,
  time: number,
  opacity: number,
  darkMode: boolean,
  trainColors: TrainColorScheme[],
  passengerColors: PassengerColorScheme[],
) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const opacityMultiplier = opacity / 50;

  scene.platforms.forEach((platform) =>
    drawPlatform(ctx, platform, opacityMultiplier, darkMode),
  );
  scene.trains.forEach((train, index) => {
    updateTrain(train, index, canvas, scene.trains, scene.passengers);
    drawTrain(ctx, train, opacityMultiplier, trainColors);
  });
  spawnPlatformTrains(scene.trains, canvas);
  scene.passengers.forEach((passenger, index) => {
    updatePassenger(
      passenger,
      index,
      canvas,
      scene.platforms,
      scene.passengers,
    );
    wrapPassengerToScreen(passenger, canvas.width);
    drawPassenger(ctx, passenger, opacityMultiplier, passengerColors, time);
  });
};

export function useTrainStation(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean,
) {
  const trainsRef = useRef<Train[]>([]);
  const passengersRef = useRef<Passenger[]>([]);
  const platformsRef = useRef<Platform[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const trainColors = getTrainColors(darkMode);
    const passengerColors = getPassengerColors(darkMode);

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const scene = createTrainStationScene(canvas);
      platformsRef.current = scene.platforms;
      passengersRef.current = scene.passengers;
      trainsRef.current = scene.trains;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const animate = () => {
      if (!canvas || !ctx) return;

      timeRef.current += 0.016;
      drawTrainStationFrame(
        ctx,
        canvas,
        {
          platforms: platformsRef.current,
          passengers: passengersRef.current,
          trains: trainsRef.current,
        },
        timeRef.current,
        opacity,
        darkMode,
        trainColors,
        passengerColors,
      );

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, active]);
}

function createPassenger(
  canvas: HTMLCanvasElement,
  platformY: number,
): Passenger {
  const startX = Math.random() * canvas.width;

  return {
    x: startX,
    y: platformY + 20,
    targetX: startX + (Math.random() - 0.5) * 200,
    size: 8 + Math.random() * 4,
    speed: 0.3 + Math.random() * 0.4,
    walkPhase: Math.random() * Math.PI * 2,
    direction: Math.random() < 0.5 ? 1 : -1,
    colorScheme: Math.floor(Math.random() * 5),
    opacity: 0.1 + Math.random() * 0.08,
    state: 'waiting',
    hasUmbrella: Math.random() < 0.2,
    hasBag: Math.random() < 0.4,
  };
}
