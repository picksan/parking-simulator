export type ScenarioTemplateId = "garage-bay" | "narrow-exit";

export interface VehicleSpec {
  id: string;
  name: string;
  length: number;
  width: number;
  wheelbase: number;
  frontOverhang: number;
  rearOverhang: number;
  maxSteeringDeg: number;
  stepDistance: number;
  steeringStepDeg: number;
}

export interface VehiclePose {
  x: number;
  y: number;
  heading: number;
  steeringDeg: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface RectObstacle {
  id: string;
  name: string;
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  role: "pillar" | "wall" | "wheel-stop";
  collidable: boolean;
}

export interface CircleObstacle {
  id: string;
  name: string;
  kind: "circle";
  x: number;
  y: number;
  radius: number;
  role: "pillar";
  collidable: boolean;
}

export type Obstacle = RectObstacle | CircleObstacle;

export interface ParkingLine {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  style?: "slot" | "lane-edge" | "guide";
}

export interface GroundArrow {
  id: string;
  name: string;
  x: number;
  y: number;
  length: number;
  width: number;
  rotation: number;
  color: string;
}

export interface ScenarioLayout {
  slotWidth: number;
  slotDepth: number;
  laneWidth: number;
  wallThickness: number;
  columnSize: number;
  columnOffset: number;
}

export interface Scenario {
  id: string;
  name: string;
  templateId: ScenarioTemplateId;
  bounds: Bounds;
  layout: ScenarioLayout;
  obstacles: Obstacle[];
  parkingLines: ParkingLine[];
  arrows: GroundArrow[];
  vehicleStart: VehiclePose;
}

export type ControlAction =
  | "forward"
  | "reverse"
  | "steer-left"
  | "steer-right"
  | "steer-center"
  | "reset";

export interface ClearanceResult {
  obstacleId: string | null;
  obstacleName: string | null;
  distance: number;
  collided: boolean;
  carPoint?: Point;
  obstaclePoint?: Point;
}

export interface SimulationStep {
  id: string;
  action: Exclude<ControlAction, "reset">;
  pose: VehiclePose;
  samples: VehiclePose[];
  collided: boolean;
  clearance: ClearanceResult;
}

export interface PersistedState {
  version: number;
  vehicleSpec: VehicleSpec;
  scenario: Scenario;
  currentPose: VehiclePose;
  history: SimulationStep[];
}

export interface VehiclePreset {
  id: string;
  name: string;
  spec: VehicleSpec;
}

export type EditorMode = "obstacle" | "vehicle";
