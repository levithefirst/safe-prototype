import { createPublicClient, createWalletClient, custom, http, type Address } from 'viem'
import { base } from 'viem/chains'
import { BASE_RPC_URL } from './config'
import type { FlowDeps } from './flow'
import { initProtocolKit } from './safe'
import type { Eip1193Provider } from './wallet'

export const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC_URL) })

export function createFlowDeps(provider: Eip1193Provider, account: Address): FlowDeps {
  const walletClient = createWalletClient({ account, chain: base, transport: custom(provider) })
  return {
    provider,
    initKit: initProtocolKit,
    publicClient,
    sendTransaction: (tx) => walletClient.sendTransaction(tx)
  }
}
