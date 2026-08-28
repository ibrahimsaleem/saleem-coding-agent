/** Saleem Harness occupants for the generic browser-brand slots. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SaleemBrandMark, SaleemBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill every shipped brand slot as one declaration-aware registration set.
 * Unlike the official pack, this registers unconditionally — it's the only
 * brand pack this build ships, so there's no `official`-profile gate to
 * check.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, SaleemBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, SaleemBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, SaleemBrandMark)
      })))
}
