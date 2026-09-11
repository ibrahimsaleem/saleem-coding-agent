// A preset row that mounts successfully and does nothing else.
//
// It injects no service and publishes none, so it always activates and never
// trips the isolate-realm rule — which is what these tests want: the factory's
// copy/render/mount/roll-back pipeline is under test, not a plugin's behaviour.
// Import-free on purpose: the Loader resolves entry modules through Node's ESM
// resolver, which cannot see this workspace's TypeScript sources.
export const name = 'noop'

export function apply() {}
