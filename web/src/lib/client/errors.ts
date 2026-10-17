/**
 * Turn wallet / contract / API errors into a single plain-English sentence for users
 */
import {
  BaseError, ContractFunctionRevertedError, UserRejectedRequestError,
  ResourceUnavailableRpcError, HttpRequestError, InternalRpcError, LimitExceededRpcError,
} from 'viem'
import { ApiClientError } from './api'
import { activeNetworkConfig } from './activeNetwork'

/** Shown when the wallet can't reach the selected network's chain through its own RPC setting */
export function walletRpcHint() {
  const c = activeNetworkConfig().chain
  return `Your wallet couldn't reach ${c.name}. Open your wallet, approve or reject any pending request, ` +
    `and make sure the ${c.name} network uses RPC URL ${c.rpcUrls.default.http[0]} (chain ID ${c.id}). ` +
    'The banner at the top of the page can set it for you.'
}

/** Contract custom error name -> message */
const CONTRACT_ERRORS: Record<string, string> = {
  MissingImplementation: 'The factory has no contract registered for this distribution type yet.',
  ZeroAmount: 'Amount must be greater than 0.',
  ZeroAddress: 'Address cannot be empty.',
  NotCreator: 'Only the project creator can do this.',
  InvalidTimeWindow: 'Invalid time window (end must be after start, and root can only change before start).',
  NotInClaimWindow: 'Claiming is not open right now.',
  AlreadyClaimed: 'This allocation has already been claimed.',
  InvalidProof: 'Merkle proof is invalid.',
  DeadlineExpired: 'The claim signature expired. Please try again.',
  ClaimIdUsed: 'This claim was already used.',
  InvalidSignature: 'The claim signature is invalid.',
  InvalidSigner: 'Invalid signer address.',
  EnforcedPause: 'This project is paused.',
  ExpectedPause: 'This project is not paused.',
  RecoverableExceeded: 'Amount exceeds what can be withdrawn right now.',
  NoClaimableAmount: 'Nothing is claimable yet.',
  NotBeneficiary: 'You are not the beneficiary of this schedule.',
  NotRevocable: 'This schedule is not revocable.',
  AlreadyRevoked: 'This schedule is already revoked.',
  AllocationExceedsFunding: 'Schedules total more than the funded amount.',
  InsufficientFundingForSchedules: 'Not enough tokens in the project for these schedules. Fund it first.',
  ERC20InsufficientBalance: 'Insufficient token balance.',
  ERC20InsufficientAllowance: 'Token allowance is too low. Approve first.',
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.message
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return 'Request rejected in wallet.'
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null
    const name = revert?.data?.errorName
    if (name) return CONTRACT_ERRORS[name] ?? `Contract error: ${name}`
    if (/user rejected|denied/i.test(e.message)) return 'Request rejected in wallet.'
    // -32002: wallet has a pending request, or its RPC can't serve the request
    if (e.walk((x) => x instanceof ResourceUnavailableRpcError || x instanceof HttpRequestError ||
      x instanceof InternalRpcError || x instanceof LimitExceededRpcError)) return walletRpcHint()
    return e.shortMessage || e.message
  }
  if (e instanceof Error) return e.message.slice(0, 200)
  return String(e)
}
