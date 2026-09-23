# safe-creation-prototype

Standalone Vite + React + TypeScript app that deploys a new 1-of-1 Safe on Base mainnet (chainId 8453) from a browser wallet, then verifies it on-chain before it shows "Safe created".

- `@safe-global/protocol-kit@8.0.7`: `Safe.init({ provider, signer, predictedSafe })` → `getAddress()` → `createSafeDeploymentTransaction()`
- Safe `1.4.1`, SafeL2 (Protocol Kit default off Ethereum mainnet), `saltNonce: '0'`, owners `[connected EOA]`, threshold `1`
- No `contractNetworks`: Base addresses come from the bundled `@safe-global/safe-deployments` data
- Transaction sent with a viem wallet client over the injected EIP-1193 provider; receipt read from `https://mainnet.base.org`
- No backend, no API Kit, no Transaction Service, no env vars

The connected wallet pays the gas and needs Base ETH.

## Run

```sh
npm install
npm run dev
```

## Checks

```sh
npm test
npx tsc --noEmit
npm run lint
npm run build
```

## Layout

- `src/config.ts`: Base chain constants and Safe version/salt
- `src/wallet.ts`: EIP-1193 connect, switch/add Base chain
- `src/safe.ts`: predicted Safe config and the Protocol Kit init call
- `src/flow.ts`: prepare (predict + ETH check), deploy, on-chain verification
- `src/errors.ts`: fail-closed error codes and wallet error mapping
- `src/App.tsx`: the UI
