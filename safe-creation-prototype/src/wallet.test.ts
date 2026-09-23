import { describe, expect, it } from 'vitest'
import { ADD_BASE_CHAIN_PARAMS } from './config'
import { FlowError } from './errors'
import { mockProvider, OWNER, rpcError } from './test-helpers'
import { ensureBaseChain, getInjectedProvider, requestAccount } from './wallet'

describe('getInjectedProvider', () => {
  it('returns undefined when no wallet is injected', () => {
    expect(getInjectedProvider({})).toBeUndefined()
  })

  it('returns window.ethereum or the first injected EIP-1193 provider', () => {
    const { provider } = mockProvider()
    expect(getInjectedProvider({ ethereum: provider })).toBe(provider)
    expect(getInjectedProvider({ ethereum: { providers: [{}, provider] } })).toBe(provider)
  })
})

describe('requestAccount', () => {
  it('returns the first account from eth_requestAccounts', async () => {
    const { provider, calls } = mockProvider()
    await expect(requestAccount(provider)).resolves.toBe(OWNER)
    expect(calls[0].method).toBe('eth_requestAccounts')
  })

  it('fails when the wallet shares no accounts', async () => {
    const { provider } = mockProvider({ eth_requestAccounts: () => [] })
    await expect(requestAccount(provider)).rejects.toMatchObject({ code: 'NO_ACCOUNT' })
  })
})

describe('ensureBaseChain', () => {
  it('does nothing when already on Base', async () => {
    const { provider, calls } = mockProvider()
    await ensureBaseChain(provider)
    expect(calls.map((c) => c.method)).toEqual(['eth_chainId'])
  })

  it('switches to 0x2105 when on another chain', async () => {
    const { provider, state, calls } = mockProvider(
      {
        wallet_switchEthereumChain: () => {
          state.chainId = '0x2105'
          return null
        }
      },
      { chainId: '0x1', account: OWNER }
    )
    await ensureBaseChain(provider)
    expect(calls[1]).toEqual({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] })
  })

  it('adds Base on 4902 and switches again', async () => {
    let switches = 0
    const { provider, state, calls } = mockProvider(
      {
        wallet_switchEthereumChain: () => {
          switches++
          if (switches === 1) throw rpcError(4902, 'Unrecognized chain')
          state.chainId = '0x2105'
          return null
        },
        wallet_addEthereumChain: () => null
      },
      { chainId: '0x1', account: OWNER }
    )
    await ensureBaseChain(provider)
    expect(calls.map((c) => c.method)).toEqual([
      'eth_chainId',
      'wallet_switchEthereumChain',
      'wallet_addEthereumChain',
      'wallet_switchEthereumChain',
      'eth_chainId'
    ])
    expect(calls[2].params).toEqual([ADD_BASE_CHAIN_PARAMS])
  })

  it('rejects when the user refuses to switch', async () => {
    const { provider } = mockProvider(
      { wallet_switchEthereumChain: () => Promise.reject(rpcError(4001, 'User rejected')) },
      { chainId: '0x1', account: OWNER }
    )
    await expect(ensureBaseChain(provider)).rejects.toMatchObject({ code: 'SWITCH_REJECTED' })
  })

  it('rejects when the user refuses to add Base', async () => {
    const { provider } = mockProvider(
      {
        wallet_switchEthereumChain: () => Promise.reject(rpcError(4902)),
        wallet_addEthereumChain: () => Promise.reject(rpcError(4001))
      },
      { chainId: '0x1', account: OWNER }
    )
    await expect(ensureBaseChain(provider)).rejects.toMatchObject({ code: 'ADD_CHAIN_REJECTED' })
  })

  it('fails closed if the wallet claims success but is still on the wrong chain', async () => {
    const { provider } = mockProvider({ wallet_switchEthereumChain: () => null }, { chainId: '0x1', account: OWNER })
    const err = await ensureBaseChain(provider).catch((e) => e)
    expect(err).toBeInstanceOf(FlowError)
    expect(err.code).toBe('WRONG_CHAIN')
  })
})
