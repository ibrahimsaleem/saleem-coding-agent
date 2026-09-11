/**
 * Package-owned invariant companion for `@ibrahimsaleem/dsh-harness-factory`.
 * @module @ibrahimsaleem/dsh-harness-factory/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@ibrahimsaleem/dsh-harness-factory'

/** Cordis companion plugin name. */
export const name = 'harness-factory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the service holds no mutable in-memory authority. Each
 * call reads the roster fresh, writes a preset directory, and verifies it by
 * mounting — so there is no cached state whose relation to disk could drift.
 * The build path's own rollback is what keeps disk consistent, and it is
 * exercised directly by the package's tests rather than watched at runtime.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
