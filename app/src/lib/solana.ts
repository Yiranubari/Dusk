import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Connection,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import BN from 'bn.js'

export const VAULT_PROGRAM_ID = new PublicKey('AB41HEqA7PfEbysT5c9DX7A9MNa65GDpG397CoN5cj3z')
export const MARKET_STATE_PROGRAM_ID = new PublicKey('5nHB2F1c5fzXiiUwpQqY6RT6nXfboQfMGiBnMSkCAJc9')
export const DEFAULT_STABLECOIN_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

export const DISCRIMINATORS = {
  deposit: Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]),
  withdraw: Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]),
  borrow: Buffer.from([228, 253, 131, 202, 207, 116, 89, 18]),
  mint_option: Buffer.from([76, 112, 32, 89, 147, 85, 222, 43]),
  setup_stream: Buffer.from([199, 247, 128, 137, 134, 96, 118, 187]),
  revoke_stream: Buffer.from([43, 146, 245, 96, 243, 115, 170, 52]),
  settle_option: Buffer.from([106, 24, 215, 51, 68, 138, 106, 175]),
  liquidate: Buffer.from([223, 179, 226, 125, 48, 46, 39, 74]),
}

export type OnChainVault = {
  owner: PublicKey
  stockMint: PublicKey
  collateralAmount: BN
  borrowedAmount: BN
  activeStrategy: number
  marketState: PublicKey
  bump: number
  strikePrice: BN
  expiryTimestamp: BN
  notionalAmount: BN
  streamRecipient: PublicKey
  streamStart: BN
  streamEnd: BN
  streamCliff: BN
  streamTotalAmount: BN
  streamReleasedAmount: BN
  streamRevocable: boolean
}

export function findVaultPda(user: PublicKey, stockMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), user.toBuffer(), stockMint.toBuffer()],
    VAULT_PROGRAM_ID,
  )
}

export function findMarketPda(marketId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(marketId)],
    MARKET_STATE_PROGRAM_ID,
  )
}

export function findAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  tokenProgram = TOKEN_2022_PROGRAM_ID,
): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
}

export function decodeVaultAccount(data: Buffer): OnChainVault {
  let offset = 8

  const owner = new PublicKey(data.subarray(offset, offset + 32))
  offset += 32

  const stockMint = new PublicKey(data.subarray(offset, offset + 32))
  offset += 32

  const collateralAmount = new BN(data.subarray(offset, offset + 8), 'le')
  offset += 8

  const borrowedAmount = new BN(data.subarray(offset, offset + 8), 'le')
  offset += 8

  const activeStrategy = data.readUInt8(offset)
  offset += 1

  const marketState = new PublicKey(data.subarray(offset, offset + 32))
  offset += 32

  const bump = data.readUInt8(offset)
  offset += 1

  const strikePrice = new BN(data.subarray(offset, offset + 8), 'le')
  offset += 8

  const expiryTimestamp = new BN(data.subarray(offset, offset + 8), 'le')
  offset += 8

  const notionalAmount = new BN(data.subarray(offset, offset + 8), 'le')
  offset += 8

  const streamRecipient = new PublicKey(data.subarray(offset, offset + 32))
  offset += 32

  const streamStart = new BN(data.subarray(offset, offset + 8), 'le')
  offset += 8

  const streamEnd = new BN(data.subarray(offset, offset + 8), 'le')
  offset += 8

  const streamCliff = new BN(data.subarray(offset, offset + 8), 'le')
  offset += 8

  const streamTotalAmount = new BN(data.subarray(offset, offset + 8), 'le')
  offset += 8

  const streamReleasedAmount = new BN(data.subarray(offset, offset + 8), 'le')
  offset += 8

  const streamRevocable = data.readUInt8(offset) === 1

  return {
    owner,
    stockMint,
    collateralAmount,
    borrowedAmount,
    activeStrategy,
    marketState,
    bump,
    strikePrice,
    expiryTimestamp,
    notionalAmount,
    streamRecipient,
    streamStart,
    streamEnd,
    streamCliff,
    streamTotalAmount,
    streamReleasedAmount,
    streamRevocable,
  }
}

export function buildDepositInstruction(
  user: PublicKey,
  stockMint: PublicKey,
  marketStatePubkey: PublicKey,
  amountBaseUnits: BN,
  tokenProgram = TOKEN_2022_PROGRAM_ID,
): { transaction: Transaction; vaultPda: PublicKey } {
  const [vaultPda] = findVaultPda(user, stockMint)
  const userAta = findAssociatedTokenAddress(stockMint, user, false, tokenProgram)
  const vaultAta = findAssociatedTokenAddress(stockMint, vaultPda, true, tokenProgram)

  const transaction = new Transaction()

  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(
      user,
      userAta,
      user,
      stockMint,
      tokenProgram,
    ),
  )

  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(
      user,
      vaultAta,
      vaultPda,
      stockMint,
      tokenProgram,
    ),
  )

  const data = Buffer.concat([
    DISCRIMINATORS.deposit,
    amountBaseUnits.toArrayLike(Buffer, 'le', 8),
  ])

  const depositIx = new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: stockMint, isSigner: false, isWritable: false },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: marketStatePubkey, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  })

  transaction.add(depositIx)

  return { transaction, vaultPda }
}

export function buildWithdrawInstruction(
  user: PublicKey,
  stockMint: PublicKey,
  marketStatePubkey: PublicKey,
  priceFeedPubkey: PublicKey,
  amountBaseUnits: BN,
  stablecoinMint: PublicKey = DEFAULT_STABLECOIN_MINT,
  tokenProgram = TOKEN_2022_PROGRAM_ID,
): { transaction: Transaction } {
  const [vaultPda] = findVaultPda(user, stockMint)
  const userAta = findAssociatedTokenAddress(stockMint, user, false, tokenProgram)
  const vaultAta = findAssociatedTokenAddress(stockMint, vaultPda, true, tokenProgram)

  const transaction = new Transaction()

  const data = Buffer.concat([
    DISCRIMINATORS.withdraw,
    amountBaseUnits.toArrayLike(Buffer, 'le', 8),
  ])

  const withdrawIx = new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: stockMint, isSigner: false, isWritable: false },
      { pubkey: marketStatePubkey, isSigner: false, isWritable: false },
      { pubkey: priceFeedPubkey, isSigner: false, isWritable: false },
      { pubkey: stablecoinMint, isSigner: false, isWritable: false },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  })

  transaction.add(withdrawIx)
  return { transaction }
}

export function buildBorrowInstruction(
  user: PublicKey,
  stockMint: PublicKey,
  marketStatePubkey: PublicKey,
  priceFeedPubkey: PublicKey,
  amountBaseUnits: BN,
  stablecoinMint: PublicKey = DEFAULT_STABLECOIN_MINT,
  tokenProgram = TOKEN_2022_PROGRAM_ID,
): { transaction: Transaction } {
  const [vaultPda] = findVaultPda(user, stockMint)
  const vaultStablecoinAta = findAssociatedTokenAddress(stablecoinMint, vaultPda, true, TOKEN_PROGRAM_ID)
  const userStablecoinAta = findAssociatedTokenAddress(stablecoinMint, user, false, TOKEN_PROGRAM_ID)

  const transaction = new Transaction()

  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(
      user,
      userStablecoinAta,
      user,
      stablecoinMint,
      TOKEN_PROGRAM_ID,
    ),
  )

  const data = Buffer.concat([
    DISCRIMINATORS.borrow,
    amountBaseUnits.toArrayLike(Buffer, 'le', 8),
  ])

  const borrowIx = new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: stockMint, isSigner: false, isWritable: false },
      { pubkey: marketStatePubkey, isSigner: false, isWritable: false },
      { pubkey: priceFeedPubkey, isSigner: false, isWritable: false },
      { pubkey: stablecoinMint, isSigner: false, isWritable: false },
      { pubkey: vaultStablecoinAta, isSigner: false, isWritable: true },
      { pubkey: userStablecoinAta, isSigner: false, isWritable: true },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  })

  transaction.add(borrowIx)
  return { transaction }
}

export function buildMintOptionInstruction(
  owner: PublicKey,
  stockMint: PublicKey,
  marketStatePubkey: PublicKey,
  priceFeedPubkey: PublicKey,
  strikePriceBaseUnits: BN,
  expiryTimestampSec: BN,
): { transaction: Transaction } {
  const [vaultPda] = findVaultPda(owner, stockMint)

  const transaction = new Transaction()

  const data = Buffer.concat([
    DISCRIMINATORS.mint_option,
    strikePriceBaseUnits.toArrayLike(Buffer, 'le', 8),
    expiryTimestampSec.toArrayLike(Buffer, 'le', 8),
  ])

  const mintOptionIx = new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: stockMint, isSigner: false, isWritable: false },
      { pubkey: marketStatePubkey, isSigner: false, isWritable: false },
      { pubkey: priceFeedPubkey, isSigner: false, isWritable: false },
    ],
    data,
  })

  transaction.add(mintOptionIx)
  return { transaction }
}

export function buildSettleOptionInstruction(
  caller: PublicKey,
  vaultOwner: PublicKey,
  stockMint: PublicKey,
  marketStatePubkey: PublicKey,
  priceFeedPubkey: PublicKey,
): { transaction: Transaction } {
  const [vaultPda] = findVaultPda(vaultOwner, stockMint)

  const transaction = new Transaction()

  const data = DISCRIMINATORS.settle_option

  const settleIx = new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: caller, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: stockMint, isSigner: false, isWritable: false },
      { pubkey: marketStatePubkey, isSigner: false, isWritable: false },
      { pubkey: priceFeedPubkey, isSigner: false, isWritable: false },
    ],
    data,
  })

  transaction.add(settleIx)
  return { transaction }
}

export function buildSetupStreamInstruction(
  owner: PublicKey,
  stockMint: PublicKey,
  recipient: PublicKey,
  startSec: BN,
  endSec: BN,
  cliffSec: BN,
  amountBaseUnits: BN,
  revocable: boolean,
): { transaction: Transaction } {
  const [vaultPda] = findVaultPda(owner, stockMint)

  const transaction = new Transaction()

  const data = Buffer.concat([
    DISCRIMINATORS.setup_stream,
    recipient.toBuffer(),
    startSec.toArrayLike(Buffer, 'le', 8),
    endSec.toArrayLike(Buffer, 'le', 8),
    cliffSec.toArrayLike(Buffer, 'le', 8),
    amountBaseUnits.toArrayLike(Buffer, 'le', 8),
    Buffer.from([revocable ? 1 : 0]),
  ])

  const setupStreamIx = new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: stockMint, isSigner: false, isWritable: false },
    ],
    data,
  })

  transaction.add(setupStreamIx)
  return { transaction }
}

export function buildRevokeStreamInstruction(
  owner: PublicKey,
  stockMint: PublicKey,
  marketStatePubkey: PublicKey,
  priceFeedPubkey: PublicKey,
  recipient: PublicKey,
  tokenProgram = TOKEN_2022_PROGRAM_ID,
): { transaction: Transaction } {
  const [vaultPda] = findVaultPda(owner, stockMint)
  const vaultAta = findAssociatedTokenAddress(stockMint, vaultPda, true, tokenProgram)
  const recipientAta = findAssociatedTokenAddress(stockMint, recipient, false, tokenProgram)

  const transaction = new Transaction()

  const data = DISCRIMINATORS.revoke_stream

  const revokeIx = new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: stockMint, isSigner: false, isWritable: false },
      { pubkey: marketStatePubkey, isSigner: false, isWritable: false },
      { pubkey: priceFeedPubkey, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data,
  })

  transaction.add(revokeIx)
  return { transaction }
}

export async function fetchOnChainVault(
  connection: Connection,
  user: PublicKey,
  stockMint: PublicKey,
): Promise<OnChainVault | null> {
  const [vaultPda] = findVaultPda(user, stockMint)
  const accountInfo = await connection.getAccountInfo(vaultPda)
  if (!accountInfo || accountInfo.data.length < 8) {
    return null
  }
  return decodeVaultAccount(accountInfo.data)
}

export function buildLiquidateInstruction(
  liquidator: PublicKey,
  vaultOwner: PublicKey,
  stockMint: PublicKey,
  marketStatePubkey: PublicKey,
  priceFeedPubkey: PublicKey,
  stablecoinMint: PublicKey = DEFAULT_STABLECOIN_MINT,
  tokenProgram = TOKEN_2022_PROGRAM_ID,
  stablecoinTokenProgram = TOKEN_PROGRAM_ID,
): { transaction: Transaction } {
  const [vaultPda] = findVaultPda(vaultOwner, stockMint)
  const vaultStablecoinAta = findAssociatedTokenAddress(stablecoinMint, vaultPda, true, stablecoinTokenProgram)
  const liquidatorStablecoinAta = findAssociatedTokenAddress(stablecoinMint, liquidator, false, stablecoinTokenProgram)
  const vaultTokenAta = findAssociatedTokenAddress(stockMint, vaultPda, true, tokenProgram)
  const liquidatorTokenAta = findAssociatedTokenAddress(stockMint, liquidator, false, tokenProgram)

  const transaction = new Transaction()

  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(
      liquidator,
      liquidatorTokenAta,
      liquidator,
      stockMint,
      tokenProgram,
    ),
  )

  const data = DISCRIMINATORS.liquidate

  const liquidateIx = new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: liquidator, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: stockMint, isSigner: false, isWritable: false },
      { pubkey: marketStatePubkey, isSigner: false, isWritable: false },
      { pubkey: priceFeedPubkey, isSigner: false, isWritable: false },
      { pubkey: stablecoinMint, isSigner: false, isWritable: false },
      { pubkey: vaultStablecoinAta, isSigner: false, isWritable: true },
      { pubkey: liquidatorStablecoinAta, isSigner: false, isWritable: true },
      { pubkey: vaultTokenAta, isSigner: false, isWritable: true },
      { pubkey: liquidatorTokenAta, isSigner: false, isWritable: true },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: stablecoinTokenProgram, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  })

  transaction.add(liquidateIx)
  return { transaction }
}

export type PythPriceData = {
  feedId: string
  price: number
  conf: number
  publishTime: number
}

export function decodePriceUpdateV2(data: Buffer): PythPriceData {
  let offset = 8 + 32 + 1
  const feedId = data.subarray(offset, offset + 32).toString('hex')
  offset += 32
  const price = data.readBigInt64LE(offset)
  offset += 8
  const conf = data.readBigUInt64LE(offset)
  offset += 8
  const expo = data.readInt32LE(offset)
  offset += 4
  const publishTime = Number(data.readBigInt64LE(offset))

  const realPrice = Number(price) * Math.pow(10, expo)
  const realConf = Number(conf) * Math.pow(10, expo)

  return {
    feedId,
    price: realPrice,
    conf: realConf,
    publishTime,
  }
}

export async function fetchOnChainPythPrice(
  connection: Connection,
  priceFeedPubkey: PublicKey,
): Promise<PythPriceData | null> {
  try {
    const accountInfo = await connection.getAccountInfo(priceFeedPubkey)
    if (!accountInfo || accountInfo.data.length < 90) {
      return null
    }
    return decodePriceUpdateV2(accountInfo.data)
  } catch {
    return null
  }
}
