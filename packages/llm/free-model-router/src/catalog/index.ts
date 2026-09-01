/**
 * Public catalog surface: the shipped free-platform data and the pi-ai
 * profile writer.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/catalog
 */

export type { FreePlatform, FreeModelDescriptor, FreeWireApi, DailyResetZone } from './types.ts'
export { FREE_PLATFORMS, findPlatform, LOCAL_FALLBACK_PLATFORM_ID } from './platforms.ts'
export {
  ROUTE_PREFIX,
  routeIdFor,
  routeIdsFor,
  isRouterRoute,
  credentialRefFor,
  platformToPiAiProfiles,
} from './profile-writer.ts'
