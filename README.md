# TokenDis (TokenShoe) — Token Distribution on Arc

Project creators deploy a token distribution contract in **a single transaction** and distribute ERC-20 tokens to users. Three modes are supported:

| Mode              | Contract         | Type | Best for                                                                                            |
| ----------------- | ---------------- | ---- | --------------------------------------------------------------------------------------------------- |
| Merkle airdrop    | `TokenMerkleDis` | 0    | Fixed lists (100k+ addresses). Only the Merkle root lives on-chain; users claim with a proof        |
| Signature airdrop | `TokenSignDis`   | 1    | Lists that change (quests, allowlists, Web2 conditions). The backend signs each claim with EIP-712  |
| Vesting / unlock  | `TokenVesting`   | 2    | Investors / team / advisors: TGE unlock + cliff + linear (or stepped) release, optionally revocable |

Core promise: **creators can't take back what recipients are owed**. For airdrops, the creator can't withdraw anything before the claim window closes; for vesting, only the surplus not allocated to anyone can be withdrawn.

---

## Repository layout

```
contracts/                 Solidity contracts (Foundry)
  TokenDisBase.sol         Shared base: fund, pause, withdraw, two-step creator transfer
  TokenShoeFactory.sol     Factory: clones project contracts with EIP-1167 minimal proxies + CREATE2
  TokenMerkleDis.sol       Merkle airdrop
  TokenSignDis.sol         EIP-712 signature airdrop
  TokenVesting.sol         Vesting / unlock
  TestTokenFactory.sol     Testnet helper: anyone can mint a 100M test ERC-20 to try the platform
  script/Deploy.s.sol      Deploy script (3 implementations + factory, registers types 0/1/2, self-checks, writes deployments/)
  test/                    Foundry unit tests
  TokenDis-design.md       Contract design doc (the most detailed business description)
web/                       Website: Next.js 14 (pages + API routes) + Postgres + Drizzle
  src/app/                 Pages (/, /explore, /create, /claim, /projects, /projects/[address])
  src/app/api/             All API routes
  src/components/          UI (create/ wizard, project/ projects & claiming, ui/ primitives, charts/)
  src/hooks/               useChainTx (send tx -> sync), useAuth (wallet sign-in), queries (data fetching)
  src/config/chain.ts      Chain and factory address (shared by frontend and backend)
  src/db/schema.ts         Database schema
  src/lib/tx-processor.ts  Transaction sync core
  scripts/e2e.ts           API end-to-end test (41 checks)
  scripts/ui-e2e.ts        Browser end-to-end test (18 checks, drives real Chrome)
deploy.sh                  One-command contract deployment (reads .env)
deployments/               Deployed addresses per chain (<chainId>.json)
lib/                       Git submodules: forge-std, OpenZeppelin (pinned to 5.1.0 because Arc runs the Paris hardfork)
```

---

## Deploying the contracts

One command deploys the 3 implementation contracts + the factory, registers everything, and deploys the `TestTokenFactory` testnet helper:

```bash
cp .env.example .env        # fill in PRIVATE_KEY (deployer wallet private key)
./deploy.sh                 # deploy to Arc testnet
```

**The deployer wallet needs Arc testnet USDC for gas** (gas on Arc is paid in USDC). Faucet: https://faucet.circle.com. The whole deployment is about 8–9 transactions.

`deploy.sh` will:

1. Check `.env`, the private key format, RPC connectivity and the wallet balance (fails early if it's empty)
2. Compile and **dry-run** the deployment (nothing sent on-chain), showing estimated gas
3. Deploy for real after you type `yes` (waits for each transaction)
4. **Verify against on-chain state**: all three types registered correctly and the owner is correct; any mismatch is an error
5. Write `deployments/<chainId>.json` (record of all addresses)
6. Write the new addresses into `web/.env.local` (`NEXT_PUBLIC_FACTORY_ADDRESS`, `MERKLE_IMPL`, `SIGN_IMPL`, `VESTING_IMPL`, `NEXT_PUBLIC_TEST_TOKEN_FACTORY`; all other settings untouched) and regenerate the address table in `AGENTS.md`

| `.env` variable             | Required | Description                                                                                                                                                                                                                 |
| --------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRIVATE_KEY`               | ✅       | Deployer wallet private key (with or without 0x)                                                                                                                                                                            |
| `ARC_TESTNET_RPC_URL`       | No       | Defaults to `https://rpc.testnet.arc.io`                                                                                                                                                                                    |
| `FACTORY_OWNER`             | No       | Final factory owner (e.g. a multisig). Empty = the deployer wallet. If set, the deployer registers the implementations first and then starts the transfer; **that address must call `acceptOwnership()` once** to take over |
| `DEPLOY_TEST_TOKEN_FACTORY` | No       | Default `true`. Set to `false` to skip the test token helper (e.g. on mainnet); the site then hides the feature                                                                                                             |

Other usages: `./deploy.sh local` (deploy to local anvil), `./deploy.sh -y` (skip confirmation), `./deploy.sh -h` (help).

**After deploying:**

- Restart the site; production needs a rebuild because `NEXT_PUBLIC_*` values are baked into the frontend at build time
- Project data from an old factory in the database is no longer useful; reset the database
- Update the production server's environment variables with the new addresses

### Current deployment (Arc Testnet, chainId 5042002)

Deployed 2026-10-17 by `0xa30Db5ee76e7d4b2B5F8048518EE160B559A56f9` (also the factory owner). Source of truth: `deployments/5042002.json`; the code defaults (`web/src/config/chain.ts`, `web/src/lib/env.ts`) point here too.

| Contract | Address |
|---|---|
| TokenShoeFactory | [`0x865F2f2c7b9D557AEa92f70e8eF05E287E7d00b8`](https://explorer.testnet.arc.io/address/0x865F2f2c7b9D557AEa92f70e8eF05E287E7d00b8) |
| TokenMerkleDis (impl, type 0) | [`0xAc68198e66f46920125D48fAfA978c5067cE4B15`](https://explorer.testnet.arc.io/address/0xAc68198e66f46920125D48fAfA978c5067cE4B15) |
| TokenSignDis (impl, type 1) | [`0x17968730099016e6679911Ad62603e337d3dcc75`](https://explorer.testnet.arc.io/address/0x17968730099016e6679911Ad62603e337d3dcc75) |
| TokenVesting (impl, type 2) | [`0xC4e6Da6235190422E6BC4d3D7a1E0DEd412E3877`](https://explorer.testnet.arc.io/address/0xC4e6Da6235190422E6BC4d3D7a1E0DEd412E3877) |
| TestTokenFactory (testnet helper) | [`0x6F846226c060792d2B4934bF9F83760423811eAd`](https://explorer.testnet.arc.io/address/0x6F846226c060792d2B4934bF9F83760423811eAd) |

All three implementations are registered on the factory (verified on-chain). The broadcast log of this deployment is in `broadcast/Deploy.s.sol/5042002/`.

> `contracts/contract-metadata/*.json` describe an **earlier, unused deployment** (factory `0x5b69…4e8a`, implementations never registered). They are kept for history only; nothing reads them.

---

## Business flow

1. The creator calls `approve(factory, amount)` on the token.
2. The creator calls `factory.createProject(type, token, amount, userSalt, initData)`: the factory clones the implementation -> transfers the tokens in -> initializes it.
   - The project address can be computed in advance: `predictAddress(type, creator, userSalt)`, with salt = `keccak256(creator, userSalt)`.
3. Anyone can call `fund(amount)` to add more tokens.
4. Recipients claim (anyone may pay the gas for a claim, but tokens always go to the listed address).
5. The creator calls `withdraw(to, amount)` to recover the recoverable portion.

### Contract function reference

**Factory `TokenShoeFactory`**
| Function | Caller | Purpose |
|---|---|---|
| `setImplementation(type, impl)` | Platform owner | Register / replace the implementation for a type (affects only projects created afterwards) |
| `createProject(type, token, amount, userSalt, initData)` -> `proxy` | Anyone | Create a project; returns the project contract address |
| `predictAddress(type, creator, userSalt)` -> `address` | View | Predict the project address |
| `projectsOf(creator, i)` / `projectCountOf(creator)` / `allProjects(i)` / `allProjectsCount()` | View | List projects |

**Shared base `TokenDisBase` (all three project types)**
| Function | Caller | Purpose |
|---|---|---|
| `fund(amount)` | Anyone | Add tokens |
| `pause()` / `unpause()` | Creator | Pause claims (for airdrops, the end time is extended by the paused duration) |
| `withdraw(to, amount)` | Creator | Withdraw the recoverable portion; reverts with `RecoverableExceeded` if too much |
| `transferCreator(new)` -> `acceptCreator()` | Creator -> new creator | Two-step transfer of project ownership |
| `token() / creator() / totalFunded() / totalClaimed()` | View | Basic info |

**Merkle airdrop `TokenMerkleDis`** — initData = `(bytes32 root, uint64 startTime, uint64 endTime)`

- `claim(index, account, amount, proof)`: leaf = `keccak256(keccak256(abi.encode(index, account, amount)))` (same as `StandardMerkleTree` from `@openzeppelin/merkle-tree`)
- `setRoot(newRoot)`: only before the start time
- `isClaimed(index)`, `effectiveEndTime()` (includes pause extensions)

**Signature airdrop `TokenSignDis`** — initData = `(address signer, uint64 startTime, uint64 endTime)`

- `claim(account, amount, claimId, deadline, sig)`: EIP-712 domain `name="TokenSignDis", version="1"`; struct `ClaimRequest(address account,uint256 amount,bytes32 claimId,uint256 deadline)`; each `claimId` can be used only once
- `setSigner(new)`: the creator rotates the signer key

**Vesting `TokenVesting`** — initData = `Schedule[]`

- Unlock formula: 0 before TGE -> TGE share from TGE until the cliff ends -> then linear (stepped when `interval > 0`) -> everything after the end
- `claim(ids[])`: the beneficiary claims several schedules at once
- `addSchedules(list)`: the creator adds schedules (the contract balance must cover them)
- `revoke(id)`: revoke a revocable schedule; what has already unlocked still belongs to the beneficiary
- `claimable(id)` / `schedulesOf(addr)` / `getSchedule(id)`

**Test tokens `TestTokenFactory`** (testnet helper, not part of the distribution protocol)

- `createToken(name, symbol)` -> `token`: deploys a standard ERC-20 (18 decimals, fixed supply) and mints **100,000,000** tokens to the caller. Name 1–50 bytes, symbol 1–11 bytes
- `tokensOf(creator)` / `tokenCountOf(creator)` / `allTokens(i)` / `allTokensCount()`: list created tokens
- Event `TokenCreated(token, creator, name, symbol, supply)`

---

## Website pages

| Page                  | For                | Features                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` Home              | Everyone           | Platform stats (projects, claims, claimers, recipients), 30-day trend chart (switch between claims / new claimers / new projects, with table view), latest projects                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/explore`            | Everyone           | All projects, filterable by type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/test-token`         | Anyone testing     | Mint a free test ERC-20 (name + symbol -> 100,000,000 tokens in your wallet), list your test tokens, add them to the wallet, and "Distribute" one straight into the create wizard. Linked from the home page under the hero buttons                                                                                                                                                                                                                                                                                                                                                                               |
| `/create`             | Creators           | 5-step wizard: type -> token (symbol, decimals and balance read automatically) -> list & parameters -> project details -> deploy. **Merkle**: drop in a CSV to build the list; **Signature**: generate a brand-new signer key in one click (backup download available), optionally upload the list too; **Vesting**: enter manually or upload a CSV. No token yet? The Token step has a "Don't have a token yet?" panel that mints a test token and fills in its address. `/create?token=0x…` pre-fills the token. Deploy skips approval when the allowance is already enough and syncs the backend automatically |
| `/claim`              | Recipients         | Connect a wallet to see everything claimable (all three types in one place) and claim in one click; "Completed" and "History" tabs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/projects`           | Creators           | Projects I created                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/projects/[address]` | Everyone / creator | Stats, claim window, my allocation (claim directly), claims, timeline, recipient list / vesting schedules. **Creators get an extra Manage tab**: top up, pause/resume, withdraw (shows how much is withdrawable now), edit details; Merkle: replace the list before start; Signature: add/edit/remove recipients live, provide or rotate the signer key; Vesting: revoke and add schedules                                                                                                                                                                                                                        |

**Wallet network check**: wallets send transactions through the RPC URL saved in the wallet, not the site's. If a user added Arc Testnet with a dead RPC (e.g. `rpc.testnet.arc.network`), every transaction fails with an opaque "Requested resource not available". So when a wallet connects, and again before every transaction, the site asks the wallet for the chain id and latest block. If that fails, it calls `wallet_addEthereumChain` with `https://rpc.testnet.arc.io` (MetaMask then asks the user to add/switch to that RPC; once per address per session on connect). If it still fails, a banner under the nav explains how to set the RPC manually. Logic: `web/src/lib/client/walletNetwork.ts` (unit tests: `bun run test`), `web/src/hooks/useWalletNetwork.tsx`.

**No lost transactions**: every transaction is synced to the backend after it is mined. If syncing fails (for example, the user closes the page), the transaction hash is saved in the browser and synced automatically the next time the site is opened.

## Backend (`web/`, Next.js 14 App Router + Postgres + Drizzle)

### Core idea: no indexer — the frontend reports each transaction

```
User acts in the frontend -> wallet sends tx -> tx mined -> frontend POST /api/tx { txHash }
                                                     |
             backend reads the receipt -> decodes factory/project events -> writes data + stats in one DB transaction
```

- Data **only comes from on-chain events**; the frontend can't inject fake data (e.g. lie about a claimed amount).
- The same transaction is processed only once no matter how often it's submitted (`processed_txs` table), so the frontend can retry safely.
- If a claim/fund transaction for a project arrives before that project's creation tx is synced, the backend recognises the project as "ours" from its bytecode and returns `409 PROJECT_NOT_SYNCED` instead of losing data.
- Assumption: users act through our frontend. Transactions sent directly to the contracts can still be added by submitting their txHash to `/api/tx`.

### End-to-end flow for each mode

**Merkle airdrop**

1. Creator signs in -> `POST /api/merkle/trees` uploads a CSV (`address,amount`) -> gets the `root`
2. Frontend encodes initData from `root` + start/end time -> `approve` -> `createProject(0, ...)`
3. `POST /api/tx { txHash, meta: { name, ... } }`
4. Recipient: `GET /api/projects/:addr/merkle-proof?account=` -> contract `claim(index, account, amount, proof)` -> `POST /api/tx`
5. (Optional) replace the list before start: upload again -> contract `setRoot(newRoot)` -> `POST /api/tx`

**Signature airdrop**

1. Frontend generates a **brand-new private key** for the creator (or the creator provides one) -> `GET /api/sign/check-signer?address=` confirms it has no funds and no transactions
2. Encode initData with its address as signer -> `approve` -> `createProject(1, ...)`
3. `POST /api/tx { txHash, meta, signerPrivateKey }`: the backend checks the key's address equals the on-chain signer and the account is fresh, then **stores it encrypted**
4. Creator manages the list at any time: `POST .../sign/allocations` uploads a CSV (`merge` / `replace`), `PUT` edits one, `DELETE` removes one
5. Recipient: `POST /api/projects/:addr/sign/request { account }` gets a signature -> contract `claim(...)` -> `POST /api/tx`
6. If the creator raises the allocation of someone who already claimed, they can claim the difference (each claim uses a new claimId)

**Vesting**

1. (Optional) `POST /api/vesting/parse` uploads a schedule CSV -> gets `initData`
2. `approve` -> `createProject(2, ...)` -> `POST /api/tx`
3. Beneficiary: `GET /api/accounts/:me/claimable` shows what each schedule can claim now -> contract `claim(ids)` -> `POST /api/tx`
4. After the creator's `revoke(id)` / `addSchedules(list)`, likewise `POST /api/tx`

### Sign-in (only needed for creator management actions)

SIWE (Sign-In With Ethereum, EIP-4361): sign once, valid for 24 hours:

1. `GET /api/auth/nonce` -> `{ nonce }`
2. Frontend builds the message with `createSiweMessage({ address, chainId, domain, nonce, uri, version: '1' })` from `viem/siwe` and the wallet signs it (`signMessage`)
3. `POST /api/auth/login { message, signature }` -> sets an HttpOnly cookie
4. `GET /api/auth/me` returns the signed-in address; `POST /api/auth/logout` signs out

Contract wallets (multisigs, ERC-1271) are supported.

### API reference

All errors use `{ error: { code, message, details } }`; the frontend can branch on `code`. List endpoints accept `?page=1&pageSize=20` (max 100). Amounts are always **base-unit (wei) strings**.

| Endpoint                                                   | Auth      | Description                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/tx`                                             | None      | **Sync a transaction**. Body: `txHash`, optional `meta` (name, description, logoUrl, website, twitter, telegram), optional `signerPrivateKey`. Returns `status` (`processed` / `already_processed` / `no_relevant_events`), `events`, `projectsCreated`, `warnings` |
| `GET /api/projects`                                        | None      | Project list, filter with `?creator=&type=`                                                                                                                                                                                                                         |
| `GET /api/projects/:addr`                                  | None      | Project details: funds, time window, `status` (upcoming/active/paused/ended), `effectiveEndTime`, `stats`; signature airdrops also include `signerReady`                                                                                                            |
| `PATCH /api/projects/:addr`                                | Creator   | Update display info                                                                                                                                                                                                                                                 |
| `GET /api/projects/:addr/claims`                           | None      | Project claims, filter with `?account=`                                                                                                                                                                                                                             |
| `GET /api/projects/:addr/activities`                       | None      | Project timeline (created, funded, withdrawn, paused, root replaced, signer changed, schedules added, revoked, transferred)                                                                                                                                         |
| `GET /api/projects/:addr/eligibility?account=`             | None      | How much an address can claim in this project                                                                                                                                                                                                                       |
| `GET /api/projects/:addr/vesting/schedules`                | None      | All schedules of a vesting project, with unlocked and claimable amounts                                                                                                                                                                                             |
| `POST /api/merkle/trees`                                   | Signed in | Upload a Merkle list CSV. Form: `file`, `token` (or `decimals`), `unit` (`token` default / `wei`). Returns `root`, `totalEntries`, `totalAmount`                                                                                                                    |
| `GET /api/merkle/trees/:root`                              | None      | View a list                                                                                                                                                                                                                                                         |
| `GET /api/projects/:addr/merkle-proof?account=`            | None      | Get the claim proof                                                                                                                                                                                                                                                 |
| `GET /api/sign/check-signer?address=`                      | None      | Check that a signer account is brand new and empty                                                                                                                                                                                                                  |
| `GET/POST/PUT/DELETE /api/projects/:addr/sign/allocations` | Creator   | Signature airdrop list: view + summary / upload CSV (`mode=merge`/`replace`) / edit one / remove one                                                                                                                                                                |
| `POST /api/projects/:addr/sign/signer`                     | Creator   | Provide or replace the signer key (to rotate: `setSigner` on-chain first, sync that tx, then call this)                                                                                                                                                             |
| `POST /api/projects/:addr/sign/request`                    | None      | Recipient requests a claim signature; returns `amount, claimId, deadline, signature`                                                                                                                                                                                |
| `POST /api/vesting/parse`                                  | None      | Vesting CSV -> `schedules` + `initData`                                                                                                                                                                                                                             |
| `GET /api/accounts/:addr/claimable`                        | None      | **What can I claim**: projects of all three types in one list, claimable first                                                                                                                                                                                      |
| `GET /api/accounts/:addr/claims`                           | None      | My claim history                                                                                                                                                                                                                                                    |
| `GET /api/stats`                                           | None      | Platform stats: projects (per type), creators, claims, claimers, total recipients                                                                                                                                                                                   |
| `GET /api/stats/daily?days=30`                             | None      | Daily new projects / claims / new claimers (for the trend chart)                                                                                                                                                                                                    |

**CSV formats**

- Airdrop list: `address,amount`, header optional. Amounts are in token units by default (`100` = 100 tokens, decimals allowed); with `unit=wei` they are base units. Duplicate addresses, invalid formats and zero amounts are reported per line (up to 50 at once). Limits: 10MB / 200,000 rows.
- Vesting schedules: header required: `beneficiary,amount,tge_time,tge_percent,cliff_days,vesting_days,interval_days,revocable`. `tge_time` accepts unix seconds, `YYYY-MM-DD` (00:00 UTC) or an ISO time with timezone. At most 500 schedules per upload.

**Signature airdrop error codes**: `NOT_ELIGIBLE` not on the list, `NOTHING_TO_CLAIM` fully claimed, `NOT_IN_WINDOW` outside the window or paused, `SIGNER_NOT_READY` the creator hasn't provided the key, `CLAIM_PENDING_SYNC` the previous claim is on-chain but not synced (the frontend should resubmit that transaction).

### Database tables

| Table                                              | Purpose                                                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `projects`                                         | Projects: type, owner, token, funded/claimed/withdrawn, time window, pause state, current Merkle root / signer, display info |
| `merkle_trees` / `merkle_entries`                  | Merkle lists keyed by root (the same list is stored once), with each address's proof precomputed                             |
| `sign_signers`                                     | Signer private keys (AES-256-GCM encrypted)                                                                                  |
| `sign_allocations`                                 | Signature airdrop list: allocation `amount`, `claimed`, number of claims `claim_nonce`                                       |
| `sign_issuances`                                   | Every issued signature (audit; reused for the same amount while still valid)                                                 |
| `vesting_schedules`                                | Mirror of the vesting schedules                                                                                              |
| `claims`                                           | All claims (all three types)                                                                                                 |
| `project_activities`                               | Project timeline                                                                                                             |
| `processed_txs`                                    | Processed transactions (idempotency)                                                                                         |
| `platform_stats` / `project_stats` / `daily_stats` | Stats counters, updated in the same transaction as the events                                                                |
| `claimers` / `project_claimers` / `creators`       | Dedup tables for "distinct address" counts                                                                                   |
| `auth_nonces`                                      | Sign-in nonces                                                                                                               |

All addresses are stored lowercase; amounts are `numeric(78,0)` (fits any uint256 and can be summed in SQL).

### Signature airdrop security design

- **claimId = keccak256(abi.encode(project address, user address, claim number))**. The contract allows each claimId only once, so even duplicate signatures from the backend can never pay out twice.
- Signatures are valid for 30 minutes by default (`SIGN_TTL_SECONDS`). **Note**: signatures already handed out remain valid until they expire. If the creator lowers someone's allocation while they still hold an old signature, they can claim once at the old amount. To invalidate all signatures immediately, rotate the signer on-chain with `setSigner`.
- Signer keys are encrypted with `SIGN_KEY_SECRET`. **If this master key is lost, none of the stored keys can be decrypted** — back it up.
- Signer keys must belong to brand-new accounts (nonce = 0, balance = 0). The backend uses them only for off-chain signing, never to send transactions.

### Environment variables (`web/.env.local`, template in `web/.env.example`)

| Variable                                                                                                    | Required               | Description                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                                                              | ✅                     | Postgres connection string                                                                       |
| `SIGN_KEY_SECRET`                                                                                           | ✅                     | 64 hex characters, `openssl rand -hex 32`, **back it up**                                        |
| `AUTH_SECRET`                                                                                               | ✅                     | 32+ characters, `openssl rand -hex 32`                                                           |
| `APP_DOMAIN`                                                                                                | Required in production | Site domain (used to validate wallet sign-in), defaults to `localhost:3000`                      |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`                                                                      | Recommended            | WalletConnect project ID; without it, mobile wallet QR connection is unavailable                 |
| `NEXT_PUBLIC_CHAIN_ID` / `NEXT_PUBLIC_RPC_URL` / `NEXT_PUBLIC_EXPLORER_URL` / `NEXT_PUBLIC_FACTORY_ADDRESS` | No                     | Chain config shared by frontend and backend, defaults to Arc Testnet. **Rebuild after changing** |
| `MERKLE_IMPL` / `SIGN_IMPL` / `VESTING_IMPL`                                                                | No                     | Implementation addresses (the server uses them to recognise projects), default to Arc Testnet    |
| `RPC_URL`                                                                                                   | No                     | Private server-side RPC                                                                          |
| `SIGN_TTL_SECONDS`                                                                                          | No                     | Signature validity, default 1800                                                                 |
| `NEXT_PUBLIC_TEST_TOKEN_FACTORY`                                                                            | No                     | TestTokenFactory address (written by `deploy.sh`). Empty = the test token feature is hidden      |
| `NEXT_PUBLIC_MOCK_WALLET`                                                                                   | Testing only           | `1` = auto-connect an anvil test account as the wallet (only when the chain id is 31337)         |

---

## Running

```bash
# Contracts
forge build && forge test

# Website (pages + API)
cd web
cp .env.example .env.local      # fill in the three secrets and the database
createdb tokendis               # or any Postgres
bun install
bun run db:migrate              # create tables (after changing schema.ts, run bun run db:generate first)
bun run dev                     # http://localhost:3000
```

### Local development / end-to-end tests

Run all three modes for real on a local chain:

```bash
anvil                                                       # terminal 1: local chain
# terminal 2: deploy contracts (.env PRIVATE_KEY = anvil account 0 key) and a test token, then mint to account 0
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
./deploy.sh local -y
forge create contracts/test/MockERC20.sol:MockERC20 --rpc-url http://127.0.0.1:8545 --private-key $PK --broadcast --constructor-args "Test Token" TT 18
cast send <token address> "mint(address,uint256)" 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 1000000000000000000000000 --rpc-url http://127.0.0.1:8545 --private-key $PK
# terminal 3: point the site at the local chain + mock wallet (use the addresses printed above)
cd web && NEXT_PUBLIC_CHAIN_ID=31337 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 NEXT_PUBLIC_MOCK_WALLET=1 \
  NEXT_PUBLIC_FACTORY_ADDRESS=0x... NEXT_PUBLIC_TEST_TOKEN_FACTORY=0x... \
  MERKLE_IMPL=0x... SIGN_IMPL=0x... VESTING_IMPL=0x... bun run dev
# terminal 4
cd web && E2E_FACTORY=0x... E2E_TOKEN=0x... bun run e2e     # API test (41 checks)
cd web && bun run test                                      # unit tests (wallet network logic)
cd web && bun run e2e:ui                                    # browser test (18 checks; mints its own test token; screenshots in web/e2e-shots/)
```

Tip: to run the tests while your normal `bun run dev` keeps running on port 3000, start the test server with `NEXT_DIST_DIR=.next-e2e` on another port (e.g. `-p 3100`, plus `APP_DOMAIN=localhost:3100`) and run the tests with `E2E_API=http://localhost:3100`.

In mock wallet mode the site auto-connects anvil account 0. To use another test account, run this in the browser console and reload:
`localStorage.setItem('mockAccount', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8')`

---

## Known issues / TODO

1. The contract design doc says Solidity 0.8.24, but `foundry.toml` actually uses 0.8.28; the doc should be updated.
2. After lowering a signature airdrop allocation, signatures already handed out stay valid until they expire (up to 30 minutes). To invalidate them immediately, use "Rotate to a new signer" on the project page.
3. The list upload endpoints have no rate limiting; add it at the gateway before going live.
4. `/api/tx` reads `getSchedule` one by one when syncing vesting schedules, so several hundred schedules in one tx is slow (but works).
5. Frontend dependency note: `next.config.mjs` stubs out `@coinbase/cdp-sdk`. ConnectKit pulls in the Base Account connector, whose dependencies are missing optional packages and break the build; we don't use Base Account, so nothing is affected. Try removing the stub when upgrading ConnectKit/wagmi.
6. The UI doesn't yet support transferring project ownership (the contract has `transferCreator`/`acceptCreator` and the backend syncs it; only the button is missing).
7. WalletConnect (mobile wallets) requires `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
