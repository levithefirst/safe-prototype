import Safe, { type PredictedSafeProps } from '@safe-global/protocol-kit'
import { SAFE_VERSION, SALT_NONCE } from './config'
import type { Eip1193Provider } from './wallet'

/**
 * The single source of truth for the Safe we predict and deploy.
 * No fallbackHandler / to / data / payment fields: Protocol Kit defaults apply.
 */
export function buildPredictedSafe(owner: string): PredictedSafeProps {
  return {
    safeAccountConfig: {
      owners: [owner],
      threshold: 1
    },
    safeDeploymentConfig: {
      saltNonce: SALT_NONCE,
      safeVersion: SAFE_VERSION
    }
  }
}

export type DeploymentTransaction = { to: string; value: string; data: string }

/** The subset of the Protocol Kit `Safe` instance this app relies on. */
export interface SafeKit {
  getAddress(): Promise<string>
  isSafeDeployed(): Promise<boolean>
  getOwners(): Promise<string[]>
  getThreshold(): Promise<number>
  createSafeDeploymentTransaction(): Promise<DeploymentTransaction>
  connect(config: { safeAddress: string }): Promise<SafeKit>
}

export type InitSafeKitArgs = {
  provider: Eip1193Provider
  signer: string
  predictedSafe: PredictedSafeProps
}

export type InitSafeKit = (args: InitSafeKitArgs) => Promise<SafeKit>

/**
 * Protocol Kit v8 entry point. Deliberately passes no contractNetworks and no
 * isL1SafeSingleton: Base addresses (SafeL2 1.4.1) come from the bundled
 * @safe-global/safe-deployments data.
 */
export const initProtocolKit: InitSafeKit = ({ provider, signer, predictedSafe }) =>
  Safe.init({ provider, signer, predictedSafe })
