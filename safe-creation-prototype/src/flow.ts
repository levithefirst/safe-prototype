import { getAddress, isAddressEqual, type Address, type Hash, type Hex } from 'viem'
import { FALLBACK_DEPLOYMENT_GAS, RECEIPT_TIMEOUT_MS } from './config'
import { FlowError, toFlowError } from './errors'
import { buildPredictedSafe, type InitSafeKit, type SafeKit } from './safe'
import { assertOnBase, getCurrentAccount, type Eip1193Provider } from './wallet'

export interface PublicClientLike {
  getBalance(args: { address: Address }): Promise<bigint>
  getCode(args: { address: Address }): Promise<Hex | undefined>
  getGasPrice(): Promise<bigint>
  estimateGas(args: { account: Address; to: Address; data: Hex; value: bigint }): Promise<bigint>
  waitForTransactionReceipt(args: { hash: Hash; timeout?: number }): Promise<{ status: 'success' | 'reverted' }>
}

export type SendTransaction = (tx: { account: Address; to: Address; value: bigint; data: Hex }) => Promise<Hash>

export interface FlowDeps {
  provider: Eip1193Provider
  initKit: InitSafeKit
  publicClient: PublicClientLike
  sendTransaction: SendTransaction
}

export type VerifiedSafe = {
  safeAddress: Address
  owner: Address
  threshold: number
}

export type PreparedSafe =
  | {
      kind: 'ready'
      account: Address
      predictedAddress: Address
      balance: bigint
      estimatedCost: bigint
      hasEnoughEth: boolean
    }
  | { kind: 'exists'; account: Address; safe: VerifiedSafe }

export type DeployResult =
  | { kind: 'created'; safe: VerifiedSafe; txHash: Hash }
  | { kind: 'exists'; safe: VerifiedSafe }

export type DeployStatus = { stage: 'awaiting-wallet' } | { stage: 'confirming'; txHash: Hash }

function sameAddress(a: string, b: string): boolean {
  try {
    return isAddressEqual(a as Address, b as Address)
  } catch {
    return false
  }
}

function initKitFor(deps: FlowDeps, account: Address): Promise<SafeKit> {
  return deps.initKit({ provider: deps.provider, signer: account, predictedSafe: buildPredictedSafe(account) })
}

function toTx(tx: { to: string; value: string; data: string }) {
  return {
    to: tx.to as Address,
    value: BigInt(tx.value || '0'),
    data: tx.data as Hex
  }
}

/**
 * Verifies on-chain that `safeAddress` is a deployed 1-of-1 Safe owned by `owner`.
 * Throws a FlowError on any mismatch. Never returns unless every check passed.
 */
export async function verifySafe(
  kit: SafeKit,
  publicClient: PublicClientLike,
  safeAddress: Address,
  owner: Address,
  txHash?: Hash
): Promise<VerifiedSafe> {
  try {
    const code = await publicClient.getCode({ address: safeAddress })
    if (!code || code === '0x') throw new FlowError('NO_CODE', { txHash })

    const deployedKit = await kit.connect({ safeAddress })
    if (!(await deployedKit.isSafeDeployed())) throw new FlowError('NO_CODE', { txHash })
    if (!sameAddress(await deployedKit.getAddress(), safeAddress)) throw new FlowError('ADDRESS_MISMATCH', { txHash })

    const owners = await deployedKit.getOwners()
    const threshold = await deployedKit.getThreshold()

    if (owners.length !== 1 || !sameAddress(owners[0], owner)) throw new FlowError('OWNER_MISMATCH', { txHash })
    if (threshold !== 1) throw new FlowError('THRESHOLD_MISMATCH', { txHash })

    return { safeAddress: getAddress(safeAddress), owner: getAddress(owners[0]), threshold }
  } catch (err) {
    throw toFlowError(err, 'RPC_ERROR', txHash)
  }
}

/**
 * Predicts the Safe address for `account` and decides whether it can be deployed,
 * or whether it already exists (and is verified).
 */
export async function prepareSafe(deps: FlowDeps, account: Address): Promise<PreparedSafe> {
  try {
    await assertOnBase(deps.provider)

    const kit = await initKitFor(deps, account)
    const predictedAddress = getAddress(await kit.getAddress())

    if (await kit.isSafeDeployed()) {
      const safe = await verifySafe(kit, deps.publicClient, predictedAddress, account)
      return { kind: 'exists', account, safe }
    }

    const tx = toTx(await kit.createSafeDeploymentTransaction())
    const balance = await deps.publicClient.getBalance({ address: account })

    let gas: bigint
    try {
      gas = await deps.publicClient.estimateGas({ account, ...tx })
    } catch {
      gas = FALLBACK_DEPLOYMENT_GAS
    }
    const gasPrice = await deps.publicClient.getGasPrice()
    const estimatedCost = gas * gasPrice + tx.value

    return {
      kind: 'ready',
      account,
      predictedAddress,
      balance,
      estimatedCost,
      hasEnoughEth: balance > 0n && balance >= estimatedCost
    }
  } catch (err) {
    throw toFlowError(err)
  }
}

/**
 * Deploys the predicted Safe from the connected EOA and verifies it on-chain.
 * Resolves only with a verified Safe; every failure throws a FlowError.
 */
export async function deploySafe(
  deps: FlowDeps,
  params: { account: Address; predictedAddress: Address },
  onStatus: (status: DeployStatus) => void = () => {}
): Promise<DeployResult> {
  const { account, predictedAddress } = params
  let txHash: Hash | undefined

  try {
    // 1. Same account, still on Base.
    const current = await getCurrentAccount(deps.provider)
    if (!current || !sameAddress(current, account)) throw new FlowError('ACCOUNT_CHANGED')
    await assertOnBase(deps.provider)

    // 2-3. Same config must still produce the displayed address.
    const kit = await initKitFor(deps, account)
    if (!sameAddress(await kit.getAddress(), predictedAddress)) throw new FlowError('PREDICTION_CHANGED')

    // 4. Already deployed: verify, never send a second deployment.
    if (await kit.isSafeDeployed()) {
      const safe = await verifySafe(kit, deps.publicClient, predictedAddress, account)
      return { kind: 'exists', safe }
    }

    // 5-6. Build and send the factory deployment transaction.
    const tx = toTx(await kit.createSafeDeploymentTransaction())
    onStatus({ stage: 'awaiting-wallet' })
    txHash = await deps.sendTransaction({ account, ...tx })

    // 7-9. Wait for the receipt; a submitted tx is not success.
    onStatus({ stage: 'confirming', txHash })
    const receipt = await deps.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: RECEIPT_TIMEOUT_MS })
    if (receipt.status !== 'success') throw new FlowError('DEPLOY_REVERTED', { txHash })

    const safe = await verifySafe(kit, deps.publicClient, predictedAddress, account, txHash)
    return { kind: 'created', safe, txHash }
  } catch (err) {
    throw toFlowError(err, 'RPC_ERROR', txHash)
  }
}
