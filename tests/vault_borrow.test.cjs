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

describe("Vault Borrow", () => {
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

  let staleMarketPda;
  let staleStockMint;
  let staleUserStockAta;
  let staleVaultPda;
  let staleVaultStockAta;
  let staleVaultStablecoinAta;
  let staleUserStablecoinAtaAddress;

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

    const marketId = "BORROW_" + Date.now().toString().slice(-6);
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

    const staleMarketId = "STALE_" + Date.now().toString().slice(-6);
    [staleMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from(staleMarketId)],
      marketStateProgram.programId
    );

    await marketStateProgram.methods
      .initializeMarket(
        staleMarketId,
        new BN(500),
        new BN(1)
      )
      .accounts({
        market: staleMarketPda,
        authority: wallet.publicKey,
        priceFeed: pythAaplFeed,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await marketStateProgram.methods
      .updateMarketState({ open: {} })
      .accounts({
        market: staleMarketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    const staleStockKeypair = Keypair.generate();
    const staleInitTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: staleStockKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeScaledUiAmountConfigInstruction(
        staleStockKeypair.publicKey,
        wallet.publicKey,
        1.0,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        staleStockKeypair.publicKey,
        8,
        wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(provider.connection, staleInitTx, [wallet.payer, staleStockKeypair]);
    staleStockMint = staleStockKeypair.publicKey;

    staleUserStockAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      staleStockMint,
      wallet.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      staleStockMint,
      staleUserStockAta.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const [sVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), wallet.publicKey.toBuffer(), staleStockMint.toBuffer()],
      vaultProgram.programId
    );
    staleVaultPda = sVaultPda;

    const [sVaultStockAta] = PublicKey.findProgramAddressSync(
      [staleVaultPda.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), staleStockMint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    staleVaultStockAta = sVaultStockAta;

    await vaultProgram.methods
      .deposit(new BN(100_000_000))
      .accounts({
        user: wallet.publicKey,
        vault: staleVaultPda,
        stockMint: staleStockMint,
        userTokenAccount: staleUserStockAta.address,
        vaultTokenAccount: staleVaultStockAta,
        marketState: staleMarketPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    staleVaultStablecoinAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      stablecoinMint,
      staleVaultPda,
      true,
      "confirmed",
      undefined,
      TOKEN_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      stablecoinMint,
      staleVaultStablecoinAta.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    [staleUserStablecoinAtaAddress] = PublicKey.findProgramAddressSync(
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

  it("1. Successful borrow when market is open and within LTV — verify borrowed_amount and active_strategy updated correctly", async () => {
    const borrowAmount = new BN(50_000_000);
    await vaultProgram.methods
      .borrow(borrowAmount)
      .accounts(getBorrowAccounts())
      .rpc();

    const vaultAccount = await vaultProgram.account.vault.fetch(vaultPda);
    assert.equal(vaultAccount.borrowedAmount.toNumber(), 50_000_000);
    assert.deepEqual(vaultAccount.activeStrategy, { borrow: {} });

    const userStableBal = await provider.connection.getTokenAccountBalance(userStablecoinAtaAddress);
    assert.equal(userStableBal.value.amount, "50000000");
  });

  it("2. Borrow rejected when exceeding open market LTV", async () => {
    const excessiveAmount = new BN(160_000_000);
    try {
      await vaultProgram.methods
        .borrow(excessiveAmount)
        .accounts(getBorrowAccounts())
        .rpc();
      assert.fail("Should have failed due to exceeding LTV limit");
    } catch (e) {
      assert.include(e.message, "ExceedsLtvLimit");
    }
  });

  it("3. Borrow rejected when market is closed and amount exceeds closed LTV, even if within open LTV", async () => {
    await marketStateProgram.methods
      .updateMarketState({ closed: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    const overClosedLimitAmount = new BN(75_000_000);
    try {
      await vaultProgram.methods
        .borrow(overClosedLimitAmount)
        .accounts(getBorrowAccounts())
        .rpc();
      assert.fail("Should have failed due to exceeding closed market LTV");
    } catch (e) {
      assert.include(e.message, "ExceedsLtvLimit");
    }
  });

  it("4. Borrow rejected when market is stale", async () => {
    await marketStateProgram.methods
      .updateMarketState({ stale: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    try {
      await vaultProgram.methods
        .borrow(new BN(1_000_000))
        .accounts(getBorrowAccounts())
        .rpc();
      assert.fail("Should have failed due to stale market state");
    } catch (e) {
      assert.include(e.message, "MarketStateStale");
    }
  });

  it("5. Borrow rejected when Pyth price is stale", async () => {
    try {
      await vaultProgram.methods
        .borrow(new BN(10_000_000))
        .accounts({
          user: wallet.publicKey,
          vault: staleVaultPda,
          stockMint: staleStockMint,
          marketState: staleMarketPda,
          priceUpdate: pythAaplFeed,
          stablecoinMint: stablecoinMint,
          vaultStablecoinAccount: staleVaultStablecoinAta.address,
          userStablecoinAccount: staleUserStablecoinAtaAddress,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      assert.fail("Should have failed due to stale price feed");
    } catch (e) {
      assert.include(e.message, "PriceFeedStale");
    }
  });

  it("6. Borrow rejected when vault is already in an incompatible strategy", async () => {
    await marketStateProgram.methods
      .updateMarketState({ open: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    const ccStockKeypair = Keypair.generate();
    const extensions = [ExtensionType.ScaledUiAmountConfig];
    const mintLen = getMintLen(extensions);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const initTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: ccStockKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeScaledUiAmountConfigInstruction(
        ccStockKeypair.publicKey,
        wallet.publicKey,
        1.0,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        ccStockKeypair.publicKey,
        8,
        wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(provider.connection, initTx, [wallet.payer, ccStockKeypair]);

    const ccUserStockAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      ccStockKeypair.publicKey,
      wallet.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      ccStockKeypair.publicKey,
      ccUserStockAta.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const [ccVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), wallet.publicKey.toBuffer(), ccStockKeypair.publicKey.toBuffer()],
      vaultProgram.programId
    );

    const [ccVaultStockAta] = PublicKey.findProgramAddressSync(
      [ccVaultPda.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), ccStockKeypair.publicKey.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await vaultProgram.methods
      .deposit(new BN(100_000_000))
      .accounts({
        user: wallet.publicKey,
        vault: ccVaultPda,
        stockMint: ccStockKeypair.publicKey,
        userTokenAccount: ccUserStockAta.address,
        vaultTokenAccount: ccVaultStockAta,
        marketState: marketPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const ccVaultStablecoinAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      stablecoinMint,
      ccVaultPda,
      true,
      "confirmed",
      undefined,
      TOKEN_PROGRAM_ID
    );

    const feedInfo = await provider.connection.getAccountInfo(pythAaplFeed);
    const livePrice = feedInfo.data.readBigInt64LE(73);
    const slot = await provider.connection.getSlot();
    const now = await provider.connection.getBlockTime(slot);

    await vaultProgram.methods
      .mintOption(new BN(livePrice.toString()), new BN(now + 1000))
      .accounts({
        owner: wallet.publicKey,
        vault: ccVaultPda,
        stockMint: ccStockKeypair.publicKey,
        marketState: marketPda,
        priceUpdate: pythAaplFeed,
      })
      .rpc();

    try {
      await vaultProgram.methods
        .borrow(new BN(10_000_000))
        .accounts({
          user: wallet.publicKey,
          vault: ccVaultPda,
          stockMint: ccStockKeypair.publicKey,
          marketState: marketPda,
          priceUpdate: pythAaplFeed,
          stablecoinMint: stablecoinMint,
          vaultStablecoinAccount: ccVaultStablecoinAta.address,
          userStablecoinAccount: userStablecoinAtaAddress,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      assert.fail("Should have failed due to IncompatibleStrategy");
    } catch (e) {
      assert.include(e.message, "IncompatibleStrategy");
    }
  });
});
