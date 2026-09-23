import { useCallback, useEffect, useRef, useState } from 'react'
import { formatEther, type Address, type Hash } from 'viem'
import { createFlowDeps } from './clients'
import { BASE_EXPLORER_URL } from './config'
import { FlowError, toFlowError } from './errors'
import { deploySafe, prepareSafe, type VerifiedSafe } from './flow'
import { ensureBaseChain, getCurrentAccount, getInjectedProvider, requestAccount, type Eip1193Provider } from './wallet'

type View =
  | { kind: 'disconnected' }
  | { kind: 'no-wallet' }
  | { kind: 'loading'; account?: Address }
  | { kind: 'ready'; account: Address; predictedAddress: Address; balance: bigint; hasEnoughEth: boolean }
  | { kind: 'deploying'; account: Address; predictedAddress: Address; txHash?: Hash }
  | { kind: 'created'; safe: VerifiedSafe; txHash: Hash }
  | { kind: 'exists'; safe: VerifiedSafe }
  | { kind: 'error'; message: string; txHash?: string }

function txLink(hash: string) {
  return (
    <a href={`${BASE_EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer">
      {hash}
    </a>
  )
}

function addressLink(address: string) {
  return (
    <a href={`${BASE_EXPLORER_URL}/address/${address}`} target="_blank" rel="noreferrer">
      {address}
    </a>
  )
}

export default function App() {
  const [provider] = useState<Eip1193Provider | undefined>(() => getInjectedProvider(window))
  const [view, setView] = useState<View>(() => (provider ? { kind: 'disconnected' } : { kind: 'no-wallet' }))
  // Every new run bumps this so results of a stale prediction are discarded.
  const runId = useRef(0)
  const deploying = useRef(false)

  const fail = useCallback((err: unknown) => {
    const flowErr = err instanceof FlowError ? err : toFlowError(err)
    console.error(flowErr, flowErr.cause)
    setView({ kind: 'error', message: flowErr.message, txHash: flowErr.txHash })
  }, [])

  const predict = useCallback(
    async (account: Address) => {
      if (!provider) return
      const id = ++runId.current
      setView({ kind: 'loading', account })
      try {
        const prepared = await prepareSafe(createFlowDeps(provider, account), account)
        if (id !== runId.current) return
        if (prepared.kind === 'exists') {
          setView({ kind: 'exists', safe: prepared.safe })
        } else {
          setView({
            kind: 'ready',
            account,
            predictedAddress: prepared.predictedAddress,
            balance: prepared.balance,
            hasEnoughEth: prepared.hasEnoughEth
          })
        }
      } catch (err) {
        if (id === runId.current) fail(err)
      }
    },
    [provider, fail]
  )

  const connect = useCallback(async () => {
    if (!provider) return
    const id = ++runId.current
    setView({ kind: 'loading' })
    try {
      const account = await requestAccount(provider)
      await ensureBaseChain(provider)
      if (id !== runId.current) return
      await predict(account)
    } catch (err) {
      if (id === runId.current) fail(err)
    }
  }, [provider, predict, fail])

  const createSafe = useCallback(async () => {
    if (!provider || view.kind !== 'ready' || deploying.current) return
    const { account, predictedAddress } = view
    const id = ++runId.current
    deploying.current = true
    setView({ kind: 'deploying', account, predictedAddress })
    try {
      const result = await deploySafe(createFlowDeps(provider, account), { account, predictedAddress }, (status) => {
        if (status.stage === 'confirming' && id === runId.current) {
          setView({ kind: 'deploying', account, predictedAddress, txHash: status.txHash })
        }
      })
      if (id !== runId.current) return
      setView(result.kind === 'created' ? { kind: 'created', safe: result.safe, txHash: result.txHash } : result)
    } catch (err) {
      if (id === runId.current) fail(err)
    } finally {
      deploying.current = false
    }
  }, [provider, view, fail])

  // Account or chain changed: discard the old prediction and recompute.
  useEffect(() => {
    if (!provider?.on) return
    const onChange = () => {
      if (deploying.current) {
        // Deployment is pinned to the original account; the flow itself re-checks before sending.
        return
      }
      runId.current++
      void (async () => {
        try {
          const account = await getCurrentAccount(provider)
          if (!account) {
            setView({ kind: 'disconnected' })
            return
          }
          await predict(account)
        } catch (err) {
          fail(err)
        }
      })()
    }
    provider.on('accountsChanged', onChange)
    provider.on('chainChanged', onChange)
    return () => {
      provider.removeListener?.('accountsChanged', onChange)
      provider.removeListener?.('chainChanged', onChange)
    }
  }, [provider, predict, fail])

  return (
    <main className="card">
      <h1>Create your Safe</h1>

      {view.kind === 'no-wallet' && <p className="error">Install a Base-compatible wallet</p>}

      {view.kind === 'disconnected' && (
        <>
          <p>Your Safe is a smart account controlled by your wallet.</p>
          <button onClick={connect}>Connect wallet</button>
        </>
      )}

      {view.kind === 'loading' && <p>{view.account ? 'Predicting your Safe address…' : 'Connecting wallet…'}</p>}

      {view.kind === 'ready' && (
        <>
          <dl>
            <dt>Wallet</dt>
            <dd>{view.account}</dd>
            <dt>Network</dt>
            <dd>Base</dd>
            <dt>Balance</dt>
            <dd>{formatEther(view.balance)} ETH</dd>
          </dl>
          <p>Your Safe will be created at:</p>
          <p className="address">{view.predictedAddress}</p>
          {view.hasEnoughEth ? (
            <button onClick={createSafe}>Create Safe</button>
          ) : (
            <>
              <p className="error">You need Base ETH in this wallet to pay the deployment transaction.</p>
              <button disabled>Create Safe</button>
            </>
          )}
        </>
      )}

      {view.kind === 'deploying' && (
        <>
          <p>Creating your Safe...</p>
          {view.txHash ? (
            <>
              <p>Waiting for confirmation...</p>
              <p className="mono">Transaction: {txLink(view.txHash)}</p>
            </>
          ) : (
            <p>Approve the transaction in your wallet...</p>
          )}
        </>
      )}

      {view.kind === 'created' && (
        <>
          <h2 className="success">Safe created</h2>
          <dl>
            <dt>Safe</dt>
            <dd>{addressLink(view.safe.safeAddress)}</dd>
            <dt>Owner</dt>
            <dd>{view.safe.owner}</dd>
            <dt>Threshold</dt>
            <dd>{view.safe.threshold} of 1</dd>
            <dt>Transaction</dt>
            <dd>{txLink(view.txHash)}</dd>
          </dl>
        </>
      )}

      {view.kind === 'exists' && (
        <>
          <h2 className="success">Safe already exists</h2>
          <dl>
            <dt>Safe</dt>
            <dd>{addressLink(view.safe.safeAddress)}</dd>
            <dt>Owner</dt>
            <dd>{view.safe.owner}</dd>
            <dt>Threshold</dt>
            <dd>{view.safe.threshold} of 1</dd>
          </dl>
        </>
      )}

      {view.kind === 'error' && (
        <>
          <p className="error">{view.message}</p>
          {view.txHash && <p className="mono">Transaction: {txLink(view.txHash)}</p>}
          <button onClick={connect}>Try again</button>
        </>
      )}
    </main>
  )
}
