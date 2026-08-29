/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-workspace-tree`.
 * @module @deepseek-ai/dsh-client-ui-workspace-tree/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-workspace-tree'

/** Cordis companion plugin name. */
export const name = 'client-ui-workspace-tree-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin registers one workspace-tree column
 * occupant whose disposal the HMR-safety spec proves, and every listing it
 * shows is re-read from the Host on demand rather than held here.
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
