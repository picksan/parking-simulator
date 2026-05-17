import type {
  GroundArrow,
  Obstacle,
  ParkingLine,
  Scenario,
  ScenarioLayout,
  ScenarioTemplateId,
  VehiclePose,
  VehiclePreset,
  VehicleSpec,
} from "../types";
import { degToRad } from "./geometry";

export const vehiclePresets: VehiclePreset[] = [
  {
    id: "compact-sedan",
    name: "紧凑型轿车",
    spec: {
      id: "compact-sedan",
      name: "紧凑型轿车",
      length: 4.55,
      width: 1.8,
      wheelbase: 2.7,
      frontOverhang: 0.95,
      rearOverhang: 0.9,
      maxSteeringDeg: 34,
      stepDistance: 0.35,
      steeringStepDeg: 5,
    },
  },
  {
    id: "family-suv",
    name: "家用 SUV",
    spec: {
      id: "family-suv",
      name: "家用 SUV",
      length: 4.82,
      width: 1.92,
      wheelbase: 2.82,
      frontOverhang: 0.98,
      rearOverhang: 1.02,
      maxSteeringDeg: 33,
      stepDistance: 0.35,
      steeringStepDeg: 5,
    },
  },
  {
    id: "large-sedan",
    name: "中大型轿车",
    spec: {
      id: "large-sedan",
      name: "中大型轿车",
      length: 5.02,
      width: 1.88,
      wheelbase: 3.0,
      frontOverhang: 0.99,
      rearOverhang: 1.03,
      maxSteeringDeg: 32,
      stepDistance: 0.35,
      steeringStepDeg: 4,
    },
  },
];

const defaultLayoutByTemplate: Record<ScenarioTemplateId, ScenarioLayout> = {
  "garage-bay": {
    slotWidth: 2.7,
    slotDepth: 5.4,
    laneWidth: 5.8,
    wallThickness: 0.25,
    columnSize: 0.45,
    columnOffset: 0.35,
  },
  "narrow-exit": {
    slotWidth: 2.6,
    slotDepth: 5.1,
    laneWidth: 4.9,
    wallThickness: 0.25,
    columnSize: 0.45,
    columnOffset: 0.25,
  },
};

function createParkingBox(layout: ScenarioLayout, originX: number, originY: number): ParkingLine[] {
  const lines: ParkingLine[] = [
    {
      id: "slot-left",
      name: "左侧车位线",
      x1: originX,
      y1: originY,
      x2: originX,
      y2: originY + layout.slotDepth,
      style: "slot",
    },
    {
      id: "slot-right",
      name: "右侧车位线",
      x1: originX + layout.slotWidth,
      y1: originY,
      x2: originX + layout.slotWidth,
      y2: originY + layout.slotDepth,
      style: "slot",
    },
    {
      id: "slot-back",
      name: "车位后边线",
      x1: originX,
      y1: originY + layout.slotDepth,
      x2: originX + layout.slotWidth,
      y2: originY + layout.slotDepth,
      style: "slot",
    },
  ];
  return lines;
}

function garageBayScenario(layout: ScenarioLayout): Scenario {
  const moduleCount = 3;
  const slotsPerModule = 2;
  const slotGap = 0.32;
  const moduleGap = 1.18;
  const laneGap = 0.42;
  const sideMargin = 0.9;
  const slotXPositions: Array<{ x0: number; x1: number; moduleIndex: number; slotIndex: number }> = [];
  let cursorX = 0;
  for (let moduleIndex = 0; moduleIndex < moduleCount; moduleIndex += 1) {
    for (let slotIndex = 0; slotIndex < slotsPerModule; slotIndex += 1) {
      const x0 = cursorX;
      const x1 = x0 + layout.slotWidth;
      slotXPositions.push({ x0, x1, moduleIndex, slotIndex });
      cursorX = x1 + (slotIndex === slotsPerModule - 1 ? moduleGap : slotGap);
    }
  }
  const blockWidth = cursorX - moduleGap;
  const laneHeight = layout.laneWidth;
  const topRowBottom = laneHeight / 2 + laneGap;
  const topRowTop = topRowBottom + layout.slotDepth;
  const bottomRowTop = -laneHeight / 2 - laneGap;
  const bottomRowBottom = bottomRowTop - layout.slotDepth;
  const bounds = {
    minX: -sideMargin,
    maxX: blockWidth + sideMargin,
    minY: bottomRowBottom - 0.9,
    maxY: topRowTop + 0.9,
  };

  const parkingLines: ParkingLine[] = [];
  const obstacles: Obstacle[] = [];
  const arrows: GroundArrow[] = [
    {
      id: "lane-arrow-left",
      name: "左向导流箭头",
      x: blockWidth * 0.28,
      y: 0,
      length: 2.2,
      width: 0.86,
      rotation: degToRad(90),
      color: "rgba(255,255,255,0.92)",
    },
    {
      id: "lane-arrow-right",
      name: "右向导流箭头",
      x: blockWidth * 0.72,
      y: 0,
      length: 2.2,
      width: 0.86,
      rotation: degToRad(-90),
      color: "rgba(255,255,255,0.92)",
    },
  ];

  const targetModuleIndex = 1;
  const halfColumn = layout.columnSize / 2;
  const wheelStopWidth = Math.min(1.45, layout.slotWidth * 0.58);
  const wheelStopHeight = 0.16;

  function gapCenterXForIndex(gapIndex: number): number {
    if (gapIndex === 0) {
      return slotXPositions[0].x0 - moduleGap / 2 + halfColumn;
    }
    if (gapIndex === moduleCount) {
      return blockWidth + moduleGap / 2 - halfColumn;
    }
    const leftSlot = slotXPositions[gapIndex * slotsPerModule - 1];
    const rightSlot = slotXPositions[gapIndex * slotsPerModule];
    return (leftSlot.x1 + rightSlot.x0) / 2;
  }

  for (const slot of slotXPositions) {
    const index = slot.moduleIndex * slotsPerModule + slot.slotIndex;
    const x0 = slot.x0;
    const x1 = slot.x1;

    parkingLines.push(
      {
        id: `top-slot-left-${index}`,
        name: `上排车位 ${index + 1} 左线`,
        x1: x0,
        y1: topRowBottom,
        x2: x0,
        y2: topRowTop,
        style: "slot",
      },
      {
        id: `top-slot-right-${index}`,
        name: `上排车位 ${index + 1} 右线`,
        x1,
        y1: topRowBottom,
        x2: x1,
        y2: topRowTop,
        style: "slot",
      },
      {
        id: `top-slot-back-${index}`,
        name: `上排车位 ${index + 1} 后线`,
        x1: x0,
        y1: topRowTop,
        x2: x1,
        y2: topRowTop,
        style: "slot",
      },
      {
        id: `bottom-slot-left-${index}`,
        name: `下排车位 ${index + 1} 左线`,
        x1: x0,
        y1: bottomRowBottom,
        x2: x0,
        y2: bottomRowTop,
        style: "slot",
      },
      {
        id: `bottom-slot-right-${index}`,
        name: `下排车位 ${index + 1} 右线`,
        x1,
        y1: bottomRowBottom,
        x2: x1,
        y2: bottomRowTop,
        style: "slot",
      },
      {
        id: `bottom-slot-back-${index}`,
        name: `下排车位 ${index + 1} 后线`,
        x1: x0,
        y1: bottomRowBottom,
        x2: x1,
        y2: bottomRowBottom,
        style: "slot",
      },
    );

    const slotCenterX = (x0 + x1) / 2;
    obstacles.push(
      {
        id: `top-wheel-stop-${index}`,
        name: `上排车挡 ${index + 1}`,
        kind: "rect",
        x: slotCenterX,
        y: topRowTop - 0.38,
        width: wheelStopWidth,
        height: wheelStopHeight,
        rotation: 0,
        role: "wheel-stop",
        collidable: false,
      },
      {
        id: `bottom-wheel-stop-${index}`,
        name: `下排车挡 ${index + 1}`,
        kind: "rect",
        x: slotCenterX,
        y: bottomRowBottom + 0.38,
        width: wheelStopWidth,
        height: wheelStopHeight,
        rotation: 0,
        role: "wheel-stop",
        collidable: false,
      },
    );
  }

  for (let gapIndex = 0; gapIndex <= moduleCount; gapIndex += 1) {
    const gapCenterX = gapCenterXForIndex(gapIndex);
    const isTargetBoundary = gapIndex === targetModuleIndex || gapIndex === targetModuleIndex + 1;
    if (!isTargetBoundary) {
      obstacles.push({
        id: `top-gap-pillar-${gapIndex}`,
        name: `上排边柱 ${gapIndex + 1}`,
        kind: "rect",
        x: gapCenterX,
        y: topRowBottom + halfColumn + 0.08,
        width: layout.columnSize,
        height: layout.columnSize,
        rotation: 0,
        role: "pillar",
        collidable: true,
      });
    }
    obstacles.push({
      id: `bottom-gap-pillar-${gapIndex}`,
      name: `下排边柱 ${gapIndex + 1}`,
      kind: "rect",
      x: gapCenterX,
      y: bottomRowTop - halfColumn - 0.08,
      width: layout.columnSize,
      height: layout.columnSize,
      rotation: 0,
      role: "pillar",
      collidable: true,
    });
  }

  parkingLines.push(
    {
      id: "lane-top-edge",
      name: "主车道上边线",
      x1: bounds.minX + 0.2,
      y1: laneHeight / 2,
      x2: bounds.maxX - 0.2,
      y2: laneHeight / 2,
      style: "guide",
    },
    {
      id: "lane-bottom-edge",
      name: "主车道下边线",
      x1: bounds.minX + 0.2,
      y1: -laneHeight / 2,
      x2: bounds.maxX - 0.2,
      y2: -laneHeight / 2,
      style: "guide",
    },
    {
      id: "lane-divider-1",
      name: "车道分隔虚线 1",
      x1: blockWidth * 0.16,
      y1: 0,
      x2: blockWidth * 0.24,
      y2: 0,
      style: "lane-edge",
    },
    {
      id: "lane-divider-2",
      name: "车道分隔虚线 2",
      x1: blockWidth * 0.42,
      y1: 0,
      x2: blockWidth * 0.5,
      y2: 0,
      style: "lane-edge",
    },
    {
      id: "lane-divider-3",
      name: "车道分隔虚线 3",
      x1: blockWidth * 0.68,
      y1: 0,
      x2: blockWidth * 0.76,
      y2: 0,
      style: "lane-edge",
    },
  );

  obstacles.push(
    {
      id: "target-left-pillar",
      name: "目标位左入口柱",
      kind: "rect",
      x: gapCenterXForIndex(targetModuleIndex),
      y: topRowBottom + halfColumn + 0.06,
      width: layout.columnSize,
      height: layout.columnSize,
      rotation: 0,
      role: "pillar",
      collidable: true,
    },
    {
      id: "target-right-pillar",
      name: "目标位右入口柱",
      kind: "rect",
      x: gapCenterXForIndex(targetModuleIndex + 1),
      y: topRowBottom + halfColumn + 0.06,
      width: layout.columnSize,
      height: layout.columnSize,
      rotation: 0,
      role: "pillar",
      collidable: true,
    },
  );

  const vehicleStart: VehiclePose = {
    x: bounds.maxX - 1.9,
    y: 0,
    heading: degToRad(180),
    steeringDeg: 0,
  };

  return {
    id: "garage-bay",
    name: "地下车库总平面入库",
    templateId: "garage-bay",
    bounds,
    layout,
    obstacles,
    parkingLines,
    arrows,
    vehicleStart,
  };
}

function narrowExitScenario(layout: ScenarioLayout): Scenario {
  const bounds = {
    minX: -2.5,
    maxX: layout.slotWidth + 4.8,
    minY: -1.2,
    maxY: layout.slotDepth + layout.laneWidth + 1.4,
  };
  const originX = 0;
  const originY = 0.2;
  const parkingLines = createParkingBox(layout, originX, originY);
  const corridorHeight = layout.slotDepth + layout.laneWidth;
  const wallY = layout.slotDepth + layout.laneWidth * 0.48;
  const obstacles: Obstacle[] = [
    {
      id: "left-corridor-wall",
      name: "左侧通道墙",
      kind: "rect",
      x: -0.8,
      y: corridorHeight / 2,
      width: 0.25,
      height: corridorHeight,
      rotation: 0,
      role: "wall",
      collidable: true,
    },
    {
      id: "top-corner-wall",
      name: "前方墙角",
      kind: "rect",
      x: layout.slotWidth + 1.35,
      y: wallY,
      width: 2.7,
      height: 0.25,
      rotation: 0,
      role: "wall",
      collidable: true,
    },
    {
      id: "right-corner-pillar",
      name: "右前柱",
      kind: "rect",
      x: layout.slotWidth + 0.3,
      y: wallY - layout.columnOffset,
      width: layout.columnSize,
      height: layout.columnSize,
      rotation: 0,
      role: "pillar",
      collidable: true,
    },
    {
      id: "rear-left-pillar",
      name: "左后柱",
      kind: "rect",
      x: layout.columnOffset,
      y: originY + layout.slotDepth - layout.columnOffset,
      width: layout.columnSize,
      height: layout.columnSize,
      rotation: 0,
      role: "pillar",
      collidable: true,
    },
  ];
  const arrows: GroundArrow[] = [
    {
      id: "exit-arrow",
      name: "出库箭头",
      x: -1.3,
      y: layout.slotDepth + layout.laneWidth * 0.28,
      length: 1.5,
      width: 0.58,
      rotation: degToRad(90),
      color: "rgba(255,255,255,0.86)",
    },
  ];
  const vehicleStart: VehiclePose = {
    x: layout.slotWidth / 2,
    y: originY + layout.slotDepth * 0.56,
    heading: degToRad(-90),
    steeringDeg: 0,
  };

  return {
    id: "narrow-exit",
    name: "狭窄车库出库",
    templateId: "narrow-exit",
    bounds,
    layout,
    obstacles,
    parkingLines,
    arrows,
    vehicleStart,
  };
}

export function createScenario(templateId: ScenarioTemplateId, layout?: Partial<ScenarioLayout>): Scenario {
  const mergedLayout = { ...defaultLayoutByTemplate[templateId], ...layout };
  if (templateId === "narrow-exit") {
    return narrowExitScenario(mergedLayout);
  }
  return garageBayScenario(mergedLayout);
}

export function getDefaultVehicleSpec(): VehicleSpec {
  return { ...vehiclePresets[1].spec };
}

export function scenarioTemplateName(templateId: ScenarioTemplateId): string {
  return templateId === "garage-bay" ? "单车位倒车入库" : "狭窄车库出库";
}
