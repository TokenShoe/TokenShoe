#!/usr/bin/env bash
#
# TokenShoe one-shot contract deployment: 3 implementation contracts + factory, with implementations registered.
#
# Usage:
#   ./deploy.sh              deploy to Arc testnet (reads PRIVATE_KEY / ARC_TESTNET_RPC_URL from .env)
#   ./deploy.sh mainnet      deploy to Arc mainnet (reads PRIVATE_KEY / ARC_MAINNET_RPC_URL from .env)
#   ./deploy.sh local        deploy to local anvil (http://127.0.0.1:8545)
#   ./deploy.sh -y           skip the confirmation prompt (not allowed for mainnet)
#
# After a successful deployment:
#   - deployments/<chainId>.json  records all addresses
#   - web/.env.local              gets the new factory and implementation addresses (Arc testnet / mainnet)
#   - AGENTS.md                   address tables are regenerated from deployments/*.json (Arc testnet / mainnet)
#
set -euo pipefail
cd "$(dirname "$0")"

# ─── Arguments ───────────────────────────────────────────────────────────────
NETWORK="arc_testnet"
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    local) NETWORK="local" ;;
    arc|arc_testnet|testnet) NETWORK="arc_testnet" ;;
    mainnet|arc_mainnet) NETWORK="arc_mainnet" ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unknown argument: ${arg} (use -h for usage)"; exit 1 ;;
  esac
done

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
die()   { red "✗ $*"; exit 1; }

command -v forge >/dev/null || die "forge not found. Install Foundry first: https://book.getfoundry.sh/getting-started/installation"
command -v cast  >/dev/null || die "cast not found (it ships with Foundry)"
command -v node  >/dev/null || die "node not found (used to read/write JSON)"

# ─── Load .env ───────────────────────────────────────────────────────────────
[ -f .env ] || die "No .env in the project root. Run: cp .env.example .env, then fill in PRIVATE_KEY"
set -a
# shellcheck disable=SC1091
source .env
set +a

[ -n "${PRIVATE_KEY:-}" ] || die "PRIVATE_KEY is not set in .env"
PK="${PRIVATE_KEY#0x}"
[[ "$PK" =~ ^[0-9a-fA-F]{64}$ ]] || die "PRIVATE_KEY has the wrong format (expected 64 hex characters, 0x optional)"
export PRIVATE_KEY="0x$PK"   # always add 0x so vm.envUint in Solidity parses it as hex

if [ -n "${FACTORY_OWNER:-}" ]; then
  [[ "$FACTORY_OWNER" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "FACTORY_OWNER is not a valid address"
fi

case "$NETWORK" in
  local)       RPC="http://127.0.0.1:8545" ;;
  arc_testnet) RPC="${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io}"; EXPECTED_CHAIN_ID=5042002 ;;
  arc_mainnet)
    RPC="${ARC_MAINNET_RPC_URL:-https://rpc.mainnet.arc.io}"; EXPECTED_CHAIN_ID=5042
    [ "$ASSUME_YES" != "1" ] || die "-y is not allowed for mainnet: confirm the deployment by hand"
    ;;
esac

# ─── Pre-deployment checks ───────────────────────────────────────────────────
DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
CHAIN_ID=$(cast chain-id --rpc-url "$RPC") || die "Cannot reach RPC: $RPC"
if [ -n "${EXPECTED_CHAIN_ID:-}" ] && [ "$CHAIN_ID" != "$EXPECTED_CHAIN_ID" ]; then
  die "RPC $RPC is chain $CHAIN_ID, expected $EXPECTED_CHAIN_ID for $NETWORK"
fi
BALANCE=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
BALANCE_ETH=$(cast from-wei "$BALANCE")

bold "TokenShoe contract deployment"
echo "  Network     : $NETWORK (chainId $CHAIN_ID)"
echo "  RPC         : $RPC"
echo "  Deployer    : $DEPLOYER"
echo "  Balance     : ${BALANCE_ETH} (native token; USDC on Arc)"
echo "  Factory owner: ${FACTORY_OWNER:-${DEPLOYER} (deployer wallet)}"
echo

[ "$BALANCE" != "0" ] || die "The deployer wallet has no balance to pay gas (USDC on Arc). Testnet faucet: https://faucet.circle.com"

echo "▸ Compiling contracts..."
forge build --quiet || die "Compilation failed"

echo "▸ Dry run (nothing sent on-chain)..."
DEPLOY_DRY_RUN=1 forge script contracts/script/Deploy.s.sol --rpc-url "$RPC" 2>&1 \
  | grep -E "TokenShoeFactory|impl :|Estimated|Error|error|revert" || true
echo

if [ "$NETWORK" = "arc_mainnet" ]; then
  red "⚠ This deploys to Arc MAINNET and spends real USDC for gas."
  read -r -p "Type mainnet to continue: " answer
  [ "$answer" = "mainnet" ] || { echo "Cancelled"; exit 0; }
elif [ "$ASSUME_YES" != "1" ]; then
  read -r -p "Deploy to ${NETWORK}? This sends 8-9 transactions and spends gas. Type yes to continue: " answer
  [ "$answer" = "yes" ] || { echo "Cancelled"; exit 0; }
fi

# ─── Deploy ──────────────────────────────────────────────────────────────────
echo "▸ Deploying (waiting for each transaction to be mined)..."
forge script contracts/script/Deploy.s.sol --rpc-url "$RPC" --broadcast --slow \
  || die "Deployment failed, see the error above. Transactions already on-chain are recorded in broadcast/Deploy.s.sol/$CHAIN_ID/"

DEPLOY_FILE="deployments/$CHAIN_ID.json"
[ -f "$DEPLOY_FILE" ] || die "$DEPLOY_FILE was not generated"

json() { node -p "require('./$DEPLOY_FILE').$1"; }
FACTORY=$(json factory)
MERKLE=$(json merkleImpl)
SIGN=$(json signImpl)
VESTING=$(json vestingImpl)
TEST_TOKEN_FACTORY=$(json testTokenFactory)
ZERO=0x0000000000000000000000000000000000000000

# ─── On-chain verification (don't trust the simulation, read the chain) ──────
echo "▸ Verifying on-chain..."
lc() { tr '[:upper:]' '[:lower:]'; }
for pair in "0:$MERKLE" "1:$SIGN" "2:$VESTING"; do
  t="${pair%%:*}"; expected="${pair#*:}"
  actual=$(cast call "$FACTORY" "implementations(uint8)(address)" "$t" --rpc-url "$RPC")
  [ "$(echo "$actual" | lc)" = "$(echo "$expected" | lc)" ] || die "Type $t is registered incorrectly: on-chain ${actual}, expected $expected"
  echo "  type $t -> $actual ✓"
done
if [ "$TEST_TOKEN_FACTORY" != "$ZERO" ]; then
  [ "$(cast code "$TEST_TOKEN_FACTORY" --rpc-url "$RPC")" != "0x" ] || die "TestTokenFactory has no code at $TEST_TOKEN_FACTORY"
  echo "  test token factory -> $TEST_TOKEN_FACTORY ✓"
fi
OWNER=$(cast call "$FACTORY" "owner()(address)" --rpc-url "$RPC")
echo "  factory owner -> $OWNER ✓"
if [ -n "${FACTORY_OWNER:-}" ] && [ "$(echo "$FACTORY_OWNER" | lc)" != "$(echo "$DEPLOYER" | lc)" ]; then
  PENDING=$(cast call "$FACTORY" "pendingOwner()(address)" --rpc-url "$RPC")
  echo "  pending owner -> ${PENDING} (must call acceptOwnership())"
fi

# ─── Write web/.env.local and AGENTS.md (Arc testnet / mainnet) ──────────────
set_env() {  # set_env FILE KEY VALUE: replace if present, otherwise append
  local file="$1" key="$2" value="$3"
  touch "$file"
  grep -v "^${key}=" "$file" > "$file.tmp" || true
  echo "${key}=${value}" >> "$file.tmp"
  mv "$file.tmp" "$file"
}

WEB_ENV="web/.env.local"
if [ "$NETWORK" = "arc_testnet" ]; then
  set_env "$WEB_ENV" NEXT_PUBLIC_CHAIN_ID "$CHAIN_ID"
  set_env "$WEB_ENV" NEXT_PUBLIC_FACTORY_ADDRESS "$FACTORY"
  set_env "$WEB_ENV" MERKLE_IMPL "$MERKLE"
  set_env "$WEB_ENV" SIGN_IMPL "$SIGN"
  set_env "$WEB_ENV" VESTING_IMPL "$VESTING"
  if [ "$TEST_TOKEN_FACTORY" != "$ZERO" ]; then
    set_env "$WEB_ENV" NEXT_PUBLIC_TEST_TOKEN_FACTORY "$TEST_TOKEN_FACTORY"
  else
    set_env "$WEB_ENV" NEXT_PUBLIC_TEST_TOKEN_FACTORY ""   # skipped: hide the feature on the site
  fi
  echo "▸ Updated $WEB_ENV"
elif [ "$NETWORK" = "arc_mainnet" ]; then
  set_env "$WEB_ENV" NEXT_PUBLIC_MAINNET_FACTORY_ADDRESS "$FACTORY"
  set_env "$WEB_ENV" MAINNET_MERKLE_IMPL "$MERKLE"
  set_env "$WEB_ENV" MAINNET_SIGN_IMPL "$SIGN"
  set_env "$WEB_ENV" MAINNET_VESTING_IMPL "$VESTING"
  if [ "$TEST_TOKEN_FACTORY" != "$ZERO" ]; then
    set_env "$WEB_ENV" NEXT_PUBLIC_MAINNET_TEST_TOKEN_FACTORY "$TEST_TOKEN_FACTORY"
  else
    set_env "$WEB_ENV" NEXT_PUBLIC_MAINNET_TEST_TOKEN_FACTORY ""   # skipped: hide the feature on mainnet
  fi
  echo "▸ Updated $WEB_ENV"
fi

# AGENTS.md lists every Arc network that has a deployments/<chainId>.json
agents_section() {  # agents_section CHAIN_ID TITLE EXPLORER
  local file="deployments/$1.json" ex="$3/address"
  [ -f "$file" ] || return 0
  local f m s v t
  f=$(node -p "require('./$file').factory"); m=$(node -p "require('./$file').merkleImpl")
  s=$(node -p "require('./$file').signImpl"); v=$(node -p "require('./$file').vestingImpl")
  t=$(node -p "require('./$file').testTokenFactory")
  echo "## $2 (chainId $1)"
  echo
  echo "| Contract | Address | Explorer |"
  echo "|---|---|---|"
  echo "| TokenShoeFactory | \`$f\` | $ex/$f |"
  echo "| TokenMerkleDis (impl) | \`$m\` | $ex/$m |"
  echo "| TokenSignDis (impl) | \`$s\` | $ex/$s |"
  echo "| TokenVesting (impl) | \`$v\` | $ex/$v |"
  [ "$t" != "$ZERO" ] && echo "| TestTokenFactory (test helper) | \`$t\` | $ex/$t |"
  echo
}

if [ "$NETWORK" != "local" ]; then
  {
    echo "# TokenShoe — Deployed Contracts"
    echo
    echo "> Generated by \`./deploy.sh\` on $(date -u +"%Y-%m-%d %H:%M UTC"). Source of truth: \`deployments/<chainId>.json\`."
    echo
    agents_section 5042002 "Arc Testnet" "https://explorer.testnet.arc.io"
    agents_section 5042 "Arc Mainnet" "https://explorer.arc.io"
    echo "## Implementation type numbers (registered via setImplementation)"
    echo
    echo "- Type 0 → TokenMerkleDis"
    echo "- Type 1 → TokenSignDis"
    echo "- Type 2 → TokenVesting"
    echo
    echo "## Last deployment ($NETWORK)"
    echo
    echo "Factory owner: \`$OWNER\`"
    if [ -n "${FACTORY_OWNER:-}" ] && [ "$(echo "$FACTORY_OWNER" | lc)" != "$(echo "$DEPLOYER" | lc)" ]; then
      echo "Pending owner (must call acceptOwnership): \`$FACTORY_OWNER\`"
    fi
    echo "Deployer wallet: \`$DEPLOYER\`"
  } > AGENTS.md
  echo "▸ Updated AGENTS.md"
fi

echo
green "✓ Deployment complete"
echo "  TokenShoeFactory     : $FACTORY"
echo "  TokenMerkleDis impl : $MERKLE"
echo "  TokenSignDis impl   : $SIGN"
echo "  TokenVesting impl   : $VESTING"
[ "$TEST_TOKEN_FACTORY" != "$ZERO" ] && echo "  TestTokenFactory    : $TEST_TOKEN_FACTORY"
echo "  Deployment file     : $DEPLOY_FILE"
echo
bold "Next steps:"
echo "  1. Restart the site (NEXT_PUBLIC_* changed; production needs a rebuild): bun run dev"
if [ "$NETWORK" = "arc_mainnet" ]; then
  echo "  2. Put these addresses into web/src/config/networks.ts (Arc Mainnet section) so production picks them up,"
  echo "     or set NEXT_PUBLIC_MAINNET_FACTORY_ADDRESS / NEXT_PUBLIC_MAINNET_TEST_TOKEN_FACTORY / MAINNET_*_IMPL in the hosting environment"
  echo "  3. Make sure the mainnet database exists: set DATABASE_URL_MAINNET, then run: bun run db:migrate:mainnet"
else
  echo "  2. If the database has project data from an old factory, reset it: dropdb tokendis && createdb tokendis && bun run db:migrate"
  echo "  3. Update the production server environment variables with the addresses above"
fi
