import { useEffect, useMemo, useRef, useState } from "react";
import { SimulationCanvas } from "./components/SimulationCanvas";
import { scenarioTemplateName, createScenario, getDefaultVehicleSpec, vehiclePresets } from "./lib/scenarios";
import { evaluatePose, rebuildHistoryEvaluation, scenarioCollisionSummary, simulateStep } from "./lib/simulation";
import { clearPersistedState, fromImportFile, loadPersistedState, savePersistedState, toExportPayload } from "./lib/storage";
import type {
  ClearanceResult,
  ControlAction,
  EditorMode,
  Obstacle,
  PersistedState,
  Scenario,
  ScenarioLayout,
  ScenarioTemplateId,
  SimulationStep,
  VehiclePose,
  VehicleSpec,
} from "./types";
import { carPolygon, degToRad, obstacleDistance, radToDeg } from "./lib/geometry";

function createDefaultState(): PersistedState {
  const vehicleSpec = getDefaultVehicleSpec();
  const scenario = createScenario("garage-bay");
  return {
    version: 5,
    vehicleSpec,
    scenario,
    currentPose: scenario.vehicleStart,
    history: [],
  };
}

function syncVehicleSpec(nextSpec: VehicleSpec, changedKey: keyof VehicleSpec): VehicleSpec {
  if (changedKey === "length") {
    const frontOverhang = Math.max(0.2, nextSpec.length - nextSpec.wheelbase - nextSpec.rearOverhang);
    return {
      ...nextSpec,
      frontOverhang,
      length: nextSpec.wheelbase + nextSpec.rearOverhang + frontOverhang,
    };
  }

  if (changedKey === "wheelbase" || changedKey === "frontOverhang" || changedKey === "rearOverhang") {
    return {
      ...nextSpec,
      length: nextSpec.wheelbase + nextSpec.frontOverhang + nextSpec.rearOverhang,
    };
  }

  return nextSpec;
}

function formatDistance(value: number): string {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return `${value.toFixed(2)} m`;
}

function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const persisted = useMemo(() => loadPersistedState() ?? createDefaultState(), []);
  const [vehicleSpec, setVehicleSpec] = useState<VehicleSpec>(persisted.vehicleSpec);
  const [scenario, setScenario] = useState<Scenario>(persisted.scenario);
  const [currentPose, setCurrentPose] = useState<VehiclePose>(persisted.currentPose);
  const [history, setHistory] = useState<SimulationStep[]>(persisted.history);
  const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("obstacle");
  const [importError, setImportError] = useState<string>("");
  const [keyboardHint, setKeyboardHint] = useState<string>("方向键/WASD 可控制车辆");
  const importRef = useRef<HTMLInputElement | null>(null);
  const heldKeysRef = useRef<Set<string>>(new Set());
  const controlLoopRef = useRef<number | null>(null);

  useEffect(() => {
    savePersistedState({
      version: 5,
      vehicleSpec,
      scenario,
      currentPose,
      history,
    });
  }, [currentPose, history, scenario, vehicleSpec]);

  const currentClearance = useMemo<ClearanceResult>(
    () => evaluatePose(vehicleSpec, currentPose, scenario.obstacles),
    [currentPose, scenario.obstacles, vehicleSpec],
  );
  const highlightedClearances = useMemo(() => {
    const polygon = carPolygon(vehicleSpec, currentPose);
    const collidableObstacles = scenario.obstacles.filter((obstacle) => obstacle.collidable);
    return collidableObstacles
      .map((obstacle) => {
        const result = obstacleDistance(polygon, obstacle);
        return {
          obstacleId: obstacle.id,
          obstacleName: obstacle.name,
          distance: result.distance,
          collided: result.collided,
          carPoint: result.carPoint,
          obstaclePoint: result.obstaclePoint,
        };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);
  }, [currentPose, scenario.obstacles, vehicleSpec]);

  const collisionSummary = useMemo(() => scenarioCollisionSummary(history), [history]);
  const selectedObstacle = useMemo(
    () => scenario.obstacles.find((obstacle) => obstacle.id === selectedObstacleId) ?? null,
    [scenario.obstacles, selectedObstacleId],
  );

  function resetSimulation(nextScenario = scenario, nextPose = nextScenario.vehicleStart): void {
    setHistory([]);
    setCurrentPose(nextPose);
  }

  function applyScenario(nextScenario: Scenario): void {
    setScenario(nextScenario);
    setSelectedObstacleId((current) =>
      nextScenario.obstacles.some((obstacle) => obstacle.id === current) ? current : null,
    );
    resetSimulation(nextScenario, nextScenario.vehicleStart);
  }

  function handleTemplateChange(templateId: ScenarioTemplateId): void {
    applyScenario(createScenario(templateId));
  }

  function handleLayoutChange<K extends keyof ScenarioLayout>(key: K, value: number): void {
    const nextScenario = createScenario(scenario.templateId, {
      ...scenario.layout,
      [key]: value,
    });
    applyScenario(nextScenario);
  }

  function handleVehicleSpecChange<K extends keyof VehicleSpec>(key: K, value: VehicleSpec[K]): void {
    const nextSpec = syncVehicleSpec({ ...vehicleSpec, [key]: value }, key);
    setVehicleSpec(nextSpec);
    setHistory((current) => rebuildHistoryEvaluation(current, scenario, nextSpec));
  }

  function handleAction(action: ControlAction): void {
    if (action === "reset") {
      resetSimulation();
      setKeyboardHint("已重置轨迹");
      return;
    }
    const step = simulateStep(action, currentPose, vehicleSpec, scenario);
    setCurrentPose(step.pose);
    setHistory((current) => [...current, step]);
  }

  function handleUndo(): void {
    if (history.length === 0) {
      resetSimulation();
      setKeyboardHint("没有可撤销步骤");
      return;
    }
    const nextHistory = history.slice(0, -1);
    const nextPose = nextHistory[nextHistory.length - 1]?.pose ?? scenario.vehicleStart;
    setHistory(nextHistory);
    setCurrentPose(nextPose);
    setKeyboardHint("已撤销一步");
  }

  function clearTrajectoryOnly(): void {
    setHistory([]);
    setKeyboardHint("已清除轨迹，车辆保持当前位置");
  }

  function updateCurrentPose(nextPose: VehiclePose): void {
    setCurrentPose(nextPose);
    setHistory([]);
    setKeyboardHint("已自由拖动车辆位置");
  }

  function updateScenarioObstacle(nextObstacle: Obstacle): void {
    const nextScenario = {
      ...scenario,
      obstacles: scenario.obstacles.map((obstacle) => (obstacle.id === nextObstacle.id ? nextObstacle : obstacle)),
    };
    applyScenario(nextScenario);
  }

  function updateVehicleStart(nextPartial: Partial<VehiclePose>): void {
    const nextScenario = {
      ...scenario,
      vehicleStart: { ...scenario.vehicleStart, ...nextPartial },
    };
    applyScenario(nextScenario);
  }

  const matchedPresetId = vehiclePresets.find((preset) => preset.spec.id === vehicleSpec.id)?.id ?? "custom";

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const payload = await fromImportFile(file);
      setVehicleSpec(payload.vehicleSpec);
      setScenario(payload.scenario);
      setCurrentPose(payload.currentPose);
      setHistory(payload.history);
      setSelectedObstacleId(null);
      setImportError("");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "导入失败。");
    } finally {
      if (importRef.current) {
        importRef.current.value = "";
      }
    }
  }

  function handleHardReset(): void {
    clearPersistedState();
    const nextState = createDefaultState();
    setVehicleSpec(nextState.vehicleSpec);
    setScenario(nextState.scenario);
    setCurrentPose(nextState.currentPose);
    setHistory(nextState.history);
    setSelectedObstacleId(null);
    setEditorMode("obstacle");
    setImportError("");
    setKeyboardHint("已清除缓存并恢复默认场景");
  }

  useEffect(() => {
    function shouldIgnoreKeyboard(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      );
    }

    function runHeldKeys(): void {
      const keys = heldKeysRef.current;
      if (keys.has("arrowleft") || keys.has("a")) {
        handleAction("steer-left");
        setKeyboardHint("长按：持续左打方向");
      }
      if (keys.has("arrowright") || keys.has("d")) {
        handleAction("steer-right");
        setKeyboardHint("长按：持续右打方向");
      }
      if (keys.has("arrowup") || keys.has("w")) {
        handleAction("forward");
        setKeyboardHint("长按：持续前进");
      }
      if (keys.has("arrowdown") || keys.has("s")) {
        handleAction("reverse");
        setKeyboardHint("长按：持续倒车");
      }
    }

    function ensureLoop(): void {
      if (controlLoopRef.current !== null) {
        return;
      }
      controlLoopRef.current = window.setInterval(() => {
        if (heldKeysRef.current.size === 0) {
          return;
        }
        runHeldKeys();
      }, 120);
    }

    function stopLoopIfIdle(): void {
      if (heldKeysRef.current.size > 0) {
        return;
      }
      if (controlLoopRef.current !== null) {
        window.clearInterval(controlLoopRef.current);
        controlLoopRef.current = null;
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (shouldIgnoreKeyboard(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "arrowup" || key === "w") {
        event.preventDefault();
        heldKeysRef.current.add(key);
        ensureLoop();
        if (!event.repeat) {
          handleAction("forward");
          setKeyboardHint("键盘：前进一步");
        }
        return;
      }
      if (key === "arrowdown" || key === "s") {
        event.preventDefault();
        heldKeysRef.current.add(key);
        ensureLoop();
        if (!event.repeat) {
          handleAction("reverse");
          setKeyboardHint("键盘：倒车一步");
        }
        return;
      }
      if (key === "arrowleft" || key === "a") {
        event.preventDefault();
        heldKeysRef.current.add(key);
        ensureLoop();
        if (!event.repeat) {
          handleAction("steer-left");
          setKeyboardHint("键盘：左打方向");
        }
        return;
      }
      if (key === "arrowright" || key === "d") {
        event.preventDefault();
        heldKeysRef.current.add(key);
        ensureLoop();
        if (!event.repeat) {
          handleAction("steer-right");
          setKeyboardHint("键盘：右打方向");
        }
        return;
      }
      if (key === " " || key === "spacebar") {
        event.preventDefault();
        handleAction("steer-center");
        setKeyboardHint("键盘：方向回正");
        return;
      }
      if (key === "backspace") {
        event.preventDefault();
        handleUndo();
        return;
      }
      if (key === "r") {
        event.preventDefault();
        handleAction("reset");
        return;
      }
    }

    function handleKeyUp(event: KeyboardEvent): void {
      const key = event.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(key)) {
        heldKeysRef.current.delete(key);
        stopLoopIfIdle();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (controlLoopRef.current !== null) {
        window.clearInterval(controlLoopRef.current);
        controlLoopRef.current = null;
      }
    };
  }, [currentPose, history, scenario, vehicleSpec]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Parking Geometry Lab</p>
          <h1>停车场景模拟器</h1>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" onClick={() => downloadJson("parking-simulator.json", toExportPayload({
            version: 5,
            vehicleSpec,
            scenario,
            currentPose,
            history,
          }))}>
            导出 JSON
          </button>
          <button className="ghost-button" onClick={() => importRef.current?.click()}>
            导入 JSON
          </button>
          <button className="ghost-button" onClick={handleHardReset}>
            初始化场景
          </button>
          <input ref={importRef} type="file" accept="application/json" hidden onChange={handleImport} />
        </div>
      </header>

      <main className="workspace">
        <section className="panel left-panel">
          <div className="panel-block">
            <div className="block-header">
              <h2>场景模板</h2>
              <span>编辑场景会重置轨迹</span>
            </div>
            <label className="field">
              <span>模板</span>
              <select
                value={scenario.templateId}
                onChange={(event) => handleTemplateChange(event.target.value as ScenarioTemplateId)}
              >
                <option value="garage-bay">{scenarioTemplateName("garage-bay")}</option>
                <option value="narrow-exit">{scenarioTemplateName("narrow-exit")}</option>
              </select>
            </label>
            <div className="grid-fields">
              <label className="field">
                <span>车位宽度</span>
                <input
                  type="number"
                  min={2.3}
                  max={3.5}
                  step={0.05}
                  value={scenario.layout.slotWidth}
                  onChange={(event) => handleLayoutChange("slotWidth", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>车位深度</span>
                <input
                  type="number"
                  min={4.5}
                  max={7}
                  step={0.05}
                  value={scenario.layout.slotDepth}
                  onChange={(event) => handleLayoutChange("slotDepth", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>通道宽度</span>
                <input
                  type="number"
                  min={3.8}
                  max={7.5}
                  step={0.05}
                  value={scenario.layout.laneWidth}
                  onChange={(event) => handleLayoutChange("laneWidth", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>柱子尺寸</span>
                <input
                  type="number"
                  min={0.2}
                  max={0.8}
                  step={0.05}
                  value={scenario.layout.columnSize}
                  onChange={(event) => handleLayoutChange("columnSize", Number(event.target.value))}
                />
              </label>
            </div>
          </div>

          <div className="panel-block">
            <div className="block-header">
              <h2>车辆参数</h2>
              <span>可选预设后再微调</span>
            </div>
            <label className="field">
              <span>车型预设</span>
              <select
                value={matchedPresetId}
                onChange={(event) => {
                  if (event.target.value === "custom") {
                    return;
                  }
                  const preset = vehiclePresets.find((item) => item.id === event.target.value);
                  if (!preset) {
                    return;
                  }
                  setVehicleSpec({ ...preset.spec });
                  setHistory((current) => rebuildHistoryEvaluation(current, scenario, preset.spec));
                }}
              >
                <option value="custom">自定义参数</option>
                {vehiclePresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid-fields">
              <label className="field">
                <span>车长</span>
                <input
                  type="number"
                  step={0.01}
                  value={vehicleSpec.length}
                  onChange={(event) => handleVehicleSpecChange("length", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>车宽</span>
                <input
                  type="number"
                  step={0.01}
                  value={vehicleSpec.width}
                  onChange={(event) => handleVehicleSpecChange("width", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>轴距</span>
                <input
                  type="number"
                  step={0.01}
                  value={vehicleSpec.wheelbase}
                  onChange={(event) => handleVehicleSpecChange("wheelbase", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>前悬</span>
                <input
                  type="number"
                  step={0.01}
                  value={vehicleSpec.frontOverhang}
                  onChange={(event) => handleVehicleSpecChange("frontOverhang", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>后悬</span>
                <input
                  type="number"
                  step={0.01}
                  value={vehicleSpec.rearOverhang}
                  onChange={(event) => handleVehicleSpecChange("rearOverhang", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>最大转角</span>
                <input
                  type="number"
                  step={1}
                  value={vehicleSpec.maxSteeringDeg}
                  onChange={(event) => handleVehicleSpecChange("maxSteeringDeg", Number(event.target.value))}
                />
              </label>
            </div>
          </div>

          <div className="panel-block">
            <div className="block-header">
              <h2>编辑模式</h2>
              <span>拖拽画布中的对象</span>
            </div>
            <div className="segmented">
              <button
                className={editorMode === "obstacle" ? "active" : ""}
                onClick={() => setEditorMode("obstacle")}
              >
                障碍物
              </button>
              <button
                className={editorMode === "vehicle" ? "active" : ""}
                onClick={() => setEditorMode("vehicle")}
              >
                起始车位
              </button>
            </div>
            {editorMode === "vehicle" ? (
              <div className="grid-fields">
                <label className="field">
                  <span>起始 X</span>
                  <input
                    type="number"
                    step={0.05}
                    value={scenario.vehicleStart.x}
                    onChange={(event) => updateVehicleStart({ x: Number(event.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>起始 Y</span>
                  <input
                    type="number"
                    step={0.05}
                    value={scenario.vehicleStart.y}
                    onChange={(event) => updateVehicleStart({ y: Number(event.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>朝向角</span>
                  <input
                    type="number"
                    step={1}
                    value={radToDeg(scenario.vehicleStart.heading)}
                    onChange={(event) => updateVehicleStart({ heading: degToRad(Number(event.target.value)) })}
                  />
                </label>
              </div>
            ) : selectedObstacle ? (
              <div className="grid-fields">
                <label className="field">
                  <span>{selectedObstacle.name} X</span>
                  <input
                    type="number"
                    step={0.05}
                    value={selectedObstacle.x}
                    onChange={(event) => updateScenarioObstacle({ ...selectedObstacle, x: Number(event.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>{selectedObstacle.name} Y</span>
                  <input
                    type="number"
                    step={0.05}
                    value={selectedObstacle.y}
                    onChange={(event) => updateScenarioObstacle({ ...selectedObstacle, y: Number(event.target.value) })}
                  />
                </label>
                {selectedObstacle.kind === "rect" ? (
                  <>
                    <label className="field">
                      <span>宽度</span>
                      <input
                        type="number"
                        step={0.05}
                        min={0.1}
                        value={selectedObstacle.width}
                        onChange={(event) =>
                          updateScenarioObstacle({ ...selectedObstacle, width: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>高度</span>
                      <input
                        type="number"
                        step={0.05}
                        min={0.1}
                        value={selectedObstacle.height}
                        onChange={(event) =>
                          updateScenarioObstacle({ ...selectedObstacle, height: Number(event.target.value) })
                        }
                      />
                    </label>
                  </>
                ) : (
                  <label className="field">
                    <span>半径</span>
                    <input
                      type="number"
                      step={0.05}
                      min={0.1}
                      value={selectedObstacle.radius}
                      onChange={(event) =>
                        updateScenarioObstacle({ ...selectedObstacle, radius: Number(event.target.value) })
                      }
                    />
                  </label>
                )}
              </div>
            ) : (
              <p className="helper-text">点击画布中的柱子或墙体后，可在这里微调位置和尺寸。</p>
            )}
          </div>
        </section>

        <section className="center-stage">
          <div className="status-strip">
            <span>当前模板：{scenario.name}</span>
            <span>当前位置：({currentPose.x.toFixed(2)}, {currentPose.y.toFixed(2)})</span>
            <span>车头朝向：{radToDeg(currentPose.heading).toFixed(1)}°</span>
            <span>方向盘角：{currentPose.steeringDeg.toFixed(1)}°</span>
            <span>{keyboardHint}</span>
          </div>
          <SimulationCanvas
            scenario={scenario}
            spec={vehicleSpec}
            pose={currentPose}
            history={history}
            selectedObstacleId={selectedObstacleId}
            editorMode={editorMode}
            activeClearancePoints={highlightedClearances}
            onObstacleSelect={setSelectedObstacleId}
            onScenarioChange={applyScenario}
            onPoseChange={updateCurrentPose}
          />
          <div className="control-panel">
            <button className="drive-button" onClick={() => handleAction("reverse")}>
              倒车一步
            </button>
            <button className="drive-button" onClick={() => handleAction("forward")}>
              前进一步
            </button>
            <button className="drive-button secondary" onClick={() => handleAction("steer-left")}>
              左打方向
            </button>
            <button className="drive-button secondary" onClick={() => handleAction("steer-center")}>
              回正
            </button>
            <button className="drive-button secondary" onClick={() => handleAction("steer-right")}>
              右打方向
            </button>
            <button className="drive-button tertiary" onClick={handleUndo}>
              撤销一步
            </button>
            <button className="drive-button tertiary" onClick={clearTrajectoryOnly}>
              清除轨迹
            </button>
            <button className="drive-button tertiary" onClick={() => handleAction("reset")}>
              重置轨迹
            </button>
          </div>
        </section>

        <section className="panel right-panel">
          <div className="panel-block emphasis-block">
            <div className="block-header">
              <h2>风险分析</h2>
              <span>当前姿态实时检测</span>
            </div>
            <div className={`risk-card ${currentClearance.collided ? "risk" : collisionSummary.collided ? "warn" : "safe"}`}>
              <strong>{currentClearance.collided ? "已发生碰撞" : collisionSummary.collided ? "历史中发生过碰撞" : "当前安全"}</strong>
              <p>最近障碍：{currentClearance.obstacleName ?? "无"}</p>
              <p>最小间距：{formatDistance(currentClearance.distance)}</p>
              <p>累计步数：{history.length}</p>
            </div>
          </div>

          <div className="panel-block">
            <div className="block-header">
              <h2>当前解释</h2>
              <span>看会不会蹭柱子</span>
            </div>
            <ul className="fact-list">
              <li>橙色轨迹线：后轴中心路径。</li>
              <li>浅橙色区域：车身在整段运动中的扫掠包络。</li>
              <li>红色虚线：当前车身到最近几个关键障碍的距离。</li>
              <li>拖拽障碍或起始车位后，系统会自动清空轨迹重新模拟。</li>
              <li>键盘控制：W/S 前后，A/D 左右打轮，长按可持续控制，空格回正，Backspace 撤销，R 重置。</li>
            </ul>
          </div>

          <div className="panel-block">
            <div className="block-header">
              <h2>关键数据</h2>
              <span>实时更新</span>
            </div>
            <div className="metric-grid">
              <div className="metric">
                <span>车长</span>
                <strong>{vehicleSpec.length.toFixed(2)} m</strong>
              </div>
              <div className="metric">
                <span>车宽</span>
                <strong>{vehicleSpec.width.toFixed(2)} m</strong>
              </div>
              <div className="metric">
                <span>轴距</span>
                <strong>{vehicleSpec.wheelbase.toFixed(2)} m</strong>
              </div>
              <div className="metric">
                <span>步进长度</span>
                <strong>{vehicleSpec.stepDistance.toFixed(2)} m</strong>
              </div>
            </div>
          </div>

          <div className="panel-block">
            <div className="block-header">
              <h2>操作历史</h2>
              <span>{collisionSummary.collided ? `第 ${collisionSummary.collisionStep} 步首次碰撞` : "尚未碰撞"}</span>
            </div>
            <div className="history-list">
              {history.length === 0 ? (
                <p className="helper-text">还没有操作，先点击前进、倒车或调整方向。</p>
              ) : (
                history
                  .slice()
                  .reverse()
                  .map((step, index) => (
                    <div key={step.id} className={`history-item ${step.collided ? "collided" : ""}`}>
                      <strong>#{history.length - index}</strong>
                      <span>{step.action}</span>
                      <span>{step.clearance.obstacleName ?? "无障碍"}</span>
                      <span>{formatDistance(step.clearance.distance)}</span>
                    </div>
                  ))
              )}
            </div>
            {importError ? <p className="error-text">{importError}</p> : null}
          </div>
        </section>
      </main>
    </div>
  );
}
