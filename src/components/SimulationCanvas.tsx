import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorMode, GroundArrow, Obstacle, Point, Scenario, SimulationStep, VehiclePose, VehicleSpec } from "../types";
import {
  carPolygon,
  degToRad,
  distance,
  normalizeAngle,
  obstacleToPolygon,
  pointInPolygon,
  rotatePoint,
  translateObstacle,
} from "../lib/geometry";

interface SimulationCanvasProps {
  scenario: Scenario;
  spec: VehicleSpec;
  pose: VehiclePose;
  history: SimulationStep[];
  selectedObstacleId: string | null;
  editorMode: EditorMode;
  activeClearancePoints?: Array<{ carPoint?: Point; obstaclePoint?: Point; collided?: boolean }>;
  onObstacleSelect: (obstacleId: string | null) => void;
  onScenarioChange: (scenario: Scenario) => void;
  onPoseChange: (pose: VehiclePose) => void;
}

interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface DragState {
  kind: "obstacle" | "vehicle-move" | "vehicle-rotate";
  poseTarget?: "current" | "start";
  targetId?: string;
  offsetX: number;
  offsetY: number;
  headingOffset?: number;
}

const GRID_STEP = 1;
const FRONT_MARKER_COLOR = "#e35a2e";
const REAR_MARKER_COLOR = "#0f4f71";
const WHEEL_COLOR = "#1f2730";
const FRONT_WHEEL_COLOR = "#0d5c78";
const A_PILLAR_COLOR = "#f4c542";
const B_PILLAR_COLOR = "#4ea4ff";
const C_PILLAR_COLOR = "#c879ff";

function drawPolygon(ctx: CanvasRenderingContext2D, points: Point[]): void {
  if (points.length === 0) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

function drawArrow(ctx: CanvasRenderingContext2D, arrow: GroundArrow, view: ViewTransform): void {
  const bodyHalf = arrow.width * 0.28;
  const headLength = arrow.length * 0.38;
  const shaftLength = arrow.length - headLength;
  const localPoints: Point[] = [
    { x: -bodyHalf, y: 0 },
    { x: -bodyHalf, y: shaftLength },
    { x: -arrow.width / 2, y: shaftLength },
    { x: 0, y: arrow.length },
    { x: arrow.width / 2, y: shaftLength },
    { x: bodyHalf, y: shaftLength },
    { x: bodyHalf, y: 0 },
  ];
  const worldPoints = localPoints.map((point) => {
    const rotated = rotatePoint(point, arrow.rotation);
    return worldToCanvas({ x: arrow.x + rotated.x, y: arrow.y + rotated.y }, view);
  });
  drawPolygon(ctx, worldPoints);
  ctx.fillStyle = arrow.color;
  ctx.fill();
}

function getTransform(canvas: HTMLCanvasElement, scenario: Scenario): ViewTransform {
  const padding = 48;
  const width = canvas.width;
  const height = canvas.height;
  const sceneWidth = scenario.bounds.maxX - scenario.bounds.minX;
  const sceneHeight = scenario.bounds.maxY - scenario.bounds.minY;
  const scale = Math.min((width - padding * 2) / sceneWidth, (height - padding * 2) / sceneHeight);
  const offsetX = padding - scenario.bounds.minX * scale;
  const offsetY = height - padding + scenario.bounds.minY * scale;
  return { scale, offsetX, offsetY };
}

function worldToCanvas(point: Point, transform: ViewTransform): Point {
  return {
    x: point.x * transform.scale + transform.offsetX,
    y: transform.offsetY - point.y * transform.scale,
  };
}

function canvasToWorld(point: Point, transform: ViewTransform): Point {
  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (transform.offsetY - point.y) / transform.scale,
  };
}

function eventPointToCanvas(
  event: Pick<React.MouseEvent<HTMLCanvasElement>, "clientX" | "clientY">,
  canvas: HTMLCanvasElement,
): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function pickObstacle(worldPoint: Point, obstacles: Obstacle[]): string | null {
  let bestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const obstacle of obstacles) {
    const center = { x: obstacle.x, y: obstacle.y };
    const centerDistance = distance(worldPoint, center);
    const radius = obstacle.kind === "circle" ? obstacle.radius : Math.max(obstacle.width, obstacle.height) / 1.8;
    if (centerDistance <= radius && centerDistance < bestDistance) {
      bestId = obstacle.id;
      bestDistance = centerDistance;
    }
  }
  return bestId;
}

function frontMarkerPoints(spec: VehicleSpec, pose: VehiclePose): Point[] {
  const halfWidth = spec.width / 2;
  const frontX = spec.wheelbase + spec.frontOverhang;
  const markerDepth = Math.min(0.8, spec.length * 0.18);
  const markerInset = Math.min(0.18, spec.width * 0.12);
  const localPoints: Point[] = [
    { x: frontX, y: 0 },
    { x: frontX - markerDepth, y: halfWidth - markerInset },
    { x: frontX - markerDepth, y: -halfWidth + markerInset },
  ];

  return localPoints.map((point) => {
    const rotated = rotatePoint(point, pose.heading);
    return { x: pose.x + rotated.x, y: pose.y + rotated.y };
  });
}

function rearMarkerPoints(spec: VehicleSpec, pose: VehiclePose): Point[] {
  const halfWidth = spec.width / 2;
  const rearX = -spec.rearOverhang;
  const stripDepth = Math.min(0.32, spec.length * 0.08);
  const stripInset = Math.min(0.16, spec.width * 0.12);
  const localPoints: Point[] = [
    { x: rearX, y: -halfWidth + stripInset },
    { x: rearX, y: halfWidth - stripInset },
    { x: rearX + stripDepth, y: halfWidth - stripInset },
    { x: rearX + stripDepth, y: -halfWidth + stripInset },
  ];

  return localPoints.map((point) => {
    const rotated = rotatePoint(point, pose.heading);
    return { x: pose.x + rotated.x, y: pose.y + rotated.y };
  });
}

function wheelPolygon(center: Point, heading: number, wheelLength: number, wheelWidth: number): Point[] {
  const halfLength = wheelLength / 2;
  const halfWidth = wheelWidth / 2;
  const localPoints: Point[] = [
    { x: -halfLength, y: -halfWidth },
    { x: halfLength, y: -halfWidth },
    { x: halfLength, y: halfWidth },
    { x: -halfLength, y: halfWidth },
  ];
  return localPoints.map((point) => {
    const rotated = rotatePoint(point, heading);
    return { x: center.x + rotated.x, y: center.y + rotated.y };
  });
}

function wheelPolygons(spec: VehicleSpec, pose: VehiclePose): Array<{ kind: "front" | "rear"; polygon: Point[] }> {
  const wheelBaseX = spec.wheelbase;
  const track = spec.width * 0.72;
  const halfTrack = track / 2;
  const wheelLength = Math.min(0.72, spec.length * 0.14);
  const wheelWidth = Math.min(0.28, spec.width * 0.16);
  const frontAngle = pose.heading + rotatePoint({ x: 1, y: 0 }, degToRad(pose.steeringDeg)).y * 0 + degToRad(pose.steeringDeg);
  const rearAngle = pose.heading;
  const centers = [
    { kind: "front" as const, local: { x: wheelBaseX, y: -halfTrack } },
    { kind: "front" as const, local: { x: wheelBaseX, y: halfTrack } },
    { kind: "rear" as const, local: { x: 0, y: -halfTrack } },
    { kind: "rear" as const, local: { x: 0, y: halfTrack } },
  ];

  return centers.map(({ kind, local }) => {
    const worldCenter = rotatePoint(local, pose.heading);
    const center = { x: pose.x + worldCenter.x, y: pose.y + worldCenter.y };
    return {
      kind,
      polygon: wheelPolygon(center, kind === "front" ? frontAngle : rearAngle, wheelLength, wheelWidth),
    };
  });
}

function bodyPillarPoints(
  spec: VehicleSpec,
  pose: VehiclePose,
): Array<{ label: "A" | "B" | "C"; side: "left" | "right"; point: Point }> {
  const halfWidth = spec.width / 2;
  const inset = Math.min(0.18, spec.width * 0.12);
  const sidePoints = [
    { side: "left" as const, y: -halfWidth + inset },
    { side: "right" as const, y: halfWidth - inset },
  ];
  const xPositions = [
    { label: "A" as const, x: spec.wheelbase * 0.72 },
    { label: "B" as const, x: spec.wheelbase * 0.36 },
    { label: "C" as const, x: -spec.rearOverhang + spec.length * 0.18 },
  ];

  return xPositions.flatMap(({ label, x }) =>
    sidePoints.map(({ side, y }) => {
      const rotated = rotatePoint({ x, y }, pose.heading);
      return {
        label,
        side,
        point: { x: pose.x + rotated.x, y: pose.y + rotated.y },
      };
    }),
  );
}

function vehicleFrontCenter(spec: VehicleSpec, pose: VehiclePose): Point {
  const localPoint = { x: spec.wheelbase + spec.frontOverhang, y: 0 };
  const rotated = rotatePoint(localPoint, pose.heading);
  return { x: pose.x + rotated.x, y: pose.y + rotated.y };
}

function vehicleRotationHandlePoint(spec: VehicleSpec, pose: VehiclePose): Point {
  const localPoint = { x: spec.wheelbase + spec.frontOverhang + Math.max(0.8, spec.length * 0.18), y: 0 };
  const rotated = rotatePoint(localPoint, pose.heading);
  return { x: pose.x + rotated.x, y: pose.y + rotated.y };
}

function pointHitsVehicle(worldPoint: Point, spec: VehicleSpec, pose: VehiclePose): boolean {
  const polygon = carPolygon(spec, pose);
  if (pointInPolygon(worldPoint, polygon)) {
    return true;
  }
  return polygon.some((corner) => distance(worldPoint, corner) <= 0.45);
}

export function SimulationCanvas({
  scenario,
  spec,
  pose,
  history,
  selectedObstacleId,
  editorMode,
  activeClearancePoints,
  onObstacleSelect,
  onScenarioChange,
  onPoseChange,
}: SimulationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const transform = useMemo(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    return getTransform(canvas, scenario);
  }, [scenario]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth * dpr;
    const height = canvas.clientHeight * dpr;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const view = getTransform(canvas, scenario);
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f2efe6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (scenario.templateId === "garage-bay") {
      const laneTop = scenario.layout.laneWidth / 2;
      const laneBottom = -scenario.layout.laneWidth / 2;
      const laneLeft = worldToCanvas({ x: scenario.bounds.minX + 0.25, y: laneBottom }, view);
      const laneRight = worldToCanvas({ x: scenario.bounds.maxX - 0.25, y: laneTop }, view);
      ctx.fillStyle = "rgba(96, 101, 108, 0.22)";
      ctx.fillRect(laneLeft.x, laneRight.y, laneRight.x - laneLeft.x, laneLeft.y - laneRight.y);

      const upperBayLeft = worldToCanvas({ x: scenario.bounds.minX + 0.2, y: laneTop + 0.28 }, view);
      const upperBayRight = worldToCanvas({ x: scenario.bounds.maxX - 0.2, y: scenario.bounds.maxY - 0.25 }, view);
      ctx.fillStyle = "rgba(213, 74, 93, 0.16)";
      ctx.fillRect(upperBayLeft.x, upperBayRight.y, upperBayRight.x - upperBayLeft.x, upperBayLeft.y - upperBayRight.y);

      const lowerBayLeft = worldToCanvas({ x: scenario.bounds.minX + 0.2, y: scenario.bounds.minY + 0.25 }, view);
      const lowerBayRight = worldToCanvas({ x: scenario.bounds.maxX - 0.2, y: laneBottom - 0.28 }, view);
      ctx.fillStyle = "rgba(43, 166, 214, 0.18)";
      ctx.fillRect(lowerBayLeft.x, lowerBayRight.y, lowerBayRight.x - lowerBayLeft.x, lowerBayLeft.y - lowerBayRight.y);
    }

    for (let x = Math.floor(scenario.bounds.minX); x <= Math.ceil(scenario.bounds.maxX); x += GRID_STEP) {
      const from = worldToCanvas({ x, y: scenario.bounds.minY }, view);
      const to = worldToCanvas({ x, y: scenario.bounds.maxY }, view);
      ctx.strokeStyle = x === 0 ? "rgba(35, 52, 65, 0.24)" : "rgba(35, 52, 65, 0.08)";
      ctx.lineWidth = x === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    for (let y = Math.floor(scenario.bounds.minY); y <= Math.ceil(scenario.bounds.maxY); y += GRID_STEP) {
      const from = worldToCanvas({ x: scenario.bounds.minX, y }, view);
      const to = worldToCanvas({ x: scenario.bounds.maxX, y }, view);
      ctx.strokeStyle = y === 0 ? "rgba(35, 52, 65, 0.24)" : "rgba(35, 52, 65, 0.08)";
      ctx.lineWidth = y === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    for (const line of scenario.parkingLines) {
      const start = worldToCanvas({ x: line.x1, y: line.y1 }, view);
      const end = worldToCanvas({ x: line.x2, y: line.y2 }, view);
      if (line.style === "slot" || !line.style) {
        ctx.setLineDash([10, 8]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.94)";
        ctx.lineWidth = 2.5;
      } else if (line.style === "lane-edge") {
        ctx.setLineDash([16, 14]);
        ctx.strokeStyle = "rgba(255,255,255,0.78)";
        ctx.lineWidth = 3;
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(31, 97, 180, 0.52)";
        ctx.lineWidth = 3;
      }
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const arrow of scenario.arrows) {
      drawArrow(ctx, arrow, view);
    }

    for (const step of history) {
      if (step.action !== "forward" && step.action !== "reverse") {
        continue;
      }
      for (const sample of step.samples) {
        const polygon = carPolygon(spec, sample).map((point) => worldToCanvas(point, view));
        drawPolygon(ctx, polygon);
        ctx.fillStyle = "rgba(220, 145, 52, 0.08)";
        ctx.fill();
      }
    }

    const centerTrack = history
      .flatMap((step) => step.samples)
      .map((sample) => worldToCanvas({ x: sample.x, y: sample.y }, view));
    if (centerTrack.length > 1) {
      ctx.beginPath();
      ctx.moveTo(centerTrack[0].x, centerTrack[0].y);
      for (let index = 1; index < centerTrack.length; index += 1) {
        ctx.lineTo(centerTrack[index].x, centerTrack[index].y);
      }
      ctx.strokeStyle = "#dc9134";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    for (const obstacle of scenario.obstacles) {
      const isSelected = obstacle.id === selectedObstacleId;
      if (obstacle.kind === "rect") {
        const polygon = obstacleToPolygon(obstacle).map((point) => worldToCanvas(point, view));
        drawPolygon(ctx, polygon);
        ctx.fillStyle =
          obstacle.role === "wheel-stop"
            ? "#232a31"
            : obstacle.role === "pillar"
              ? obstacle.collidable
                ? "#d8ddd9"
                : "rgba(216, 221, 217, 0.78)"
              : "#6f7f88";
        ctx.fill();
        ctx.lineWidth = isSelected ? 4 : 2;
        ctx.strokeStyle =
          isSelected
            ? "#ff7a00"
            : obstacle.role === "pillar"
              ? "rgba(29, 37, 42, 0.28)"
              : obstacle.role === "wheel-stop"
                ? "rgba(20, 24, 28, 0.5)"
                : "rgba(10, 18, 23, 0.25)";
        ctx.stroke();

        if (obstacle.role === "pillar") {
          const center = worldToCanvas({ x: obstacle.x, y: obstacle.y }, view);
          const hazardWidth = Math.min((obstacle.width * view.scale) / 3.2, 12);
          const hazardHeight = (obstacle.height * view.scale) / 2.2;
          ctx.fillStyle = "#1f2730";
          ctx.fillRect(center.x - hazardWidth * 1.5, center.y + hazardHeight * 0.1, hazardWidth, hazardHeight);
          ctx.fillStyle = "#f0bc2b";
          ctx.fillRect(center.x - hazardWidth * 0.5, center.y + hazardHeight * 0.1, hazardWidth, hazardHeight);
          ctx.fillStyle = "#1f2730";
          ctx.fillRect(center.x + hazardWidth * 0.5, center.y + hazardHeight * 0.1, hazardWidth, hazardHeight);
        } else if (obstacle.role === "wheel-stop") {
          const center = worldToCanvas({ x: obstacle.x, y: obstacle.y }, view);
          const stripeWidth = (obstacle.width * view.scale) / 4;
          const stripeHeight = obstacle.height * view.scale;
          ctx.fillStyle = "#f0bc2b";
          ctx.fillRect(center.x - stripeWidth, center.y - stripeHeight / 2, stripeWidth, stripeHeight);
          ctx.fillStyle = "#232a31";
          ctx.fillRect(center.x, center.y - stripeHeight / 2, stripeWidth, stripeHeight);
        }
      } else {
        const center = worldToCanvas({ x: obstacle.x, y: obstacle.y }, view);
        ctx.beginPath();
        ctx.arc(center.x, center.y, obstacle.radius * view.scale, 0, Math.PI * 2);
        ctx.fillStyle = "#475d6b";
        ctx.fill();
        ctx.lineWidth = isSelected ? 4 : 2;
        ctx.strokeStyle = isSelected ? "#ff7a00" : "rgba(10, 18, 23, 0.25)";
        ctx.stroke();
      }
    }

    const currentPolygon = carPolygon(spec, pose).map((point) => worldToCanvas(point, view));
    drawPolygon(ctx, currentPolygon);
    ctx.fillStyle = history.some((step) => step.collided) ? "rgba(200, 58, 46, 0.28)" : "rgba(34, 119, 82, 0.28)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = history.some((step) => step.collided) ? "#c83a2e" : "#0a7251";
    ctx.stroke();

    const frontMarker = frontMarkerPoints(spec, pose).map((point) => worldToCanvas(point, view));
    drawPolygon(ctx, frontMarker);
    ctx.fillStyle = FRONT_MARKER_COLOR;
    ctx.fill();

    const rearMarker = rearMarkerPoints(spec, pose).map((point) => worldToCanvas(point, view));
    drawPolygon(ctx, rearMarker);
    ctx.fillStyle = REAR_MARKER_COLOR;
    ctx.fill();

    for (const wheel of wheelPolygons(spec, pose)) {
      const polygon = wheel.polygon.map((point) => worldToCanvas(point, view));
      drawPolygon(ctx, polygon);
      ctx.fillStyle = wheel.kind === "front" ? FRONT_WHEEL_COLOR : WHEEL_COLOR;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.stroke();
    }

    const pillars = bodyPillarPoints(spec, pose);
    for (const pillar of pillars) {
      const point = worldToCanvas(pillar.point, view);
      const pillarColor =
        pillar.label === "A" ? A_PILLAR_COLOR : pillar.label === "B" ? B_PILLAR_COLOR : C_PILLAR_COLOR;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = pillarColor;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#7a5a00";
      ctx.stroke();

      ctx.fillStyle = "#4b3900";
      ctx.font = `${Math.max(11, Math.min(14, view.scale * 0.12))}px "Segoe UI", sans-serif`;
      ctx.fillText(`${pillar.label}柱${pillar.side === "left" ? "左" : "右"}`, point.x + 8, point.y - 8);
    }

    const frontCenter = worldToCanvas(vehicleFrontCenter(spec, pose), view);
    const axleCenter = worldToCanvas({ x: pose.x, y: pose.y }, view);
    ctx.beginPath();
    ctx.moveTo(axleCenter.x, axleCenter.y);
    ctx.lineTo(frontCenter.x, frontCenter.y);
    ctx.strokeStyle = "#12364f";
    ctx.lineWidth = 2;
    ctx.stroke();

    const editablePose = editorMode === "vehicle" ? scenario.vehicleStart : pose;
    const rotationAnchor = worldToCanvas(vehicleFrontCenter(spec, editablePose), view);
    const rotationHandle = worldToCanvas(vehicleRotationHandlePoint(spec, editablePose), view);
    ctx.beginPath();
    ctx.moveTo(rotationAnchor.x, rotationAnchor.y);
    ctx.lineTo(rotationHandle.x, rotationHandle.y);
    ctx.strokeStyle = "rgba(227, 90, 46, 0.88)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(rotationHandle.x, rotationHandle.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#fff4e8";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#e35a2e";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rotationHandle.x, rotationHandle.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#e35a2e";
    ctx.fill();

    for (const clearance of activeClearancePoints ?? []) {
      if (!clearance.carPoint || !clearance.obstaclePoint) {
        continue;
      }
      const a = worldToCanvas(clearance.carPoint, view);
      const b = worldToCanvas(clearance.obstaclePoint, view);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = clearance.collided ? "#c83a2e" : "#e14b2f";
      ctx.lineWidth = clearance.collided ? 3 : 2;
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const point of [a, b]) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = clearance.collided ? "#c83a2e" : "#e14b2f";
        ctx.fill();
      }
    }

    ctx.restore();
  }, [activeClearancePoints, history, pose, scenario, selectedObstacleId, spec]);

  function updateObstaclePosition(id: string, worldPoint: Point, offsetX: number, offsetY: number): void {
    const nextObstacles = scenario.obstacles.map((obstacle) => {
      if (obstacle.id !== id) {
        return obstacle;
      }
      return translateObstacle(obstacle, worldPoint.x - offsetX, worldPoint.y - offsetY);
    });
    onScenarioChange({ ...scenario, obstacles: nextObstacles });
  }

  function updateVehicleStart(worldPoint: Point, offsetX: number, offsetY: number): void {
    onScenarioChange({
      ...scenario,
      vehicleStart: {
        ...scenario.vehicleStart,
        x: worldPoint.x - offsetX,
        y: worldPoint.y - offsetY,
      },
    });
  }

  function updateVehicleStartHeading(nextHeading: number): void {
    onScenarioChange({
      ...scenario,
      vehicleStart: {
        ...scenario.vehicleStart,
        heading: nextHeading,
      },
    });
  }

  function updateCurrentPose(worldPoint: Point, offsetX: number, offsetY: number): void {
    onPoseChange({
      ...pose,
      x: worldPoint.x - offsetX,
      y: worldPoint.y - offsetY,
    });
  }

  function updateCurrentPoseHeading(nextHeading: number): void {
    onPoseChange({
      ...pose,
      heading: nextHeading,
    });
  }

  function handleMouseDown(event: React.MouseEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    event.preventDefault();
    const localPoint = eventPointToCanvas(event, canvas);
    const view = transform ?? getTransform(canvas, scenario);
    const worldPoint = canvasToWorld(localPoint, view);

    const editablePose = editorMode === "vehicle" ? scenario.vehicleStart : pose;
    const rotationHandlePoint = vehicleRotationHandlePoint(spec, editablePose);
    if (distance(worldPoint, rotationHandlePoint) <= 0.55) {
      setDragState({
        kind: "vehicle-rotate",
        poseTarget: editorMode === "vehicle" ? "start" : "current",
        offsetX: 0,
        offsetY: 0,
        headingOffset: normalizeAngle(
          Math.atan2(worldPoint.y - editablePose.y, worldPoint.x - editablePose.x) - editablePose.heading,
        ),
      });
      onObstacleSelect(null);
      return;
    }

    if (pointHitsVehicle(worldPoint, spec, pose)) {
      setDragState({
        kind: "vehicle-move",
        poseTarget: "current",
        offsetX: worldPoint.x - pose.x,
        offsetY: worldPoint.y - pose.y,
      });
      onObstacleSelect(null);
      return;
    }

    if (editorMode === "vehicle") {
      const start = scenario.vehicleStart;
      if (pointHitsVehicle(worldPoint, spec, start)) {
        setDragState({
          kind: "vehicle-move",
          poseTarget: "start",
          offsetX: worldPoint.x - start.x,
          offsetY: worldPoint.y - start.y,
        });
      }
      onObstacleSelect(null);
      return;
    }

    const pickedId = pickObstacle(worldPoint, scenario.obstacles);
    onObstacleSelect(pickedId);
    if (!pickedId) {
      return;
    }
    const obstacle = scenario.obstacles.find((item) => item.id === pickedId);
    if (!obstacle) {
      return;
    }
    setDragState({
      kind: "obstacle",
      targetId: obstacle.id,
      offsetX: worldPoint.x - obstacle.x,
      offsetY: worldPoint.y - obstacle.y,
    });
  }

  function handleMouseMove(event: React.MouseEvent<HTMLCanvasElement>): void {
    if (!dragState) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    event.preventDefault();
    const localPoint = eventPointToCanvas(event, canvas);
    const view = transform ?? getTransform(canvas, scenario);
    const worldPoint = canvasToWorld(localPoint, view);
    if (dragState.kind === "obstacle" && dragState.targetId) {
      updateObstaclePosition(dragState.targetId, worldPoint, dragState.offsetX, dragState.offsetY);
      return;
    }
    if (dragState.kind === "vehicle-rotate") {
      const basePose = dragState.poseTarget === "start" ? scenario.vehicleStart : pose;
      const pointerAngle = Math.atan2(worldPoint.y - basePose.y, worldPoint.x - basePose.x);
      const nextHeading = normalizeAngle(pointerAngle - (dragState.headingOffset ?? 0));
      if (dragState.poseTarget === "start") {
        updateVehicleStartHeading(nextHeading);
      } else {
        updateCurrentPoseHeading(nextHeading);
      }
      return;
    }
    if (dragState.poseTarget === "start") {
      updateVehicleStart(worldPoint, dragState.offsetX, dragState.offsetY);
      return;
    }
    updateCurrentPose(worldPoint, dragState.offsetX, dragState.offsetY);
  }

  function handleMouseUp(): void {
    setDragState(null);
  }

  return (
    <div className="canvas-shell">
      <div className="canvas-toolbar">
        <span>画布坐标单位：米</span>
        <span>{editorMode === "vehicle" ? "当前模式：拖拽起始车位" : "当前模式：拖拽障碍物"}</span>
        <span>橙红箭头是车头，蓝色短条是车尾</span>
        <span>深蓝前轮会跟随方向角转动</span>
        <span>彩色圆点标出车辆左右 A/B/C 柱</span>
      </div>
      <canvas
        ref={canvasRef}
        className="simulation-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
}
