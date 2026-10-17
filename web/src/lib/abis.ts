/**
 * Contract ABIs (only the parts the app uses, human-readable form, kept in sync with contracts/*.sol)
 */
import { parseAbi } from 'viem'

export const FACTORY_ABI = parseAbi([
  'event ProjectCreated(address indexed proxy, uint8 indexed implType, address indexed creator, address token, uint256 fundAmount)',
])

/** Events shared by all three project contracts + type-specific events, combined for unified decoding */
export const PROJECT_EVENTS_ABI = parseAbi([
  // TokenDisBase
  'event Funded(address indexed funder, uint256 amount)',
  'event Withdrawn(address indexed to, uint256 amount)',
  'event CreatorTransferInitiated(address indexed current, address indexed pending)',
  'event CreatorTransferred(address indexed oldCreator, address indexed newCreator)',
  'event Claimed(address indexed account, uint256 indexed claimKey, uint256 amount)',
  // OpenZeppelin PausableUpgradeable
  'event Paused(address account)',
  'event Unpaused(address account)',
  // TokenMerkleDis
  'event RootUpdated(bytes32 indexed newRoot)',
  // TokenSignDis
  'event SignerUpdated(address indexed oldSigner, address indexed newSigner)',
  // TokenVesting
  'event ScheduleCreated(uint256 indexed id, address indexed beneficiary, uint256 totalAmount)',
  'event ScheduleRevoked(uint256 indexed id)',
])

export const AIRDROP_READ_ABI = parseAbi([
  'function startTime() view returns (uint64)',
  'function endTime() view returns (uint64)',
  'function merkleRoot() view returns (bytes32)',
  'function signer() view returns (address)',
  'function usedClaimIds(bytes32 claimId) view returns (bool)',
])

export const VESTING_READ_ABI = parseAbi([
  'struct Schedule { address beneficiary; uint256 totalAmount; uint256 claimed; uint256 revokedClaimableCap; uint64 tgeTime; uint16 tgeBps; uint64 cliffDuration; uint64 vestingDuration; uint32 interval; bool revocable; bool revoked; }',
  'function getSchedule(uint256 id) view returns (Schedule)',
])

export const ERC20_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
])

/** Encoding of the Vesting initData (= Schedule[]) */
export const VESTING_INIT_PARAMS =
  '(address beneficiary, uint256 totalAmount, uint256 claimed, uint256 revokedClaimableCap, uint64 tgeTime, uint16 tgeBps, uint64 cliffDuration, uint64 vestingDuration, uint32 interval, bool revocable, bool revoked)[]'

// ─── Used by the frontend to send transactions (write methods + a few reads) ──

export const FACTORY_WRITE_ABI = parseAbi([
  'function createProject(uint8 implType, address token, uint256 fundAmount, bytes32 userSalt, bytes initData) returns (address proxy)',
  'function predictAddress(uint8 implType, address creator, bytes32 userSalt) view returns (address)',
  'function implementations(uint8 implType) view returns (address)',
])

export const ERC20_FULL_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

/** Write methods shared by all three project types (TokenDisBase) */
export const PROJECT_BASE_ABI = parseAbi([
  'function fund(uint256 amount)',
  'function withdraw(address to, uint256 amount)',
  'function pause()',
  'function unpause()',
  'function totalClaimed() view returns (uint256)',
])

export const MERKLE_WRITE_ABI = parseAbi([
  'function claim(uint256 index, address account, uint256 amount, bytes32[] proof)',
  'function setRoot(bytes32 newRoot)',
])

export const SIGN_WRITE_ABI = parseAbi([
  'function claim(address account, uint256 amount, bytes32 claimId, uint256 deadline, bytes sig)',
  'function setSigner(address newSigner)',
])

export const VESTING_WRITE_ABI = parseAbi([
  'struct Schedule { address beneficiary; uint256 totalAmount; uint256 claimed; uint256 revokedClaimableCap; uint64 tgeTime; uint16 tgeBps; uint64 cliffDuration; uint64 vestingDuration; uint32 interval; bool revocable; bool revoked; }',
  'function claim(uint256[] ids)',
  'function revoke(uint256 id)',
  'function addSchedules(Schedule[] list)',
  'function totalAllocated() view returns (uint256)',
])

/** TestTokenFactory (testnet helper: mint a 100M ERC-20 to try distributions) */
export const TEST_TOKEN_FACTORY_ABI = parseAbi([
  'function createToken(string name_, string symbol_) returns (address token)',
  'function tokensOf(address creator) view returns (address[])',
  'event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply)',
])
