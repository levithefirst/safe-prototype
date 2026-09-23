import { vi } from 'vitest'
import { getAddress, type Address, type Hash } from 'viem'
import type { FlowDeps, PublicClientLike } from './flow'
import type { InitSafeKit, SafeKit } from './safe'
import type { Eip1193Provider, RequestArguments } from './wallet'

export const OWNER = getAddress('0x' + 'abcdef1234'.repeat(4))
export const OTHER = '0x2222222222222222222222222222222222222222' as Address
export const PREDICTED = '0x3333333333333333333333333333333333333333' as Address
export const FACTORY = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67' as Address
export const TX_HASH = ('0x' + 'ab'.repeat(32)) as Hash

export function rpcError(code: number, message = 'rpc error') {
  return Object.assign(new Error(message), { code })
}

type Handler = (args: RequestArguments) => unknown

export function mockProvider(overrides: Record<string, Handler> = {}, initial = { chainId: '0x2105', account: OWNER as string }) {
  const state = { ...initial }
  const calls: RequestArguments[] = []
  const defaults: Record<string, Handler> = {
    eth_requestAccounts: () => [state.account],
    eth_accounts: () => [state.account],
    eth_chainId: () => state.chainId
  }
  const provider: Eip1193Provider = {
    request: vi.fn(async (args: RequestArguments) => {
      calls.push(args)
      const handler = overrides[args.method] ?? defaults[args.method]
      if (!handler) throw new Error(`unexpected method ${args.method}`)
      return handler(args)
    })
  }
  return { provider, state, calls }
}

export type KitState = {
  address: string
  deployed: boolean
  owners: string[]
  threshold: number
}

export function mockKit(state: KitState): SafeKit {
  const kit: SafeKit = {
    getAddress: vi.fn(async () => state.address),
    isSafeDeployed: vi.fn(async () => state.deployed),
    getOwners: vi.fn(async () => state.owners),
    getThreshold: vi.fn(async () => state.threshold),
    createSafeDeploymentTransaction: vi.fn(async () => ({ to: FACTORY, value: '0', data: '0x1688f0b9' })),
    connect: vi.fn(async () => kit)
  }
  return kit
}

export function mockPublicClient() {
  return {
    getBalance: vi.fn<PublicClientLike['getBalance']>(async () => 10n ** 17n),
    getCode: vi.fn<PublicClientLike['getCode']>(async () => '0x6080'),
    getGasPrice: vi.fn<PublicClientLike['getGasPrice']>(async () => 10_000_000n),
    estimateGas: vi.fn<PublicClientLike['estimateGas']>(async () => 260_000n),
    waitForTransactionReceipt: vi.fn<PublicClientLike['waitForTransactionReceipt']>(async () => ({ status: 'success' }))
  }
}

/** Builds deps where the kit reflects deployment only after the wallet sends the tx. */
export function setup(opts: { kitState?: Partial<KitState>; deployOnSend?: Partial<KitState> } = {}) {
  const kitState: KitState = { address: PREDICTED, deployed: false, owners: [], threshold: 0, ...opts.kitState }
  const kit = mockKit(kitState)
  const initKit = vi.fn<InitSafeKit>(async () => kit)
  const { provider, state: walletState, calls } = mockProvider()
  const publicClient = mockPublicClient()
  const sendTransaction = vi.fn<FlowDeps['sendTransaction']>(async () => {
    Object.assign(kitState, { deployed: true, owners: [OWNER], threshold: 1 }, opts.deployOnSend)
    return TX_HASH
  })
  const deps: FlowDeps = { provider, initKit, publicClient, sendTransaction }
  return { deps, kit, kitState, initKit, provider, walletState, calls, publicClient, sendTransaction }
}
