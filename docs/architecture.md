# TokenShoe — Architecture Document

## 1. Overview

TokenShoe is a **token distribution platform on Arc** (Circle's USDC-native blockchain). Project creators deploy a distribution contract in a single transaction and distribute ERC-20 tokens to recipients. Three distribution modes are supported:

| Mode | Contract | Best for |
|---|---|---|
| Merkle airdrop | `TokenMerkleDis` | Fixed snapshot lists (100k+ addresses) |
| Signature airdrop | `TokenSignDis` | Dynamic lists — quests, allowlists, web2 conditions |
| Vesting / unlock | `TokenVesting` | Investors, team, advisors — TGE + cliff + linear release |

**Core guarantee:** creators cannot claw back tokens that are owed to recipients. For airdrops the creator cannot withdraw while the claim window is open; for vesting only the surplus not allocated to any schedule can be withdrawn.

---

## 2. Repository Layout

```
/
├── contracts/                 Solidity (Foundry)
│   ├── TokenDisBase.sol       Shared base: fund, pause, withdraw, two-step creator transfer
│   ├── TokenShoeFactory.sol   Factory: EIP-1167 minimal proxies + CREATE2
│   ├── TokenMerkleDis.sol     Merkle airdrop implementation
│   ├── TokenSignDis.sol       EIP-712 signature airdrop implementation
│   ├── TokenVesting.sol       Vesting / unlock implementation
│   ├── TestTokenFactory.sol   Test helper: anyone mints a 100M ERC-20 free
│   ├── script/Deploy.s.sol    Deployment script
│   └── test/                  Foundry unit + fuzz tests (120 tests, all passing)
│
└── web/                       Next.js 14 App Router + Postgres + Drizzle
    ├── src/app/               Pages and API routes
    ├── src/components/        React UI components
    ├── src/hooks/             wagmi / react-query hooks
    ├── src/lib/               Server-side logic (tx processor, chain, auth, crypto)
    ├── src/config/networks.ts Arc Testnet + Arc Mainnet config (shared browser/server)
    └── src/db/                Drizzle schema + migrations
```

---

## 3. Networks

The site supports **Arc Testnet** (chain 5042002) and **Arc Mainnet** (chain 5042). Arc uses USDC as the native gas token — one asset, two views (ERC-20 and native).

| | Arc Testnet | Arc Mainnet |
|---|---|---|
| Chain ID | 5042002 | 5042 |
| RPC | `https://rpc.testnet.arc.io` | `https://rpc.mainnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` | `https://explorer.arc.io` |
| Database env | `DATABASE_URL` | `DATABASE_URL_MAINNET` |
| Faucet | Yes (Circle faucet) | No |

The selected network flows through the entire stack:
- **Frontend:** `useNetwork()` hook (`src/hooks/useNetwork.tsx`) — every component reads the active network; switching clears all cached data and asks the wallet to switch chains.
- **Backend:** `x-network` request header (or `?network=` query param). The `route()` wrapper in `src/lib/http.ts` calls `requestNetwork()` which selects the correct DB, RPC, and contract addresses for every API handler.
- **Data isolation:** each network has a completely separate Postgres database; data never mixes.

---

## 4. Smart Contracts

### 4.1 Factory — `TokenShoeFactory`

Uses **EIP-1167 minimal proxies** (clones) + **CREATE2** so the project address is deterministic and can be computed before deployment.

```
factory.createProject(type, token, amount, userSalt, initData) → proxy address
factory.predictAddress(type, creator, userSalt) → address (view, no gas)
factory.setImplementation(type, impl)           → owner only
```

The factory holds a mapping `implementations[type] → address`. Three types are registered: 0 = Merkle, 1 = Sign, 2 = Vesting. The backend identifies project contracts by comparing their bytecode against the registered implementation addresses.

### 4.2 Base — `TokenDisBase`

All three project types inherit from this base. Shared surface:

| Function | Access | Description |
|---|---|---|
| `fund(amount)` | Anyone | Add more tokens to the project |
| `pause()` / `unpause()` | Creator | Pause claims; for airdrops the end time is pushed back by the paused duration |
| `withdraw(to, amount)` | Creator | Withdraw the recoverable portion (reverts if amount exceeds recoverable) |
| `transferCreator(new)` | Creator | Start two-step ownership transfer |
| `acceptCreator()` | Pending creator | Complete the transfer |

### 4.3 Merkle Airdrop — `TokenMerkleDis`

`initData = abi.encode(bytes32 root, uint64 startTime, uint64 endTime)`

- Leaf format: `keccak256(keccak256(abi.encode(index, account, amount)))` — compatible with OpenZeppelin's `StandardMerkleTree`.
- `claim(index, account, amount, proof[])` — anyone can pay gas; tokens always go to `account`.
- `setRoot(newRoot)` — creator only, only before `startTime`.
- `isClaimed(index)` — bitmap-based, O(1) storage.
- `effectiveEndTime()` — end time extended by any pause durations.

### 4.4 Signature Airdrop — `TokenSignDis`

`initData = abi.encode(address signer, uint64 startTime, uint64 endTime)`

- EIP-712 domain: `name="TokenSignDis", version="1"`.
- Struct: `ClaimRequest(address account, uint256 amount, bytes32 claimId, uint256 deadline)`.
- `claimId = keccak256(abi.encode(projectAddress, userAddress, claimNonce))` — each claimId is usable only once; prevents double-spend even if the backend issues a duplicate signature.
- `claim(account, amount, claimId, deadline, sig)` — anyone can pay gas.
- `setSigner(new)` — creator rotates the signer key.

**Security note on allocation changes:** signatures already issued remain valid until they expire (default 30 min). To invalidate all outstanding signatures immediately, use `setSigner` on-chain then update the signer key in the backend.

### 4.5 Vesting — `TokenVesting`

`initData = abi.encode(Schedule[])`

Each schedule:
```solidity
struct Schedule {
  address beneficiary;
  uint128 amount;
  uint64  tgeTime;        // unlock start
  uint16  tgeBps;         // % unlocked immediately at TGE (basis points)
  uint32  cliffDays;      // days after TGE before linear vesting starts
  uint32  vestingDays;    // total vesting duration after cliff
  uint32  intervalDays;   // 0 = continuous linear; >0 = stepped
  bool    revocable;
}
```

Unlock formula:
1. Before `tgeTime`: 0
2. At `tgeTime`: `amount × tgeBps / 10000`
3. Between TGE and `tgeTime + cliffDays`: only TGE share
4. After cliff: TGE share + linear (or stepped) over `vestingDays`
5. After full vesting: 100% unlocked

`claim(ids[])` — beneficiary claims multiple schedules in one call.
`revoke(id)` — creator revokes a revocable schedule; already-unlocked amount remains claimable.
`addSchedules(list)` — creator adds more schedules (balance must cover them).

### 4.6 Test Token Factory — `TestTokenFactory`

`createToken(name, symbol) → address` — deploys a standard ERC-20 and mints 100,000,000 tokens (18 decimals) to the caller. Available on both testnet and mainnet for testing.

---

## 5. Backend Architecture

### 5.1 Core Design: No Indexer

The backend has **no background indexer**. Instead, after every on-chain transaction the frontend sends the transaction hash to the backend:

```
User action → wallet signs tx → tx mined → frontend POST /api/tx { txHash }
                                                      ↓
                                        backend reads receipt from RPC
                                        decodes factory/project events
                                        writes data + stats in one DB transaction
```

**Why this works:**
- All data comes from on-chain events — the frontend cannot inject fake data.
- Idempotent: `processed_txs` table ensures each tx is written exactly once no matter how many times it is submitted.
- If a claim/fund tx arrives before the project's creation tx is synced, the backend returns `409 PROJECT_NOT_SYNCED` instead of silently losing data.

### 5.2 Transaction Processor — `src/lib/tx-processor.ts`

The single data entry point. Given a `txHash`:

1. Fetch the receipt via `publicClient.getTransactionReceipt()`.
2. Decode every log using `decodeEventLog` against the factory ABI and project event ABI.
3. For `ProjectCreated` events: read `initData` from the contract via RPC, read token metadata, write the `projects` row. If a Merkle root is embedded, link it to an existing `merkle_trees` row.
4. For `Funded`, `Withdrawn`, `Paused`, `Unpaused`, `RootUpdated`, `SignerUpdated`: update the matching `projects` row + append to `project_activities`.
5. For `Claimed`: write to `claims`, update `sign_allocations.claimed`, update per-project and per-platform stats counters.
6. For `ScheduleCreated`, `ScheduleRevoked`: write/update `vesting_schedules`.
7. All writes happen inside a single `db().transaction()` with a Postgres advisory lock on the project address, so concurrent requests for the same project are serialized.

### 5.3 API Routes — `src/app/api/`

All routes follow the pattern:
```ts
export const GET = route('route.name', async (req, { params }) => {
  // handler receives the validated request for the correct network
})
```

The `route()` wrapper in `src/lib/http.ts`:
- Resolves the network from `x-network` header / `?network=` query param.
- Returns `400 BAD_NETWORK` for unknown networks.
- Returns `503 NETWORK_UNAVAILABLE` when the network's database is not configured.
- Returns `503 NETWORK_NOT_DEPLOYED` when contracts are not deployed on that network.

**Complete API surface:**

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/tx` | None | Sync a transaction hash; returns events, created projects, warnings |
| `GET /api/projects` | None | List projects; filter `?creator=&type=&page=&pageSize=` |
| `GET /api/projects/:addr` | None | Single project: funds, status, stats, signerReady flag |
| `PATCH /api/projects/:addr` | Creator | Update display info (name, description, logo, etc.) |
| `GET /api/projects/:addr/claims` | None | Claims for this project; filter `?account=` |
| `GET /api/projects/:addr/activities` | None | Project timeline (created, funded, withdrawn, etc.) |
| `GET /api/projects/:addr/eligibility?account=` | None | How much the given address can claim |
| `GET /api/projects/:addr/vesting/schedules` | None | All vesting schedules with unlocked + claimable amounts |
| `POST /api/merkle/trees` | Signed in | Upload a CSV → build the Merkle tree → return root |
| `GET /api/merkle/trees/:root` | None | View an uploaded list |
| `GET /api/projects/:addr/merkle-proof?account=` | None | Get the proof for an address |
| `GET /api/sign/check-signer?address=` | None | Verify a signer key is fresh (nonce=0, balance=0) |
| `GET /api/projects/:addr/sign/allocations` | Creator | View the signature allocation list |
| `POST /api/projects/:addr/sign/allocations` | Creator | Upload CSV (`mode=merge\|replace`) |
| `PUT /api/projects/:addr/sign/allocations` | Creator | Edit one allocation |
| `DELETE /api/projects/:addr/sign/allocations` | Creator | Remove one allocation |
| `POST /api/projects/:addr/sign/signer` | Creator | Provide or rotate the signer private key |
| `POST /api/projects/:addr/sign/request` | None | Recipient requests a claim signature |
| `POST /api/vesting/parse` | None | Parse a schedule CSV → return schedules + initData |
| `GET /api/accounts/:addr/claimable` | None | Everything the address can claim across all three types |
| `GET /api/accounts/:addr/claims` | None | Claim history for an address |
| `GET /api/stats` | None | Platform totals: projects, creators, claims, claimers, recipients |
| `GET /api/stats/daily?days=30` | None | Daily counts for the trend chart |
| `GET /api/auth/nonce` | None | Get a SIWE sign-in nonce |
| `POST /api/auth/login` | None | Complete SIWE sign-in; sets an HttpOnly session cookie |
| `GET /api/auth/me` | None | Return the signed-in address (or null) |
| `POST /api/auth/logout` | None | Clear the session cookie |

### 5.4 Authentication — SIWE (EIP-4361)

Creator management actions (updating display info, uploading lists, providing the signer key) require sign-in:

1. `GET /api/auth/nonce` → one-time nonce (stored in `auth_nonces`).
2. Frontend builds a SIWE message with `createSiweMessage()` from `viem/siwe`, wallet signs it.
3. `POST /api/auth/login { message, signature }` → server verifies, sets `HttpOnly` cookie (24h).
4. `GET /api/auth/me` → returns the current address.

Contract wallets (ERC-1271 multisigs) are supported.

### 5.5 Signature Airdrop Security

- The signer private key is stored **AES-256-GCM encrypted** in `sign_signers`, using `SIGN_KEY_SECRET` as the master key.
- Signer accounts must be **brand new** (nonce = 0, balance = 0). The backend uses them only for off-chain signing, never for sending transactions.
- `claimId = keccak256(abi.encode(projectAddress, userAddress, claimNonce))` — even if the backend issues the same signature twice, the contract enforces each claimId is usable once only.
- Signatures are valid for 30 minutes (`SIGN_TTL_SECONDS`). The backend reuses an existing valid signature for the same amount rather than issuing a new one.

### 5.6 Database Schema

All addresses are lowercase. All token amounts are `numeric(78, 0)` (fits any uint256, can be summed in SQL).

| Table | Purpose |
|---|---|
| `projects` | One row per deployed project contract |
| `merkle_trees` | Uploaded Merkle lists, keyed by root (deduplicated) |
| `merkle_entries` | One row per leaf, with precomputed proof |
| `sign_signers` | Encrypted signer private keys |
| `sign_allocations` | Per-address allocation amounts and claim counts |
| `sign_issuances` | Every issued signature (audit log; reuse detection) |
| `vesting_schedules` | Mirror of on-chain vesting schedules |
| `claims` | All claims across all three types |
| `project_activities` | Project timeline events |
| `processed_txs` | Idempotency: each txHash processed exactly once |
| `platform_stats` | Global counters (updated in the same DB transaction as events) |
| `project_stats` | Per-project claim / claimer / recipient counts |
| `daily_stats` | Daily breakdowns for the trend chart |
| `claimers` / `project_claimers` / `creators` | Dedup tables for distinct-address counts |
| `auth_nonces` | SIWE sign-in nonces |

---

## 6. Frontend Architecture

### 6.1 Provider Stack — `src/components/providers/`

```
AppProviders
└── Web3Provider          wagmi config + ConnectKit UI
    └── WagmiProvider
        └── QueryClientProvider  (TanStack Query)
            └── ConnectKitProvider
                └── PendingTxSyncer   (background: retry unsynced tx hashes on load)
                    └── {page content}
```

**`Web3Provider`** builds the wagmi config:
- If `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set: uses `getDefaultConfig` from ConnectKit (full WalletConnect support).
- Otherwise: uses `injected` connector (MetaMask, OKX, Rabby, any browser extension), no WalletConnect dependency. `shimDisconnect: false` ensures reconnect works across page navigations.

**`PendingTxSyncer`** runs on mount: reads `pendingTxHashes` from localStorage and calls `POST /api/tx` for each one. This handles the case where the user closed the tab before the sync completed.

### 6.2 Pages

#### `/` — Home (`src/app/page.tsx`)
- Platform stats card row: total projects (by type), claims, claimers, recipients.
- 30-day trend chart with switchable metric (claims / new claimers / new projects), table view toggle.
- Latest projects list (5 most recent, link to explore).
- Hero buttons: "Create a project" and "Check my airdrops".
- Links to test token minting for new users.

**Data sources:** `GET /api/stats`, `GET /api/stats/daily`, `GET /api/projects?pageSize=5`.

#### `/explore` — Explore (`src/app/explore/page.tsx`)
- Paginated list of all projects.
- Type filter tabs: All / Merkle / Signature / Vesting.
- Each row: project name, type badge, token, funded/claimed amounts, status, created date.

**Data source:** `GET /api/projects?type=&page=`.

#### `/create` — Create Wizard (`src/components/create/CreateWizard.tsx`)
Five-step wizard rendered inside a card:

| Step | Content | Implementation detail |
|---|---|---|
| 0 — Type | Three type cards (Merkle / Signature / Vesting) | Local state `s.type` |
| 1 — Token | Token address input; auto-reads symbol, decimals, name, balance via `useReadContracts` | `ERC20_FULL_ABI` multicall |
| 2 — Distribution | Merkle: CSV upload → build tree via `@openzeppelin/merkle-tree`; Sign: generate or paste signer key; Vesting: manual rows or CSV | `POST /api/merkle/trees`, `GET /api/sign/check-signer`, `POST /api/vesting/parse` |
| 3 — Details | Project name, description, website, Twitter, Telegram | Local state |
| 4 — Deploy | Summary + progress steps (Approve → Create → Upload list) | `useChainTx`, `POST /api/tx` |

Deploy flow:
1. Read `factory.implementations(type)` — if not registered, show error before sending any tx.
2. If `allowance < amount`, call `token.approve(factory, amount)`.
3. Call `factory.createProject(type, token, amount, salt, initData)`.
4. Call `POST /api/tx { txHash, meta, signerPrivateKey? }` to sync.
5. For signature airdrops with a list file: call `POST /api/projects/:addr/sign/allocations`.

The project address is predicted before deployment via `factory.predictAddress()` so the backend sync can be directed at the correct address.

#### `/claim` — Claim (`src/app/claim/page.tsx`)
- Three tabs: **Available & upcoming** / **Completed** / **History**.
- Available tab: list of `ClaimCard` components, one per claimable item. Each card shows: project name, type, allocated amount, claimed amount, claimable now, status indicator.
- Claim action: for Merkle → fetch proof → call `contract.claim(index, account, amount, proof)`; for Sign → `POST /api/projects/:addr/sign/request` → call `contract.claim(...)`; for Vesting → `contract.claim(ids[])`.
- After each claim tx: `POST /api/tx { txHash }`.

**Data source:** `GET /api/accounts/:addr/claimable`.

#### `/projects` — My Projects (`src/app/projects/page.tsx`)
- Paginated list of projects created by the connected wallet.
- Same `ProjectRow` component as Explore.

**Data source:** `GET /api/projects?creator=<addr>`.

#### `/projects/[address]` — Project Detail (`src/app/projects/[address]/page.tsx`)
Tabs visible to everyone:
- **Overview:** funded/claimed/withdrawn amounts, status, claim window, my allocation (claim button if eligible).
- **Claims:** table of all claims with address, amount, timestamp, tx link.
- **Recipients / Schedules:** Merkle/Sign → address list with amounts; Vesting → schedule table with unlock timeline.
- **Activity:** timeline of project events (funded, paused, signer rotated, etc.).

Additional **Manage** tab for the creator (requires SIWE sign-in):
- Top up (fund more tokens).
- Pause / Resume.
- Withdraw recoverable amount (shows current withdrawable balance).
- Edit display info.
- *Merkle only:* Replace the list (before start time).
- *Sign only:* Add / edit / remove recipients; rotate signer key.
- *Vesting only:* Revoke a schedule; add new schedules.

**Data sources:** `GET /api/projects/:addr`, `GET /api/projects/:addr/claims`, `GET /api/projects/:addr/activities`, `GET /api/projects/:addr/eligibility`, `GET /api/projects/:addr/vesting/schedules`, `GET /api/projects/:addr/sign/allocations`.

#### `/test-token` — Test Tokens (`src/app/test-token/page.tsx`)
- Mint a free test ERC-20: enter name + symbol → call `TestTokenFactory.createToken()` → 100M tokens appear in your wallet.
- List your previously minted test tokens.
- "Add to wallet" (MetaMask `wallet_watchAsset`).
- "Distribute" button → navigates to `/create?token=0x...`.

**Data source:** reads `TestTokenFactory` events via `useReadContracts`.

#### `/docs` — Documentation (`src/app/docs/page.tsx`)
Static documentation page with table of contents. Covers: platform overview, quick start, choosing a distribution type, how each type works, claiming, managing a project, CSV formats, test tokens, wallet setup, FAQ, contract addresses.

### 6.3 Key Hooks

| Hook | File | Purpose |
|---|---|---|
| `useNetwork()` | `hooks/useNetwork.tsx` | Active network config (chain, factory address, etc.); persisted to localStorage |
| `useChainTx()` | `hooks/useChainTx.ts` | Send a transaction: switches chain if needed, waits for receipt, syncs to backend, saves hash to localStorage for recovery |
| `useAuth()` | `hooks/useAuth.tsx` | SIWE sign-in flow; `ensureSignedIn()` triggers sign-in if not already authenticated |
| `useWalletNetwork()` | `hooks/useWalletNetwork.tsx` | Detects when the wallet's RPC is stale; calls `wallet_addEthereumChain` to correct it |
| `useClaimable()` | `hooks/queries.ts` | `GET /api/accounts/:addr/claimable` |
| `useProjects()` | `hooks/queries.ts` | `GET /api/projects` with filters |
| `useProject()` | `hooks/queries.ts` | `GET /api/projects/:addr` |

### 6.4 Chain Transaction Flow — `useChainTx`

```
useChainTx.send(contractCall)
  1. Check wallet chain ID matches app chain
     → if mismatch: call switchChain (or addChain if not added yet)
  2. Check wallet RPC is live (latest block reachable)
     → if dead RPC: call wallet_addEthereumChain with correct RPC URL
  3. Send the transaction via writeContract / sendTransaction
  4. Wait for receipt (wagmi waitForTransactionReceipt)
  5. Save txHash to localStorage (pendingTxHashes)
  6. POST /api/tx { txHash } to sync backend
  7. Remove txHash from localStorage on success
  8. Invalidate react-query caches for affected resources
```

If step 6 fails (user closed tab, network hiccup), `PendingTxSyncer` retries on the next page load.

---

## 7. Environment Variables

### Contracts (`.env`)
| Variable | Description |
|---|---|
| `PRIVATE_KEY` | Deployer wallet private key |
| `ARC_TESTNET_RPC_URL` | Defaults to `https://rpc.testnet.arc.io` |
| `ARC_MAINNET_RPC_URL` | Defaults to `https://rpc.mainnet.arc.io` |
| `FACTORY_OWNER` | Final owner (e.g. multisig); empty = deployer |
| `DEPLOY_TEST_TOKEN_FACTORY` | Default true; set false to skip |

### Web (`web/.env.local`)
| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres for Arc Testnet |
| `DATABASE_URL_MAINNET` | For mainnet | Postgres for Arc Mainnet |
| `SIGN_KEY_SECRET` | Yes | 64 hex chars — master key for encrypting signer keys |
| `AUTH_SECRET` | Yes | 32+ chars — session cookie signing |
| `APP_DOMAIN` | Production | Domain(s) accepted in SIWE messages |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Optional | WalletConnect Project ID; without it, QR code connection is unavailable |
| `NEXT_PUBLIC_FACTORY_ADDRESS` | Override | Testnet factory address |
| `NEXT_PUBLIC_MAINNET_FACTORY_ADDRESS` | Override | Mainnet factory address |
| `NEXT_PUBLIC_TEST_TOKEN_FACTORY` | Override | Testnet TestTokenFactory address |
| `MERKLE_IMPL` / `SIGN_IMPL` / `VESTING_IMPL` | Override | Server-side implementation addresses for clone detection |
| `RPC_URL` / `MAINNET_RPC_URL` | Optional | Private server-side RPCs |
| `SIGN_TTL_SECONDS` | Optional | Signature validity window (default 1800) |

---

## 8. Deployment

### Contracts
```bash
cp .env.example .env   # fill PRIVATE_KEY
./deploy.sh            # Arc Testnet
./deploy.sh mainnet    # Arc Mainnet (requires typing "mainnet")
```

`deploy.sh` compiles, dry-runs, deploys, verifies on-chain state, writes `deployments/<chainId>.json`, and updates `web/.env.local` with the new addresses.

### Web (Vercel)
```bash
cd web
vercel deploy --prod
```

The project is linked to Vercel project `tokenshoe`. Database is Neon Postgres (provisioned via Vercel Marketplace). After a schema change:
```bash
vercel env pull /tmp/prod.env --environment production
DATABASE_URL=<unpooled URL> bun run db:migrate:neon
```

### Local Development
```bash
# Contracts
forge build && forge test

# Web
cd web
cp .env.example .env.local   # fill secrets + database
bun install
bun run db:migrate
bun run dev                   # http://localhost:3000 (or PORT=5173 bun run dev)
```

---

## 9. Data Flow Diagrams

### Merkle Airdrop — Full Flow
```
Creator:
  1. Upload CSV → POST /api/merkle/trees → { root }
  2. token.approve(factory, amount)
  3. factory.createProject(0, token, amount, salt, encode(root, start, end))
  4. POST /api/tx { txHash, meta }
     → backend: ProjectCreated event → writes projects row, links merkle_trees row

Recipient:
  5. GET /api/projects/:addr/merkle-proof?account=0x...
     → { index, amount, proof }
  6. contract.claim(index, account, amount, proof)
  7. POST /api/tx { txHash }
     → backend: Claimed event → writes claims row, updates stats
```

### Signature Airdrop — Full Flow
```
Creator:
  1. Generate new key pair in browser (or paste one)
  2. GET /api/sign/check-signer?address=0x...  (verify it's fresh)
  3. token.approve(factory, amount)
  4. factory.createProject(1, token, amount, salt, encode(signerAddr, start, end))
  5. POST /api/tx { txHash, meta, signerPrivateKey }
     → backend: verifies signer matches on-chain, encrypts key, writes projects row
  6. POST /api/projects/:addr/sign/allocations (CSV upload)
     → backend: writes sign_allocations rows

Recipient:
  7. POST /api/projects/:addr/sign/request { account }
     → backend: checks eligibility, decrypts signer key, signs EIP-712 message
     → { amount, claimId, deadline, signature }
  8. contract.claim(account, amount, claimId, deadline, signature)
  9. POST /api/tx { txHash }
     → backend: Claimed event → updates sign_allocations.claimed
```

### Vesting — Full Flow
```
Creator:
  1. (Optional) POST /api/vesting/parse (CSV upload) → { schedules, initData }
  2. token.approve(factory, totalAmount)
  3. factory.createProject(2, token, totalAmount, salt, initData)
  4. POST /api/tx { txHash, meta }
     → backend: ProjectCreated + ScheduleCreated events → writes projects + vesting_schedules rows

Beneficiary:
  5. GET /api/accounts/:addr/claimable → shows claimable amounts per schedule
  6. contract.claim([scheduleId1, scheduleId2, ...])
  7. POST /api/tx { txHash }
     → backend: Claimed events → updates vesting_schedules, writes claims rows
```
