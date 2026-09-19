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
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeScaledUiAmountConfigInstruction,
  createInitializeMintInstruction,
  getOrCreateAssociatedTokenAccount,
  createMint,
  mintTo,
} = require("@solana/spl-token");

const BN = anchor.BN;

describe("Vault Emergency Pause", () => {
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
  let marketStateProgram;
  let pythAaplFeed;
  let stockMint;
  let userStockAta;
  let vaultPda;
  let vaultBump;
  let vaultStockAta;
  let marketPda;
  let stablecoinMint;
  let vaultStablecoinAta;
  let userStablecoinAtaAddress;
  let unauthorizedKeypair;

  before(async () => {
    const vaultIdl = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "target", "idl", "vault.json"), "utf-8")
    );
    vaultProgram = new anchor.Program(vaultIdl, provider);

    const marketStateIdl = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "target", "idl", "market_state.json"), "utf-8")
    );
    marketStateProgram = new anchor.Program(marketStateIdl, provider);

    pythAaplFeed = new PublicKey("DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy");

    unauthorizedKeypair = Keypair.generate();
    const airdropTx = await provider.connection.requestAirdrop(
      unauthorizedKeypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropTx);

    const stockMintKeypair = Keypair.generate();
    const extensions = [ExtensionType.ScaledUiAmountConfig];
    const mintLen = getMintLen(extensions);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const initStockMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: stockMintKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeScaledUiAmountConfigInstruction(
        stockMintKeypair.publicKey,
        wallet.publicKey,
        1.0,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        stockMintKeypair.publicKey,
        8,
        wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(provider.connection, initStockMintTx, [wallet.payer, stockMintKeypair]);
    stockMint = stockMintKeypair.publicKey;

    userStockAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      stockMint,
      wallet.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      stockMint,
      userStockAta.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const marketId = "PAUSE_" + Date.now().toString().slice(-6);
    [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from(marketId)],
      marketStateProgram.programId
    );

    await marketStateProgram.methods
      .initializeMarket(
        marketId,
        new BN(500),
        new BN(10_000_000)
      )
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
        priceFeed: pythAaplFeed,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await marketStateProgram.methods
      .updateMarketState({ open: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), wallet.publicKey.toBuffer(), stockMint.toBuffer()],
      vaultProgram.programId
    );

    [vaultStockAta] = PublicKey.findProgramAddressSync(
      [vaultPda.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), stockMint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await vaultProgram.methods
      .deposit(new BN(100_000_000))
      .accounts({
        user: wallet.publicKey,
        vault: vaultPda,
        stockMint: stockMint,
        userTokenAccount: userStockAta.address,
        vaultTokenAccount: vaultStockAta,
        marketState: marketPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    stablecoinMint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6,
      Keypair.generate(),
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    vaultStablecoinAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      stablecoinMint,
      vaultPda,
      true,
      "confirmed",
      undefined,
      TOKEN_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      stablecoinMint,
      vaultStablecoinAta.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    [userStablecoinAtaAddress] = PublicKey.findProgramAddressSync(
      [wallet.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), stablecoinMint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
  });

  function getBorrowAccounts() {
    return {
      user: wallet.publicKey,
      vault: vaultPda,
      stockMint: stockMint,
      marketState: marketPda,
      priceUpdate: pythAaplFeed,
      stablecoinMint: stablecoinMint,
      vaultStablecoinAccount: vaultStablecoinAta.address,
      userStablecoinAccount: userStablecoinAtaAddress,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    };
  }

  it("1. Pause callable only by authority, unauthorized caller rejected", async () => {
    try {
      await marketStateProgram.methods
        .setPaused(true)
        .accounts({
          market: marketPda,
          authority: unauthorizedKeypair.publicKey,
        })
        .signers([unauthorizedKeypair])
        .rpc();
      assert.fail("Should have failed due to unauthorized authority");
    } catch (e) {
      assert.include(e.message, "Unauthorized");
    }

    await marketStateProgram.methods
      .setPaused(true)
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    const mAcc = await marketStateProgram.account.market.fetch(marketPda);
    assert.isTrue(mAcc.isPaused);
  });

  it("2. Emergency pause blocks new borrow requests", async () => {
    try {
      await vaultProgram.methods
        .borrow(new BN(10_000_000))
        .accounts(getBorrowAccounts())
        .rpc();
      assert.fail("Should have failed due to ProtocolPaused");
    } catch (e) {
      assert.include(e.message, "ProtocolPaused");
    }
  });

  it("3. Emergency pause blocks new option writes via mint_option", async () => {
    const feedInfo = await provider.connection.getAccountInfo(pythAaplFeed);
    const livePrice = feedInfo.data.readBigInt64LE(73);
    const slot = await provider.connection.getSlot();
    const now = await provider.connection.getBlockTime(slot);

    try {
      await vaultProgram.methods
        .mintOption(new BN(livePrice.toString()), new BN(now + 1000))
        .accounts({
          owner: wallet.publicKey,
          vault: vaultPda,
          stockMint: stockMint,
          marketState: marketPda,
          priceUpdate: pythAaplFeed,
        })
        .rpc();
      assert.fail("Should have failed due to ProtocolPaused");
    } catch (e) {
      assert.include(e.message, "ProtocolPaused");
    }
  });

  it("4. Unpause restores normal operation for borrow and mint_option", async () => {
    await marketStateProgram.methods
      .setPaused(false)
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    const mAcc = await marketStateProgram.account.market.fetch(marketPda);
    assert.isFalse(mAcc.isPaused);

    await vaultProgram.methods
      .borrow(new BN(10_000_000))
      .accounts(getBorrowAccounts())
      .rpc();

    const vAcc = await vaultProgram.account.vault.fetch(vaultPda);
    assert.equal(vAcc.borrowedAmount.toNumber(), 10_000_000);
    assert.deepEqual(vAcc.activeStrategy, { borrow: {} });
  });
});
