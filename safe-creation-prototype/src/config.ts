export const BASE_CHAIN_ID = 8453
export const BASE_CHAIN_ID_HEX = '0x2105'
export const BASE_RPC_URL = 'https://mainnet.base.org'
export const BASE_EXPLORER_URL = 'https://basescan.org'

export const ADD_BASE_CHAIN_PARAMS = {
  chainId: BASE_CHAIN_ID_HEX,
  chainName: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [BASE_RPC_URL],
  blockExplorerUrls: [BASE_EXPLORER_URL]
}

export const SAFE_VERSION = '1.4.1' as const
// Must stay constant so the displayed prediction matches the deployed address.
export const SALT_NONCE = '0'

// Used only if eth_estimateGas fails. A 1-of-1 SafeL2 proxy deployment is ~260k gas.
export const FALLBACK_DEPLOYMENT_GAS = 300_000n

export const RECEIPT_TIMEOUT_MS = 180_000
