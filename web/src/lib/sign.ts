/**
 * Signature airdrop: claimId generation + EIP-712 signing (mirrors TokenSignDis.sol exactly)
 */
import { encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chain } from './chain'

/**
 * claimId = keccak256(abi.encode(project, account, nonce))
 * nonce = how many times this address has successfully claimed in this project.
 * Each nonce can be used only once on-chain (usedClaimIds), so even duplicate signatures can never pay out twice.
 */
export function computeClaimId(project: Address, account: Address, nonce: number): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('address project, address account, uint256 nonce'), [
      project, account, BigInt(nonce),
    ]),
  )
}

export async function signClaim(opts: {
  privateKey: Hex
  project: Address
  account: Address
  amount: bigint
  claimId: Hex
  deadline: bigint
}): Promise<Hex> {
  const signer = privateKeyToAccount(opts.privateKey)
  return signer.signTypedData({
    domain: { name: 'TokenSignDis', version: '1', chainId: chain().id, verifyingContract: opts.project },
    types: {
      ClaimRequest: [
        { name: 'account', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'claimId', type: 'bytes32' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'ClaimRequest',
    message: { account: opts.account, amount: opts.amount, claimId: opts.claimId, deadline: opts.deadline },
  })
}

/** Normalize a private key (0x prefix optional); returns null if the format is invalid */
export function normalizePrivateKey(raw: string): Hex | null {
  const s = raw.trim().replace(/^0x/i, '')
  return /^[0-9a-fA-F]{64}$/.test(s) ? (`0x${s.toLowerCase()}` as Hex) : null
}
