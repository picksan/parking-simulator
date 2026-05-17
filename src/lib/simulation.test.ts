import { describe, expect, test } from "vitest";
import { createScenario, getDefaultVehicleSpec } from "./scenarios";
import { carPolygon, distance } from "./geometry";
import { advancePose, evaluatePose, simulateStep } from "./simulation";

describe("simulation core", () => {
  test("car polygon matches configured dimensions", () => {
    const spec = getDefaultVehicleSpec();
    const scenario = createScenario("garage-bay");
    const polygon = carPolygon(spec, scenario.vehicleStart);
    const width = distance(polygon[0], polygon[1]);
    expect(width).toBeCloseTo(spec.width, 5);
  });

  test("forward arc changes heading when steering is applied", () => {
    const spec = getDefaultVehicleSpec();
    const scenario = createScenario("garage-bay");
    const pose = { ...scenario.vehicleStart, steeringDeg: 20 };
    const samples = advancePose(pose, spec, spec.stepDistance);
    expect(samples[samples.length - 1]?.heading).not.toBeCloseTo(pose.heading, 6);
  });

  test("collision detection catches pillar contact", () => {
    const spec = getDefaultVehicleSpec();
    const scenario = createScenario("garage-bay");
    const targetPillar = scenario.obstacles.find((obstacle) => obstacle.id === "target-left-pillar");
    expect(targetPillar).toBeTruthy();
    const collisionPose = {
      ...scenario.vehicleStart,
      x: targetPillar!.x + 0.2,
      y: targetPillar!.y,
      heading: 0,
    };
    const clearance = evaluatePose(spec, collisionPose, scenario.obstacles);
    expect(clearance.collided).toBe(true);
  });

  test("simulate step returns a populated history sample list", () => {
    const spec = getDefaultVehicleSpec();
    const scenario = createScenario("narrow-exit");
    const step = simulateStep("forward", scenario.vehicleStart, spec, scenario);
    expect(step.samples.length).toBeGreaterThan(0);
  });
});
