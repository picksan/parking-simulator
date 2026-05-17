import { createScenario, getDefaultVehicleSpec } from "./scenarios";
import type { PersistedState, ScenarioTemplateId, VehicleSpec } from "../types";

const STORAGE_KEY = "parking-simulator-state-v1";
const STORAGE_VERSION = 5;
const POSE_EPSILON = 1e-6;

function coerceVehicleSpec(input: unknown): VehicleSpec {
  const fallback = getDefaultVehicleSpec();
  if (!input || typeof input !== "object") {
    return fallback;
  }

  const candidate = input as Partial<VehicleSpec>;
  return {
    ...fallback,
    ...candidate,
  };
}

function migratePersistedState(raw: unknown): PersistedState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const parsed = raw as Partial<PersistedState> & {
    scenario?: { templateId?: ScenarioTemplateId; layout?: PersistedState["scenario"]["layout"] };
  };
  const templateId = parsed.scenario?.templateId ?? "garage-bay";
  const scenario = createScenario(templateId, parsed.scenario?.layout);
  const vehicleSpec = coerceVehicleSpec(parsed.vehicleSpec);

  return {
    version: STORAGE_VERSION,
    vehicleSpec,
    scenario,
    currentPose: scenario.vehicleStart,
    history: [],
  };
}

function matchesScenarioGeometry(state: PersistedState): boolean {
  const rebuilt = createScenario(state.scenario.templateId, state.scenario.layout);
  return (
    Math.abs(state.scenario.vehicleStart.x - rebuilt.vehicleStart.x) < POSE_EPSILON &&
    Math.abs(state.scenario.vehicleStart.y - rebuilt.vehicleStart.y) < POSE_EPSILON &&
    Math.abs(state.scenario.vehicleStart.heading - rebuilt.vehicleStart.heading) < POSE_EPSILON &&
    state.scenario.name === rebuilt.name
  );
}

export function loadPersistedState(): PersistedState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version === STORAGE_VERSION) {
      if (!matchesScenarioGeometry(parsed)) {
        return migratePersistedState(parsed);
      }
      return parsed;
    }
    return migratePersistedState(parsed);
  } catch {
    return null;
  }
}

export function savePersistedState(state: PersistedState): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...state,
      version: STORAGE_VERSION,
    }),
  );
}

export function clearPersistedState(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function toExportPayload(state: PersistedState): string {
  return JSON.stringify(state, null, 2);
}

export async function fromImportFile(file: File): Promise<PersistedState> {
  const text = await file.text();
  const parsed = JSON.parse(text) as PersistedState;
  if (parsed.version === STORAGE_VERSION) {
    return parsed;
  }
  const migrated = migratePersistedState(parsed);
  if (!migrated) {
    throw new Error("不支持的配置版本。");
  }
  return migrated;
}
