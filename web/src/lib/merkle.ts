/**
 * Merkle tree construction. Must match the contract's leaf format exactly:
 *   leaf = keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))))
 * This is exactly the format of @openzeppelin/merkle-tree's StandardMerkleTree with ['uint256','address','uint256'].
 */
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import type { CsvRow } from './csv'

export interface BuiltTree {
  root: `0x${string}`
  entries: { index: number; account: `0x${string}`; amount: bigint; proof: string[] }[]
  totalAmount: bigint
}

export function buildMerkleTree(rows: CsvRow[]): BuiltTree {
  const values = rows.map((r, i) => [i.toString(), r.account, r.amount.toString()])
  const tree = StandardMerkleTree.of(values, ['uint256', 'address', 'uint256'])

  // i in tree.entries() is the original array index (the tree reorders internally, so proofs must be fetched by index)
  const entries: BuiltTree['entries'] = []
  for (const [i, v] of tree.entries()) {
    entries.push({ index: Number(v[0]), account: v[1] as `0x${string}`, amount: BigInt(v[2]), proof: tree.getProof(i) })
  }
  entries.sort((a, b) => a.index - b.index)

  return {
    root: tree.root as `0x${string}`,
    entries,
    totalAmount: rows.reduce((s, r) => s + r.amount, 0n),
  }
}
