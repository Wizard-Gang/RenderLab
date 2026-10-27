// RenderLab's renderer-neutral core. It imports nothing outside src/core/ and no DOM, PixiJS or React API;
// `npm run check` enforces both (scripts/check-boundaries.mjs, tsconfig.core.json).
export { ContractError, Failures } from "./contracts/errors";
export { compareIds, isStableId, layerId, objectId, resourceId, sceneId } from "./contracts/ids";
export type { LayerId, ObjectId, ResourceId, SceneId } from "./contracts/ids";
export { IDENTITY_TRANSFORM } from "./contracts/values";
export type { Transform2D, Vec2 } from "./contracts/values";
export type { CameraBounds, CameraState } from "./camera/state";
export {
  clampCamera, clampCenter, computeView, DEFAULT_ZOOM_LIMITS, effectiveZoom, followStep, panBy, parallaxOffset, screenToWorld,
  shakeOffset, SMOOTH_SNAPPED, STRICT_PIXEL, worldToScreen, zoomAt,
} from "./camera/view";
export type { CameraView, PixelPolicy, ZoomLimits } from "./camera/view";
export type { AnimationState, Facing } from "./timeline/animation";
export { acceptSnapshot } from "./timeline/snapshot";
export type { EntityPresentation, EventParam, PresentationEvent, PresentationSnapshot } from "./timeline/snapshot";
export { CHUNK_CELLS, CHUNK_SIZE, MAX_SHAPE_POINTS, RESOURCE_KINDS } from "./scene/model";
export type {
  Appearance, CharacterObject, EffectObject, LayerDescriptor, Mobility, ParticlesObject, ResourceDescriptor, ResourceKind,
  SceneDefinition, SceneObject, SceneObjectKind, ShapeGeometry, ShapeObject, SourceRef, SpriteObject, TileCell, TileChunkObject,
} from "./scene/model";
export type { CellChange, LayerPatch, ObjectPatch, SceneChange, SceneDelta, SceneDirty } from "./scene/delta";
export { canonicalJson } from "./scene/data";
export { compareObjects, layerDrawOrder } from "./scene/order";
export { SceneStore } from "./scene/store";
export type { SceneSnapshot } from "./scene/store";
export { LifecycleError, RendererLifecycle } from "./lifecycle/state";
export type { LifecycleEvent, LifecycleOperation, LifecycleState } from "./lifecycle/state";
export { checkViewport, emptyDiagnostics } from "./lifecycle/runtime";
export type { ActiveBackend, Metric, RecoveryEvent, RendererBackend, RendererDiagnostics, RendererRuntime, Viewport } from "./lifecycle/runtime";
export { maxTextureEdge, webgl2Unavailable, webgpuUnavailable } from "./capabilities/model";
export type { Capabilities, WebGL2Capability, WebGPUAdapterInfo, WebGPUCapability } from "./capabilities/model";
export { AUTO_PREFERENCE, backendName, BackendSelectionError, planBackends, selectBackend } from "./capabilities/selection";
export type { BackendAttempt, BackendPlan } from "./capabilities/selection";
