import { describe, expect, it, vi } from 'vitest'
import { FlowError } from './errors'
import { deploySafe, prepareSafe } from './flow'
import { buildPredictedSafe, initProtocolKit } from './safe'
import { FACTORY, OTHER, OWNER, PREDICTED, rpcError, setup, TX_HASH } from './test-helpers'

vi.mock('@safe-global/protocol-kit', () => ({ default: { init: vi.fn(async () => ({})) } }))

const params = { account: OWNER, predictedAddress: PREDICTED }

async function expectFlowError(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => {
      throw new Error('expected failure, got success')
    },
    (e) => e
  )
  expect(err).toBeInstanceOf(FlowError)
  expect(err.code).toBe(code)
  return err as FlowError
}

describe('predicted Safe config', () => {
  it('is owners=[wallet], threshold=1, saltNonce=0, safeVersion=1.4.1', () => {
    expect(buildPredictedSafe(OWNER)).toEqual({
      safeAccountConfig: { owners: [OWNER], threshold: 1 },
      safeDeploymentConfig: { saltNonce: '0', safeVersion: '1.4.1' }
    })
  })

  it('calls Safe.init with only provider, signer and predictedSafe (no contractNetworks, no isL1SafeSingleton)', async () => {
    const Safe = (await import('@safe-global/protocol-kit')).default
    const { provider } = setup()
    await initProtocolKit({ provider, signer: OWNER, predictedSafe: buildPredictedSafe(OWNER) })
    expect(Safe.init).toHaveBeenCalledWith({ provider, signer: OWNER, predictedSafe: buildPredictedSafe(OWNER) })
    const arg = vi.mocked(Safe.init).mock.calls[0][0]
    expect(arg).not.toHaveProperty('contractNetworks')
    expect(arg).not.toHaveProperty('isL1SafeSingleton')
  })

  it('uses the same config for prediction and deployment', async () => {
    const { deps, initKit } = setup()
    await prepareSafe(deps, OWNER)
    await deploySafe(deps, params)
    const configs = initKit.mock.calls.map((c) => c[0])
    expect(configs).toHaveLength(2)
    expect(configs[0]).toEqual(configs[1])
    expect(configs[0]).toMatchObject({ signer: OWNER, predictedSafe: buildPredictedSafe(OWNER) })
  })
})

describe('prepareSafe', () => {
  it('rejects the wrong chain before touching Protocol Kit', async () => {
    const { deps, walletState, initKit } = setup()
    walletState.chainId = '0xa'
    await expectFlowError(prepareSafe(deps, OWNER), 'WRONG_CHAIN')
    expect(initKit).not.toHaveBeenCalled()
  })

  it('returns the predicted address and ETH check', async () => {
    const { deps } = setup()
    const prepared = await prepareSafe(deps, OWNER)
    expect(prepared).toMatchObject({ kind: 'ready', predictedAddress: PREDICTED, hasEnoughEth: true })
  })

  it('blocks deployment when the wallet has no Base ETH', async () => {
    const { deps, publicClient } = setup()
    publicClient.getBalance.mockResolvedValue(0n)
    expect(await prepareSafe(deps, OWNER)).toMatchObject({ kind: 'ready', hasEnoughEth: false })
  })

  it('blocks deployment when balance is below the estimated gas cost', async () => {
    const { deps, publicClient } = setup()
    publicClient.getBalance.mockResolvedValue(1000n)
    expect(await prepareSafe(deps, OWNER)).toMatchObject({ kind: 'ready', hasEnoughEth: false })
  })

  it('treats an already-deployed matching Safe as existing', async () => {
    const { deps } = setup({ kitState: { deployed: true, owners: [OWNER], threshold: 1 } })
    expect(await prepareSafe(deps, OWNER)).toEqual({
      kind: 'exists',
      account: OWNER,
      safe: { safeAddress: PREDICTED, owner: OWNER, threshold: 1 }
    })
  })

  it('fails closed when an already-deployed Safe has a different owner', async () => {
    const { deps } = setup({ kitState: { deployed: true, owners: [OTHER], threshold: 1 } })
    await expectFlowError(prepareSafe(deps, OWNER), 'OWNER_MISMATCH')
  })

  it('maps RPC failures to an error, not a result', async () => {
    const { deps, publicClient } = setup()
    publicClient.getBalance.mockRejectedValue(new Error('fetch failed'))
    await expectFlowError(prepareSafe(deps, OWNER), 'RPC_ERROR')
  })
})

describe('deploySafe', () => {
  it('sends the Protocol Kit deployment tx and returns created only after verification', async () => {
    const { deps, sendTransaction, publicClient, kit } = setup()
    const onStatus = vi.fn()
    const result = await deploySafe(deps, params, onStatus)
    expect(sendTransaction).toHaveBeenCalledWith({ account: OWNER, to: FACTORY, value: 0n, data: '0x1688f0b9' })
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({ hash: TX_HASH }))
    expect(publicClient.getCode).toHaveBeenCalledWith({ address: PREDICTED })
    expect(kit.connect).toHaveBeenCalledWith({ safeAddress: PREDICTED })
    expect(onStatus).toHaveBeenLastCalledWith({ stage: 'confirming', txHash: TX_HASH })
    expect(result).toEqual({
      kind: 'created',
      txHash: TX_HASH,
      safe: { safeAddress: PREDICTED, owner: OWNER, threshold: 1 }
    })
  })

  it('compares owner addresses case-insensitively', async () => {
    expect(OWNER.toLowerCase()).not.toBe(OWNER)
    const { deps } = setup({ deployOnSend: { owners: [OWNER.toLowerCase()] } })
    await expect(deploySafe(deps, params)).resolves.toMatchObject({ kind: 'created' })
  })

  it('rejects the wrong chain and never sends', async () => {
    const { deps, walletState, sendTransaction } = setup()
    walletState.chainId = '0x1'
    await expectFlowError(deploySafe(deps, params), 'WRONG_CHAIN')
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('fails closed when the account changed', async () => {
    const { deps, walletState, sendTransaction } = setup()
    walletState.account = OTHER
    await expectFlowError(deploySafe(deps, params), 'ACCOUNT_CHANGED')
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('fails closed when the prediction no longer matches', async () => {
    const { deps, kitState, sendTransaction } = setup()
    kitState.address = OTHER
    await expectFlowError(deploySafe(deps, params), 'PREDICTION_CHANGED')
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('wallet rejection (4001) does not show success', async () => {
    const { deps, sendTransaction, publicClient } = setup()
    sendTransaction.mockRejectedValue(rpcError(4001, 'User rejected the request.'))
    const err = await expectFlowError(deploySafe(deps, params), 'TX_REJECTED')
    expect(err.message).toBe('Transaction rejected in wallet')
    expect(publicClient.waitForTransactionReceipt).not.toHaveBeenCalled()
  })

  it('wallet rejection wrapped by viem (cause chain) does not show success', async () => {
    const { deps, sendTransaction } = setup()
    sendTransaction.mockRejectedValue(new Error('wrapped', { cause: rpcError(4001) }))
    await expectFlowError(deploySafe(deps, params), 'TX_REJECTED')
  })

  it('insufficient funds does not show success', async () => {
    const { deps, sendTransaction } = setup()
    sendTransaction.mockRejectedValue(new Error('insufficient funds for gas * price + value'))
    const err = await expectFlowError(deploySafe(deps, params), 'INSUFFICIENT_FUNDS')
    expect(err.message).toBe('Not enough Base ETH to pay gas')
  })

  it('reverted receipt does not show success', async () => {
    const { deps, publicClient } = setup()
    publicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' })
    const err = await expectFlowError(deploySafe(deps, params), 'DEPLOY_REVERTED')
    expect(err.txHash).toBe(TX_HASH)
  })

  it('receipt RPC failure does not show success', async () => {
    const { deps, publicClient } = setup()
    publicClient.waitForTransactionReceipt.mockRejectedValue(new Error('fetch failed'))
    const err = await expectFlowError(deploySafe(deps, params), 'RPC_ERROR')
    expect(err.txHash).toBe(TX_HASH)
  })

  it('missing deployed code does not show success', async () => {
    const { deps, publicClient } = setup()
    publicClient.getCode.mockResolvedValue('0x')
    await expectFlowError(deploySafe(deps, params), 'NO_CODE')
  })

  it('undefined deployed code does not show success', async () => {
    const { deps, publicClient } = setup()
    publicClient.getCode.mockResolvedValue(undefined)
    await expectFlowError(deploySafe(deps, params), 'NO_CODE')
  })

  it('Protocol Kit reporting not deployed does not show success', async () => {
    const { deps } = setup({ deployOnSend: { deployed: false } })
    await expectFlowError(deploySafe(deps, params), 'NO_CODE')
  })

  it('owner mismatch does not show success', async () => {
    const { deps } = setup({ deployOnSend: { owners: [OTHER] } })
    await expectFlowError(deploySafe(deps, params), 'OWNER_MISMATCH')
  })

  it('extra owners do not show success', async () => {
    const { deps } = setup({ deployOnSend: { owners: [OWNER, OTHER] } })
    await expectFlowError(deploySafe(deps, params), 'OWNER_MISMATCH')
  })

  it('threshold mismatch does not show success', async () => {
    const { deps } = setup({ deployOnSend: { threshold: 2 } })
    await expectFlowError(deploySafe(deps, params), 'THRESHOLD_MISMATCH')
  })

  it('already-deployed predicted Safe is treated as existing, not redeployed', async () => {
    const { deps, sendTransaction, kit } = setup({ kitState: { deployed: true, owners: [OWNER], threshold: 1 } })
    const result = await deploySafe(deps, params)
    expect(result).toEqual({ kind: 'exists', safe: { safeAddress: PREDICTED, owner: OWNER, threshold: 1 } })
    expect(sendTransaction).not.toHaveBeenCalled()
    expect(kit.createSafeDeploymentTransaction).not.toHaveBeenCalled()
  })
})
