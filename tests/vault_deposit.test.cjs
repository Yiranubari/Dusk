const anchor = require("@coral-xyz/anchor");
const { assert } = require("chai");
const {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
} = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

const {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} = require("@solana/spl-token");

describe("Vault Deposit (Token-2022)", () => {
  const secretKey = JSON.parse(
    fs.readFileSync("/home/vikky/.config/solana/id.json", "utf-8")
  );
  const wallet = new anchor.Wallet(
    Keypair.fromSecretKey(Uint8Array.from(secretKey))
  );
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection("http://127.0.0.1:8899", "confirmed"),
    wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);

  let vaultProgram;
  let mint;
  let userAta;
  let vaultPda;
  let vaultAtaAddress;
  let marketState;
  let assertionLog = [];

  before(async () => {
    const idlPath = path.join(__dirname, "..", "target", "idl", "vault.json");
    const idlJson = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    vaultProgram = new anchor.Program(idlJson, provider);

    mint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      9,
      Keypair.generate(),
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );

    userAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mint,
      wallet.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      userAta.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), wallet.publicKey.toBuffer(), mint.toBuffer()],
      vaultProgram.programId
    );

    [vaultAtaAddress] = PublicKey.findProgramAddressSync(
      [
        vaultPda.toBuffer(),
        TOKEN_2022_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    marketState = Keypair.generate();
    const msTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: marketState.publicKey,
        space: 1024,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(1024),
        programId: SystemProgram.programId,
      })
    );
    await sendAndConfirmTransaction(provider.connection, msTx, [
      wallet.payer,
      marketState,
    ]);
  });

  function depositAccounts() {
    return {
      user: wallet.publicKey,
      vault: vaultPda,
      stockMint: mint,
      userTokenAccount: userAta.address,
      vaultTokenAccount: vaultAtaAddress,
      marketState: marketState.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    };
  }

  it("first deposit sets collateral_amount to exactly 100_000_000", async () => {
    await vaultProgram.methods
      .deposit(new anchor.BN(100_000_000))
      .accounts(depositAccounts())
      .rpc();

    const vaultAccount = await vaultProgram.account.vault.fetch(vaultPda);
    const actual = vaultAccount.collateralAmount.toNumber();
    assertionLog.push(`first_deposit_assert fired: actual=${actual}`);
    console.log(assertionLog[assertionLog.length - 1]);
    assert.equal(actual, 100_000_000);
    assert.isTrue(wallet.publicKey.equals(vaultAccount.owner));
    assert.isTrue(mint.equals(vaultAccount.stockMint));
  });

  it("second deposit accumulates collateral_amount to exactly 150_000_000", async () => {
    await vaultProgram.methods
      .deposit(new anchor.BN(50_000_000))
      .accounts(depositAccounts())
      .rpc();

    const vaultAccount = await vaultProgram.account.vault.fetch(vaultPda);
    const actual = vaultAccount.collateralAmount.toNumber();
    assertionLog.push(`second_deposit_assert fired: actual=${actual}`);
    console.log(assertionLog[assertionLog.length - 1]);
    assert.equal(actual, 150_000_000);
    assert.equal(assertionLog.length, 2, "both intermediate assertions must have fired");
  });
});
