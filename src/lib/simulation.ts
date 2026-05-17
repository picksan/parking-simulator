import type {
  ClearanceResult,
  ControlAction,
  Obstacle,
  Scenario,
  SimulationStep,
  VehiclePose,
  VehicleSpec,
} from "../types";
import { carPolygon, clamp, degToRad, normalizeAngle, obstacleDistance } from "./geometry";

export function advancePose(
  pose: VehiclePose,
  spec: VehicleSpec,
  signedDistance: number,
  subSteps = 12,
): VehiclePose[] {
  const samples: VehiclePose[] = [];
  let nextPose = { ...pose };
  const perStep = signedDistance / subSteps;

  for (let index = 0; index < subSteps; index += 1) {
    const steering = degToRad(nextPose.steeringDeg);
    const yawRate = Math.tan(steering) / spec.wheelbase;
    nextPose = {
      ...nextPose,
      x: nextPose.x + perStep * Math.cos(nextPose.heading),
      y: nextPose.y + perStep * Math.sin(nextPose.heading),
      heading: normalizeAngle(nextPose.heading + perStep * yawRate),
    };
    samples.push(nextPose);
  }

  return samples;
}

export function evaluatePose(spec: VehicleSpec, pose: VehiclePose, obstacles: Obstacle[]): ClearanceResult {
  const polygon = carPolygon(spec, pose);
  let best: ClearanceResult = {
    obstacleId: null,
    obstacleName: null,
    distance: Number.POSITIVE_INFINITY,
    collided: false,
  };

  for (const obstacle of obstacles) {
    if (!obstacle.collidable) {
      continue;
    }
    const result = obstacleDistance(polygon, obstacle);
    if (result.collided) {
      return {
        obstacleId: obstacle.id,
        obstacleName: obstacle.name,
        distance: 0,
        collided: true,
        carPoint: result.carPoint,
        obstaclePoint: result.obstaclePoint,
      };
    }
    if (result.distance < best.distance) {
      best = {
        obstacleId: obstacle.id,
        obstacleName: obstacle.name,
        distance: result.distance,
        collided: false,
        carPoint: result.carPoint,
        obstaclePoint: result.obstaclePoint,
      };
    }
  }

  return best;
}

function nextSteering(pose: VehiclePose, spec: VehicleSpec, action: ControlAction): VehiclePose {
  if (action === "steer-left") {
    return {
      ...pose,
      steeringDeg: clamp(pose.steeringDeg + spec.steeringStepDeg, -spec.maxSteeringDeg, spec.maxSteeringDeg),
    };
  }
  if (action === "steer-right") {
    return {
      ...pose,
      steeringDeg: clamp(pose.steeringDeg - spec.steeringStepDeg, -spec.maxSteeringDeg, spec.maxSteeringDeg),
    };
  }
  return { ...pose, steeringDeg: 0 };
}

export function simulateStep(
  action: Exclude<ControlAction, "reset">,
  pose: VehiclePose,
  spec: VehicleSpec,
  scenario: Scenario,
): SimulationStep {
  if (action === "steer-left" || action === "steer-right" || action === "steer-center") {
    const nextPose = nextSteering(pose, spec, action);
    const clearance = evaluatePose(spec, nextPose, scenario.obstacles);
    return {
      id: `${action}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      pose: nextPose,
      samples: [nextPose],
      collided: clearance.collided,
      clearance,
    };
  }

  const signedDistance = action === "forward" ? spec.stepDistance : -spec.stepDistance;
  const samples = advancePose(pose, spec, signedDistance);
  let lastClearance = evaluatePose(spec, pose, scenario.obstacles);
  let collisionDetected = lastClearance.collided;
  let finalPose = pose;
  const safeSamples: VehiclePose[] = [];

  for (const sample of samples) {
    const clearance = evaluatePose(spec, sample, scenario.obstacles);
    safeSamples.push(sample);
    lastClearance = clearance;
    finalPose = sample;
    if (clearance.collided) {
      collisionDetected = true;
      break;
    }
  }

  return {
    id: `${action}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    pose: finalPose,
    samples: safeSamples,
    collided: collisionDetected,
    clearance: lastClearance,
  };
}

export function rebuildHistoryEvaluation(
  history: SimulationStep[],
  scenario: Scenario,
  spec: VehicleSpec,
): SimulationStep[] {
  return history.map((step) => {
    const evaluationPose = step.samples[step.samples.length - 1] ?? step.pose;
    const clearance = evaluatePose(spec, evaluationPose, scenario.obstacles);
    return {
      ...step,
      pose: evaluationPose,
      collided: clearance.collided,
      clearance,
    };
  });
}

export function scenarioCollisionSummary(history: SimulationStep[]): { collided: boolean; collisionStep?: number } {
  const collisionIndex = history.findIndex((step) => step.collided);
  if (collisionIndex >= 0) {
    return { collided: true, collisionStep: collisionIndex + 1 };
  }
  return { collided: false };
}
