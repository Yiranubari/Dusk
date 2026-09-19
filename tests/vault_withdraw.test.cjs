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

describe("Vault Withdraw (Token-2022)", () => {
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
  let mint;
  let userAta;
  let vaultPda;
  let vaultBump;
  let vaultAtaAddress;
  let marketPda;
  let stablecoinMint;
  let vaultStablecoinAta;
  let userStablecoinAtaAddress;

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

    const mintKeypair = Keypair.generate();
    const extensions = [ExtensionType.ScaledUiAmountConfig];
    const mintLen = getMintLen(extensions);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const initMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeScaledUiAmountConfigInstruction(
        mintKeypair.publicKey,
        wallet.publicKey,
        1.0,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        8,
        wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(provider.connection, initMintTx, [wallet.payer, mintKeypair]);
    mint = mintKeypair.publicKey;

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

    const marketId = "WITHDRAW_" + Date.now().toString().slice(-6);
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

  function getAccounts() {
    return {
      user: wallet.publicKey,
      vault: vaultPda,
      stockMint: mint,
      marketState: marketPda,
      priceUpdate: pythAaplFeed,
      stablecoinMint: stablecoinMint,
      userTokenAccount: userAta.address,
      vaultTokenAccount: vaultAtaAddress,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    };
  }

  it("deposit succeeds and sets collateral_amount to 100_000_000", async () => {
    await vaultProgram.methods
      .deposit(new BN(100_000_000))
      .accounts(getAccounts())
      .rpc();

    const vaultAccount = await vaultProgram.account.vault.fetch(vaultPda);
    assert.equal(vaultAccount.collateralAmount.toNumber(), 100_000_000);
  });

  it("withdraw succeeds when active_strategy is None and reduces collateral_amount", async () => {
    await vaultProgram.methods
      .withdraw(new BN(30_000_000))
      .accounts(getAccounts())
      .rpc();

    const vaultAccount = await vaultProgram.account.vault.fetch(vaultPda);
    assert.equal(vaultAccount.collateralAmount.toNumber(), 70_000_000);
  });

  it("withdraw fails when amount exceeds current collateral_amount", async () => {
    try {
      await vaultProgram.methods
        .withdraw(new BN(1_000_000_000))
        .accounts(getAccounts())
        .rpc();
      assert.fail("should have thrown an error");
    } catch (e) {
      assert.include(e.message, "InsufficientCollateral", `error was: ${e.message}`);
    }
  });

  it("withdraw succeeds for a borrowed vault when remaining collateral covers the loan", async () => {
    await vaultProgram.methods
      .deposit(new BN(30_000_000))
      .accounts(getAccounts())
      .rpc();

    const borrowAccounts = {
      user: wallet.publicKey,
      vault: vaultPda,
      stockMint: mint,
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

    await vaultProgram.methods
      .borrow(new BN(50_000_000))
      .accounts(borrowAccounts)
      .rpc();

    let vaultAccount = await vaultProgram.account.vault.fetch(vaultPda);
    assert.equal(vaultAccount.borrowedAmount.toNumber(), 50_000_000);
    assert.deepEqual(vaultAccount.activeStrategy, { borrow: {} });

    await vaultProgram.methods
      .withdraw(new BN(30_000_000))
      .accounts(getAccounts())
      .rpc();

    vaultAccount = await vaultProgram.account.vault.fetch(vaultPda);
    assert.equal(vaultAccount.collateralAmount.toNumber(), 70_000_000);
  });

  it("withdraw fails when it would push the position under the LTV limit", async () => {
    try {
      await vaultProgram.methods
        .withdraw(new BN(60_000_000))
        .accounts(getAccounts())
        .rpc();
      assert.fail("should have thrown WithdrawWouldBreakCollateralization");
    } catch (e) {
      assert.include(e.message, "WithdrawWouldBreakCollateralization", `error was: ${e.message}`);
    }
  });

  it("withdraw fails outright when market is stale, even if math would allow it", async () => {
    await marketStateProgram.methods
      .updateMarketState({ stale: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    try {
      await vaultProgram.methods
        .withdraw(new BN(1_000_000))
        .accounts(getAccounts())
        .rpc();
      assert.fail("should have thrown MarketStateStale");
    } catch (e) {
      assert.include(e.message, "MarketStateStale", `error was: ${e.message}`);
    }

    await marketStateProgram.methods
      .updateMarketState({ open: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();
  });

  it("withdraw correctly handles a non-6-decimal stablecoin (9 decimals)", async () => {
    const stablecoin9Mint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      9,
      Keypair.generate(),
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    const mint9Keypair = Keypair.generate();
    const extensions = [ExtensionType.ScaledUiAmountConfig];
    const mintLen = getMintLen(extensions);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const initMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mint9Keypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeScaledUiAmountConfigInstruction(
        mint9Keypair.publicKey,
        wallet.publicKey,
        1.0,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mint9Keypair.publicKey,
        8,
        wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(provider.connection, initMintTx, [wallet.payer, mint9Keypair]);
    const stockMint9 = mint9Keypair.publicKey;

    const userStockAta9 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      stockMint9,
      wallet.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      stockMint9,
      userStockAta9.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const [vPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), wallet.publicKey.toBuffer(), stockMint9.toBuffer()],
      vaultProgram.programId
    );

    const [vStockAta] = PublicKey.findProgramAddressSync(
      [vPda.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), stockMint9.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await vaultProgram.methods
      .deposit(new BN(100_000_000))
      .accounts({
        user: wallet.publicKey,
        vault: vPda,
        stockMint: stockMint9,
        marketState: marketPda,
        priceUpdate: pythAaplFeed,
        stablecoinMint: stablecoin9Mint,
        userTokenAccount: userStockAta9.address,
        vaultTokenAccount: vStockAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const vaultStable9Ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      stablecoin9Mint,
      vPda,
      true,
      "confirmed",
      undefined,
      TOKEN_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      stablecoin9Mint,
      vaultStable9Ata.address,
      wallet.publicKey,
      1_000_000_000_000,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    const [userStable9Ata] = PublicKey.findProgramAddressSync(
      [wallet.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), stablecoin9Mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await vaultProgram.methods
      .borrow(new BN(50_000_000_000))
      .accounts({
        user: wallet.publicKey,
        vault: vPda,
        stockMint: stockMint9,
        marketState: marketPda,
        priceUpdate: pythAaplFeed,
        stablecoinMint: stablecoin9Mint,
        vaultStablecoinAccount: vaultStable9Ata.address,
        userStablecoinAccount: userStable9Ata,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    await vaultProgram.methods
      .withdraw(new BN(30_000_000))
      .accounts({
        user: wallet.publicKey,
        vault: vPda,
        stockMint: stockMint9,
        marketState: marketPda,
        priceUpdate: pythAaplFeed,
        stablecoinMint: stablecoin9Mint,
        userTokenAccount: userStockAta9.address,
        vaultTokenAccount: vStockAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const vAccount = await vaultProgram.account.vault.fetch(vPda);
    assert.equal(vAccount.collateralAmount.toNumber(), 70_000_000);

    try {
      await vaultProgram.methods
        .withdraw(new BN(60_000_000))
        .accounts({
          user: wallet.publicKey,
          vault: vPda,
          stockMint: stockMint9,
          marketState: marketPda,
          priceUpdate: pythAaplFeed,
          stablecoinMint: stablecoin9Mint,
          userTokenAccount: userStockAta9.address,
          vaultTokenAccount: vStockAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      assert.fail("should have thrown WithdrawWouldBreakCollateralization");
    } catch (e) {
      assert.include(e.message, "WithdrawWouldBreakCollateralization", `error was: ${e.message}`);
    }
  });

  it("withdraw rejects with StrategyActive when active_strategy != None", async () => {
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
        marketState: marketPda,
        priceUpdate: pythAaplFeed,
        stablecoinMint: stablecoinMint,
        userTokenAccount: ccUserStockAta.address,
        vaultTokenAccount: ccVaultStockAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

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
        .withdraw(new BN(10_000_000))
        .accounts({
          user: wallet.publicKey,
          vault: ccVaultPda,
          stockMint: ccStockKeypair.publicKey,
          marketState: marketPda,
          priceUpdate: pythAaplFeed,
          stablecoinMint: stablecoinMint,
          userTokenAccount: ccUserStockAta.address,
          vaultTokenAccount: ccVaultStockAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      assert.fail("should have thrown StrategyActive");
    } catch (e) {
      assert.include(e.message, "StrategyActive");
    }
  });
});