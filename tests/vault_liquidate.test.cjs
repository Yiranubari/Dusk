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

describe("Vault Liquidation", () => {
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

  let liquidatorKeypair;
  let liquidatorStablecoinAta;
  let liquidatorStockAta;

  let staleMarketPda;
  let staleStockMint;
  let staleUserStockAta;
  let staleVaultPda;
  let staleVaultStockAta;
  let staleVaultStablecoinAta;

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

    liquidatorKeypair = Keypair.generate();
    const fundLiquidatorTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: liquidatorKeypair.publicKey,
        lamports: 10 * anchor.web3.LAMPORTS_PER_SOL,
      })
    );
    await sendAndConfirmTransaction(provider.connection, fundLiquidatorTx, [wallet.payer]);

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

    const marketId = "LIQ_" + Date.now().toString().slice(-6);
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

    liquidatorStablecoinAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      stablecoinMint,
      liquidatorKeypair.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      stablecoinMint,
      liquidatorStablecoinAta.address,
      wallet.publicKey,
      500_000_000,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    liquidatorStockAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      stockMint,
      liquidatorKeypair.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const borrowAmount = new BN(180_000_000);
    await vaultProgram.methods
      .borrow(borrowAmount)
      .accounts({
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
      })
      .rpc();

    const staleMarketId = "STALE_LIQ_" + Date.now().toString().slice(-6);
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
  });

  function getLiquidationAccounts(customVault, customStock, customMarket, customVaultStable, customVaultStock) {
    const stockToUse = customStock || stockMint;
    const [liqStockAta] = PublicKey.findProgramAddressSync(
      [liquidatorKeypair.publicKey.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), stockToUse.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    return {
      liquidator: liquidatorKeypair.publicKey,
      vault: customVault || vaultPda,
      stockMint: stockToUse,
      marketState: customMarket || marketPda,
      priceUpdate: pythAaplFeed,
      stablecoinMint: stablecoinMint,
      vaultStablecoinAccount: customVaultStable || vaultStablecoinAta.address,
      liquidatorStablecoinAccount: liquidatorStablecoinAta.address,
      vaultTokenAccount: customVaultStock || vaultStockAta,
      liquidatorTokenAccount: liqStockAta,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      stablecoinTokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    };
  }

  it("1. Liquidation fails when called against a healthy position (Open market, debt within 80% threshold)", async () => {
    assert.notEqual(liquidatorKeypair.publicKey.toBase58(), wallet.publicKey.toBase58());

    try {
      await vaultProgram.methods
        .liquidate()
        .accounts(getLiquidationAccounts())
        .signers([liquidatorKeypair])
        .rpc();
      assert.fail("Should have failed against healthy position");
    } catch (e) {
      assert.include(e.message, "VaultNotUndercollateralized");
    }
  });

  it("2. Liquidation succeeds when market flips to Closed (tightens threshold to 55%), verified token balance changes", async () => {
    assert.notEqual(liquidatorKeypair.publicKey.toBase58(), wallet.publicKey.toBase58());

    await marketStateProgram.methods
      .updateMarketState({ closed: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    const vaultBefore = await vaultProgram.account.vault.fetch(vaultPda);
    assert.equal(vaultBefore.borrowedAmount.toNumber(), 180_000_000);
    assert.equal(vaultBefore.collateralAmount.toNumber(), 100_000_000);
    assert.deepEqual(vaultBefore.activeStrategy, { borrow: {} });

    const liquidatorStableBefore = await provider.connection.getTokenAccountBalance(liquidatorStablecoinAta.address);
    const liquidatorStockBefore = await provider.connection.getTokenAccountBalance(liquidatorStockAta.address);
    const vaultStableBefore = await provider.connection.getTokenAccountBalance(vaultStablecoinAta.address);
    const vaultStockBefore = await provider.connection.getTokenAccountBalance(vaultStockAta);

    await vaultProgram.methods
      .liquidate()
      .accounts(getLiquidationAccounts())
      .signers([liquidatorKeypair])
      .rpc();

    const vaultAfter = await vaultProgram.account.vault.fetch(vaultPda);
    assert.equal(vaultAfter.borrowedAmount.toNumber(), 0);
    assert.deepEqual(vaultAfter.activeStrategy, { none: {} });
    assert.isBelow(vaultAfter.collateralAmount.toNumber(), 100_000_000);

    const liquidatorStableAfter = await provider.connection.getTokenAccountBalance(liquidatorStablecoinAta.address);
    const liquidatorStockAfter = await provider.connection.getTokenAccountBalance(liquidatorStockAta.address);
    const vaultStableAfter = await provider.connection.getTokenAccountBalance(vaultStablecoinAta.address);
    const vaultStockAfter = await provider.connection.getTokenAccountBalance(vaultStockAta);

    const stableRepaid = BigInt(liquidatorStableBefore.value.amount) - BigInt(liquidatorStableAfter.value.amount);
    assert.equal(stableRepaid.toString(), "180000000");

    const vaultStableIncrease = BigInt(vaultStableAfter.value.amount) - BigInt(vaultStableBefore.value.amount);
    assert.equal(vaultStableIncrease.toString(), "180000000");

    const stockSeized = BigInt(liquidatorStockAfter.value.amount) - BigInt(liquidatorStockBefore.value.amount);
    assert.isAbove(Number(stockSeized), 0);

    const vaultStockDecrease = BigInt(vaultStockBefore.value.amount) - BigInt(vaultStockAfter.value.amount);
    assert.equal(stockSeized.toString(), vaultStockDecrease.toString());

    assert.equal(
      vaultAfter.collateralAmount.toNumber(),
      100_000_000 - Number(stockSeized)
    );
  });

  it("3. Liquidation rejected when market state is Stale", async () => {
    await marketStateProgram.methods
      .updateMarketState({ stale: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    try {
      await vaultProgram.methods
        .liquidate()
        .accounts(getLiquidationAccounts())
        .signers([liquidatorKeypair])
        .rpc();
      assert.fail("Should have failed on stale market state");
    } catch (e) {
      assert.include(e.message, "MarketStateStale");
    }
  });

  it("4. Liquidation rejected when Pyth price feed is stale beyond max_feed_age", async () => {
    try {
      await vaultProgram.methods
        .liquidate()
        .accounts(getLiquidationAccounts(
          staleVaultPda,
          staleStockMint,
          staleMarketPda,
          staleVaultStablecoinAta.address,
          staleVaultStockAta
        ))
        .signers([liquidatorKeypair])
        .rpc();
      assert.fail("Should have failed on stale Pyth feed");
    } catch (e) {
      assert.include(e.message, "PriceFeedStale");
    }
  });

  it("5. Liquidation eligibility re-checks when market flips back to Open and rejects liquidation if position is healthy under Open limits", async () => {
    await marketStateProgram.methods
      .updateMarketState({ open: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    const stockMint2Keypair = Keypair.generate();
    const extensions = [ExtensionType.ScaledUiAmountConfig];
    const mintLen = getMintLen(extensions);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const initStockMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: stockMint2Keypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeScaledUiAmountConfigInstruction(
        stockMint2Keypair.publicKey,
        wallet.publicKey,
        1.0,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        stockMint2Keypair.publicKey,
        8,
        wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(provider.connection, initStockMintTx, [wallet.payer, stockMint2Keypair]);
    const stockMint2 = stockMint2Keypair.publicKey;

    const userStock2Ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      stockMint2,
      wallet.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      stockMint2,
      userStock2Ata.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const [vault2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), wallet.publicKey.toBuffer(), stockMint2.toBuffer()],
      vaultProgram.programId
    );

    const [vault2StockAta] = PublicKey.findProgramAddressSync(
      [vault2Pda.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), stockMint2.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await vaultProgram.methods
      .deposit(new BN(100_000_000))
      .accounts({
        user: wallet.publicKey,
        vault: vault2Pda,
        stockMint: stockMint2,
        userTokenAccount: userStock2Ata.address,
        vaultTokenAccount: vault2StockAta,
        marketState: marketPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const vault2StablecoinAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      stablecoinMint,
      vault2Pda,
      true,
      "confirmed",
      undefined,
      TOKEN_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      stablecoinMint,
      vault2StablecoinAta.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    await vaultProgram.methods
      .borrow(new BN(180_000_000))
      .accounts({
        user: wallet.publicKey,
        vault: vault2Pda,
        stockMint: stockMint2,
        marketState: marketPda,
        priceUpdate: pythAaplFeed,
        stablecoinMint: stablecoinMint,
        vaultStablecoinAccount: vault2StablecoinAta.address,
        userStablecoinAccount: userStablecoinAtaAddress,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    await marketStateProgram.methods
      .updateMarketState({ closed: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    await marketStateProgram.methods
      .updateMarketState({ open: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    try {
      await vaultProgram.methods
        .liquidate()
        .accounts(getLiquidationAccounts(
          vault2Pda,
          stockMint2,
          marketPda,
          vault2StablecoinAta.address,
          vault2StockAta
        ))
        .signers([liquidatorKeypair])
        .rpc();
      assert.fail("Should have rejected liquidation once market reopened");
    } catch (e) {
      assert.include(e.message, "VaultNotUndercollateralized");
    }
  });
});
