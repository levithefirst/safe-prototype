import { getAddress, type Address } from 'viem'
import { ADD_BASE_CHAIN_PARAMS, BASE_CHAIN_ID, BASE_CHAIN_ID_HEX } from './config'
import { FlowError, hasErrorCode, isUserRejection, toFlowError } from './errors'

export type RequestArguments = {
  readonly method: string
  readonly params?: readonly unknown[] | object
}

export interface Eip1193Provider {
  request(args: RequestArguments): Promise<unknown>
  on?(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
}

type InjectedEthereum = { request?: unknown; providers?: unknown[] }

function isEip1193Provider(value: unknown): value is Eip1193Provider {
  return !!value && typeof (value as Eip1193Provider).request === 'function'
}

/** window.ethereum, or the first EIP-1193 provider it exposes when several wallets are injected. */
export function getInjectedProvider(win: unknown = globalThis): Eip1193Provider | undefined {
  const ethereum = (win as { ethereum?: InjectedEthereum } | undefined)?.ethereum
  if (!ethereum) return undefined
  if (isEip1193Provider(ethereum)) return ethereum
  return ethereum.providers?.find(isEip1193Provider)
}

function firstAccount(accounts: unknown): Address | undefined {
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') return undefined
  return getAddress(accounts[0])
}

/** Prompts the wallet for access and returns the first account. */
export async function requestAccount(provider: Eip1193Provider): Promise<Address> {
  let accounts: unknown
  try {
    accounts = await provider.request({ method: 'eth_requestAccounts' })
  } catch (err) {
    if (isUserRejection(err)) throw new FlowError('NO_ACCOUNT', { cause: err, detail: 'connection rejected' })
    throw toFlowError(err)
  }
  const account = firstAccount(accounts)
  if (!account) throw new FlowError('NO_ACCOUNT')
  return account
}

/** Returns the currently authorised account without prompting, or undefined. */
export async function getCurrentAccount(provider: Eip1193Provider): Promise<Address | undefined> {
  try {
    return firstAccount(await provider.request({ method: 'eth_accounts' }))
  } catch (err) {
    throw toFlowError(err)
  }
}

export async function isOnBase(provider: Eip1193Provider): Promise<boolean> {
  let chainId: unknown
  try {
    chainId = await provider.request({ method: 'eth_chainId' })
  } catch (err) {
    throw toFlowError(err)
  }
  return typeof chainId === 'string' && Number.parseInt(chainId, 16) === BASE_CHAIN_ID
}

export async function assertOnBase(provider: Eip1193Provider): Promise<void> {
  if (!(await isOnBase(provider))) throw new FlowError('WRONG_CHAIN')
}

async function switchToBase(provider: Eip1193Provider): Promise<void> {
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_ID_HEX }] })
}

/** Switches the wallet to Base, adding the chain first if the wallet does not know it (4902). Fails closed. */
export async function ensureBaseChain(provider: Eip1193Provider): Promise<void> {
  if (await isOnBase(provider)) return

  try {
    await switchToBase(provider)
  } catch (err) {
    if (isUserRejection(err)) throw new FlowError('SWITCH_REJECTED', { cause: err })
    if (!hasErrorCode(err, 4902)) throw new FlowError('WRONG_CHAIN', { cause: err })

    try {
      await provider.request({ method: 'wallet_addEthereumChain', params: [ADD_BASE_CHAIN_PARAMS] })
    } catch (addErr) {
      if (isUserRejection(addErr)) throw new FlowError('ADD_CHAIN_REJECTED', { cause: addErr })
      throw new FlowError('WRONG_CHAIN', { cause: addErr })
    }

    try {
      await switchToBase(provider)
    } catch (switchErr) {
      if (isUserRejection(switchErr)) throw new FlowError('SWITCH_REJECTED', { cause: switchErr })
      throw new FlowError('WRONG_CHAIN', { cause: switchErr })
    }
  }

  await assertOnBase(provider)
}
