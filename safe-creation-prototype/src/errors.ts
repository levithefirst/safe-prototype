export type FlowErrorCode =
  | 'NO_WALLET'
  | 'NO_ACCOUNT'
  | 'WRONG_CHAIN'
  | 'SWITCH_REJECTED'
  | 'ADD_CHAIN_REJECTED'
  | 'TX_REJECTED'
  | 'INSUFFICIENT_FUNDS'
  | 'DEPLOY_REVERTED'
  | 'NO_CODE'
  | 'ADDRESS_MISMATCH'
  | 'OWNER_MISMATCH'
  | 'THRESHOLD_MISMATCH'
  | 'PREDICTION_CHANGED'
  | 'ACCOUNT_CHANGED'
  | 'RPC_ERROR'

export const ERROR_MESSAGES: Record<FlowErrorCode, string> = {
  NO_WALLET: 'Install a Base-compatible wallet',
  NO_ACCOUNT: 'No wallet account was shared with this app.',
  WRONG_CHAIN: 'Your wallet is not on Base. Switch to Base and try again.',
  SWITCH_REJECTED: 'Switching to Base was rejected in your wallet.',
  ADD_CHAIN_REJECTED: 'Adding the Base network was rejected in your wallet.',
  TX_REJECTED: 'Transaction rejected in wallet',
  INSUFFICIENT_FUNDS: 'Not enough Base ETH to pay gas',
  DEPLOY_REVERTED: 'The deployment transaction failed on-chain. No Safe was created.',
  NO_CODE: 'No Safe contract was found at the predicted address after the transaction.',
  ADDRESS_MISMATCH: 'The deployed Safe address does not match the predicted address.',
  OWNER_MISMATCH: 'The Safe owner does not match your connected wallet.',
  THRESHOLD_MISMATCH: 'The Safe threshold is not 1.',
  PREDICTION_CHANGED: 'The predicted Safe address changed. Reconnect and try again.',
  ACCOUNT_CHANGED: 'Your wallet account or network changed during the flow. Reconnect and try again.',
  RPC_ERROR: 'Network error while talking to Base. Please try again.'
}

export class FlowError extends Error {
  readonly code: FlowErrorCode
  readonly txHash?: string

  constructor(code: FlowErrorCode, options: { cause?: unknown; txHash?: string; detail?: string } = {}) {
    super(options.detail ? `${ERROR_MESSAGES[code]} (${options.detail})` : ERROR_MESSAGES[code], {
      cause: options.cause
    })
    this.name = 'FlowError'
    this.code = code
    this.txHash = options.txHash
  }
}

type ErrorLike = {
  code?: unknown
  message?: unknown
  shortMessage?: unknown
  details?: unknown
  name?: unknown
  cause?: unknown
  data?: { originalError?: unknown }
}

function* errorChain(err: unknown): Generator<ErrorLike> {
  const seen = new Set<unknown>()
  let current: unknown = err
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const e = current as ErrorLike
    yield e
    if (e.data?.originalError && typeof e.data.originalError === 'object') {
      yield* errorChain(e.data.originalError)
    }
    current = e.cause
  }
}

/** Returns true if any error in the cause chain has the given EIP-1193 / JSON-RPC code. */
export function hasErrorCode(err: unknown, code: number): boolean {
  for (const e of errorChain(err)) {
    if (e.code === code) return true
  }
  return false
}

export function isUserRejection(err: unknown): boolean {
  for (const e of errorChain(err)) {
    if (e.code === 4001 || e.code === 'ACTION_REJECTED' || e.name === 'UserRejectedRequestError') return true
  }
  return false
}

export function isInsufficientFunds(err: unknown): boolean {
  for (const e of errorChain(err)) {
    if (e.name === 'InsufficientFundsError') return true
    const text = [e.message, e.shortMessage, e.details].filter((t) => typeof t === 'string').join(' ')
    if (/insufficient funds/i.test(text)) return true
  }
  return false
}

export function toFlowError(err: unknown, fallback: FlowErrorCode = 'RPC_ERROR', txHash?: string): FlowError {
  if (err instanceof FlowError) return err
  if (isUserRejection(err)) return new FlowError('TX_REJECTED', { cause: err, txHash })
  if (isInsufficientFunds(err)) return new FlowError('INSUFFICIENT_FUNDS', { cause: err, txHash })
  return new FlowError(fallback, { cause: err, txHash })
}
