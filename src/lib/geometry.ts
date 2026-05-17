import type {
  CircleObstacle,
  Obstacle,
  Point,
  RectObstacle,
  VehiclePose,
  VehicleSpec,
} from "../types";

const EPSILON = 1e-9;

export function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

export function radToDeg(value: number): number {
  return (value * 180) / Math.PI;
}

export function rotatePoint(point: Point, angle: number, origin: Point = { x: 0, y: 0 }): Point {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(point: Point, factor: number): Point {
  return { x: point.x * factor, y: point.y * factor };
}

export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

export function carPolygon(spec: VehicleSpec, pose: VehiclePose): Point[] {
  const front = spec.wheelbase + spec.frontOverhang;
  const rear = spec.rearOverhang;
  const halfWidth = spec.width / 2;
  const localCorners: Point[] = [
    { x: front, y: -halfWidth },
    { x: front, y: halfWidth },
    { x: -rear, y: halfWidth },
    { x: -rear, y: -halfWidth },
  ];

  return localCorners.map((corner) => {
    const rotated = rotatePoint(corner, pose.heading);
    return { x: pose.x + rotated.x, y: pose.y + rotated.y };
  });
}

export function obstacleToPolygon(obstacle: RectObstacle): Point[] {
  const halfWidth = obstacle.width / 2;
  const halfHeight = obstacle.height / 2;
  const localCorners: Point[] = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ];

  return localCorners.map((corner) => {
    const rotated = rotatePoint(corner, obstacle.rotation);
    return { x: obstacle.x + rotated.x, y: obstacle.y + rotated.y };
  });
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a.x, b.x) - EPSILON <= p.x &&
    p.x <= Math.max(a.x, b.x) + EPSILON &&
    Math.min(a.y, b.y) - EPSILON <= p.y &&
    p.y <= Math.max(a.y, b.y) + EPSILON
  );
}

export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (Math.abs(o1) < EPSILON && onSegment(a1, a2, b1)) {
    return true;
  }
  if (Math.abs(o2) < EPSILON && onSegment(a1, a2, b2)) {
    return true;
  }
  if (Math.abs(o3) < EPSILON && onSegment(b1, b2, a1)) {
    return true;
  }
  if (Math.abs(o4) < EPSILON && onSegment(b1, b2, a2)) {
    return true;
  }

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + EPSILON) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

export function polygonsIntersect(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return pointInPolygon(a[0], b) || pointInPolygon(b[0], a);
}

export function closestPointOnSegment(point: Point, start: Point, end: Point): Point {
  const segment = subtract(end, start);
  const lengthSquared = dot(segment, segment);
  if (lengthSquared < EPSILON) {
    return start;
  }
  const t = clamp(dot(subtract(point, start), segment) / lengthSquared, 0, 1);
  return add(start, scale(segment, t));
}

export function pointToSegmentDistance(point: Point, start: Point, end: Point): { distance: number; point: Point } {
  const closest = closestPointOnSegment(point, start, end);
  return { distance: distance(point, closest), point: closest };
}

export function polygonDistance(a: Point[], b: Point[]): { distance: number; aPoint: Point; bPoint: Point } {
  if (polygonsIntersect(a, b)) {
    return { distance: 0, aPoint: a[0], bPoint: a[0] };
  }

  let best = {
    distance: Number.POSITIVE_INFINITY,
    aPoint: a[0],
    bPoint: b[0],
  };

  for (const point of a) {
    for (let i = 0; i < b.length; i += 1) {
      const start = b[i];
      const end = b[(i + 1) % b.length];
      const result = pointToSegmentDistance(point, start, end);
      if (result.distance < best.distance) {
        best = { distance: result.distance, aPoint: point, bPoint: result.point };
      }
    }
  }

  for (const point of b) {
    for (let i = 0; i < a.length; i += 1) {
      const start = a[i];
      const end = a[(i + 1) % a.length];
      const result = pointToSegmentDistance(point, start, end);
      if (result.distance < best.distance) {
        best = { distance: result.distance, aPoint: result.point, bPoint: point };
      }
    }
  }

  return best;
}

export function polygonCircleIntersect(polygon: Point[], circle: CircleObstacle): boolean {
  if (pointInPolygon({ x: circle.x, y: circle.y }, polygon)) {
    return true;
  }
  for (let i = 0; i < polygon.length; i += 1) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    const result = pointToSegmentDistance({ x: circle.x, y: circle.y }, start, end);
    if (result.distance <= circle.radius + EPSILON) {
      return true;
    }
  }
  return false;
}

export function polygonCircleDistance(
  polygon: Point[],
  circle: CircleObstacle,
): { distance: number; polygonPoint: Point; circlePoint: Point } {
  if (polygonCircleIntersect(polygon, circle)) {
    const center = { x: circle.x, y: circle.y };
    return { distance: 0, polygonPoint: center, circlePoint: center };
  }

  let best = {
    distance: Number.POSITIVE_INFINITY,
    polygonPoint: polygon[0],
    circlePoint: { x: circle.x, y: circle.y },
  };

  for (let i = 0; i < polygon.length; i += 1) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    const result = pointToSegmentDistance({ x: circle.x, y: circle.y }, start, end);
    const clearance = result.distance - circle.radius;
    if (clearance < best.distance) {
      const direction = subtract({ x: circle.x, y: circle.y }, result.point);
      const length = Math.max(distance(result.point, { x: circle.x, y: circle.y }), EPSILON);
      best = {
        distance: clearance,
        polygonPoint: result.point,
        circlePoint: {
          x: circle.x - (direction.x / length) * circle.radius,
          y: circle.y - (direction.y / length) * circle.radius,
        },
      };
    }
  }

  return best;
}

export function obstacleDistance(
  polygon: Point[],
  obstacle: Obstacle,
): { distance: number; collided: boolean; carPoint: Point; obstaclePoint: Point } {
  if (obstacle.kind === "rect") {
    const obstaclePolygon = obstacleToPolygon(obstacle);
    const result = polygonDistance(polygon, obstaclePolygon);
    return {
      distance: result.distance,
      collided: result.distance <= EPSILON,
      carPoint: result.aPoint,
      obstaclePoint: result.bPoint,
    };
  }

  const result = polygonCircleDistance(polygon, obstacle);
  return {
    distance: result.distance,
    collided: result.distance <= EPSILON,
    carPoint: result.polygonPoint,
    obstaclePoint: result.circlePoint,
  };
}

export function normalizeAngle(angle: number): number {
  let value = angle;
  while (value <= -Math.PI) {
    value += Math.PI * 2;
  }
  while (value > Math.PI) {
    value -= Math.PI * 2;
  }
  return value;
}

export function translateObstacle(obstacle: Obstacle, nextX: number, nextY: number): Obstacle {
  if (obstacle.kind === "rect") {
    return { ...obstacle, x: nextX, y: nextY };
  }
  return { ...obstacle, x: nextX, y: nextY };
}
