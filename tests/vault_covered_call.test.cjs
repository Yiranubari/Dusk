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
  mintTo,
} = require("@solana/spl-token");

const BN = anchor.BN;

describe("Vault Covered Call Strategy", () => {
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

  let otherUser;
  let staleMarketPda;

  let livePythPrice;

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

    const feedInfo = await provider.connection.getAccountInfo(pythAaplFeed);
    const rawPrice = feedInfo.data.readBigInt64LE(73);
    livePythPrice = new BN(rawPrice.toString());

    otherUser = Keypair.generate();
    const airdropTx = await provider.connection.requestAirdrop(
      otherUser.publicKey,
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

    const marketId = "CC_" + Date.now().toString().slice(-6);
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
        stockMint: stockMint,
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
  });

  async function getCurrentBlockTime() {
    const slot = await provider.connection.getSlot();
    return await provider.connection.getBlockTime(slot);
  }

  it("1. Mint option succeeds when active_strategy == None and feed is fresh; confirm state transition", async () => {
    const currentBlockTime = await getCurrentBlockTime();
    const expiryTimestamp = new BN(currentBlockTime + 1000);
    const strikePrice = livePythPrice;

    await vaultProgram.methods
      .mintOption(strikePrice, expiryTimestamp)
      .accounts({
        owner: wallet.publicKey,
        vault: vaultPda,
        stockMint: stockMint,
        marketState: marketPda,
        priceUpdate: pythAaplFeed,
      })
      .rpc();

    const vaultAccount = await vaultProgram.account.vault.fetch(vaultPda);
    assert.deepEqual(vaultAccount.activeStrategy, { coveredCall: {} });
    assert.equal(vaultAccount.strikePrice.toString(), strikePrice.toString());
    assert.equal(vaultAccount.expiryTimestamp.toString(), expiryTimestamp.toString());
    assert.equal(vaultAccount.notionalAmount.toString(), "100000000");
  });

  it("2. Mint option fails when a strategy is already active", async () => {
    const currentBlockTime = await getCurrentBlockTime();
    const expiryTimestamp = new BN(currentBlockTime + 1000);
    const strikePrice = livePythPrice;

    try {
      await vaultProgram.methods
        .mintOption(strikePrice, expiryTimestamp)
        .accounts({
          owner: wallet.publicKey,
          vault: vaultPda,
          stockMint: stockMint,
          marketState: marketPda,
          priceUpdate: pythAaplFeed,
        })
        .rpc();
      assert.fail("Should have failed due to strategy already active");
    } catch (e) {
      assert.include(e.message, "IncompatibleStrategy");
    }
  });

  it("3. Mint option fails when called by someone other than the vault owner", async () => {
    const currentBlockTime = await getCurrentBlockTime();
    const expiryTimestamp = new BN(currentBlockTime + 1000);
    const strikePrice = livePythPrice;

    try {
      await vaultProgram.methods
        .mintOption(strikePrice, expiryTimestamp)
        .accounts({
          owner: otherUser.publicKey,
          vault: vaultPda,
          stockMint: stockMint,
          marketState: marketPda,
          priceUpdate: pythAaplFeed,
        })
        .signers([otherUser])
        .rpc();
      assert.fail("Should have failed due to unauthorized caller");
    } catch (e) {
      assert.ok(e);
    }
  });

  it("4. Mint option fails when feed or market is stale", async () => {
    const otherStockKeypair = Keypair.generate();
    const extensions = [ExtensionType.ScaledUiAmountConfig];
    const mintLen = getMintLen(extensions);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const initStockTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: otherStockKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeScaledUiAmountConfigInstruction(
        otherStockKeypair.publicKey,
        wallet.publicKey,
        1.0,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        otherStockKeypair.publicKey,
        8,
        wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(provider.connection, initStockTx, [wallet.payer, otherStockKeypair]);

    const otherUserStockAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      otherStockKeypair.publicKey,
      wallet.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      otherStockKeypair.publicKey,
      otherUserStockAta.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const [staleVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), wallet.publicKey.toBuffer(), otherStockKeypair.publicKey.toBuffer()],
      vaultProgram.programId
    );

    const [staleVaultStockAta] = PublicKey.findProgramAddressSync(
      [staleVaultPda.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), otherStockKeypair.publicKey.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const staleMarketId = "STCC_" + Date.now().toString().slice(-6);
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
        stockMint: otherStockKeypair.publicKey,
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

    await vaultProgram.methods
      .deposit(new BN(100_000_000))
      .accounts({
        user: wallet.publicKey,
        vault: staleVaultPda,
        stockMint: otherStockKeypair.publicKey,
        userTokenAccount: otherUserStockAta.address,
        vaultTokenAccount: staleVaultStockAta,
        marketState: staleMarketPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const currentBlockTime = await getCurrentBlockTime();
    const expiryTimestamp = new BN(currentBlockTime + 1000);
    const strikePrice = livePythPrice;

    try {
      await vaultProgram.methods
        .mintOption(strikePrice, expiryTimestamp)
        .accounts({
          owner: wallet.publicKey,
          vault: staleVaultPda,
          stockMint: otherStockKeypair.publicKey,
          marketState: staleMarketPda,
          priceUpdate: pythAaplFeed,
        })
        .rpc();
      assert.fail("Should have failed due to stale feed");
    } catch (e) {
      assert.include(e.message, "PriceFeedStale");
    }
  });

  it("5. Settlement fails when called before expiry", async () => {
    try {
      await vaultProgram.methods
        .settleOption()
        .accounts({
          caller: wallet.publicKey,
          vault: vaultPda,
          stockMint: stockMint,
          marketState: marketPda,
          priceUpdate: pythAaplFeed,
        })
        .rpc();
      assert.fail("Should have failed due to option not expired");
    } catch (e) {
      assert.include(e.message, "OptionNotExpired");
    }
  });

  it("6. Settlement succeeds after expiry for an ITM option and resets active_strategy to None", async () => {
    const quickVaultKeypair = Keypair.generate();
    const extensions = [ExtensionType.ScaledUiAmountConfig];
    const mintLen = getMintLen(extensions);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const initStockTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: quickVaultKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeScaledUiAmountConfigInstruction(
        quickVaultKeypair.publicKey,
        wallet.publicKey,
        1.0,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        quickVaultKeypair.publicKey,
        8,
        wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(provider.connection, initStockTx, [wallet.payer, quickVaultKeypair]);

    const qUserStockAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      quickVaultKeypair.publicKey,
      wallet.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      quickVaultKeypair.publicKey,
      qUserStockAta.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const [qVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), wallet.publicKey.toBuffer(), quickVaultKeypair.publicKey.toBuffer()],
      vaultProgram.programId
    );

    const [qVaultStockAta] = PublicKey.findProgramAddressSync(
      [qVaultPda.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), quickVaultKeypair.publicKey.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const qMarketId = "QMK_" + Date.now().toString().slice(-6);
    const [qMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from(qMarketId)],
      marketStateProgram.programId
    );

    await marketStateProgram.methods
      .initializeMarket(
        qMarketId,
        new BN(500),
        new BN(10_000_000)
      )
      .accounts({
        market: qMarketPda,
        authority: wallet.publicKey,
        priceFeed: pythAaplFeed,
        stockMint: quickVaultKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await marketStateProgram.methods
      .updateMarketState({ open: {} })
      .accounts({
        market: qMarketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    await vaultProgram.methods
      .deposit(new BN(100_000_000))
      .accounts({
        user: wallet.publicKey,
        vault: qVaultPda,
        stockMint: quickVaultKeypair.publicKey,
        userTokenAccount: qUserStockAta.address,
        vaultTokenAccount: qVaultStockAta,
        marketState: qMarketPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const currentBlockTime = await getCurrentBlockTime();
    const expiryTimestamp = new BN(currentBlockTime + 3);
    const itmStrike = livePythPrice.sub(new BN(5000000));

    await vaultProgram.methods
      .mintOption(itmStrike, expiryTimestamp)
      .accounts({
        owner: wallet.publicKey,
        vault: qVaultPda,
        stockMint: quickVaultKeypair.publicKey,
        marketState: qMarketPda,
        priceUpdate: pythAaplFeed,
      })
      .rpc();

    let qVaultAcc = await vaultProgram.account.vault.fetch(qVaultPda);
    assert.deepEqual(qVaultAcc.activeStrategy, { coveredCall: {} });

    await new Promise((resolve) => setTimeout(resolve, 4500));

    let settledEvent = null;
    const listener = vaultProgram.addEventListener("OptionSettled", (event) => {
      settledEvent = event;
    });

    await vaultProgram.methods
      .settleOption()
      .accounts({
        caller: otherUser.publicKey,
        vault: qVaultPda,
        stockMint: quickVaultKeypair.publicKey,
        marketState: qMarketPda,
        priceUpdate: pythAaplFeed,
      })
      .signers([otherUser])
      .rpc();

    await vaultProgram.removeEventListener(listener);

    qVaultAcc = await vaultProgram.account.vault.fetch(qVaultPda);
    assert.deepEqual(qVaultAcc.activeStrategy, { none: {} });
    assert.equal(qVaultAcc.strikePrice.toNumber(), 0);
    assert.equal(qVaultAcc.expiryTimestamp.toNumber(), 0);
    assert.equal(qVaultAcc.notionalAmount.toNumber(), 0);

    if (settledEvent) {
      assert.isTrue(settledEvent.isItm);
      assert.equal(settledEvent.strikePrice.toString(), itmStrike.toString());
    }
  });

  it("7. Settlement succeeds after expiry for an OTM option and resets active_strategy to None", async () => {
    const otmVaultKeypair = Keypair.generate();
    const extensions = [ExtensionType.ScaledUiAmountConfig];
    const mintLen = getMintLen(extensions);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const initStockTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: otmVaultKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeScaledUiAmountConfigInstruction(
        otmVaultKeypair.publicKey,
        wallet.publicKey,
        1.0,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        otmVaultKeypair.publicKey,
        8,
        wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(provider.connection, initStockTx, [wallet.payer, otmVaultKeypair]);

    const otmUserStockAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      otmVaultKeypair.publicKey,
      wallet.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      otmVaultKeypair.publicKey,
      otmUserStockAta.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const [otmVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), wallet.publicKey.toBuffer(), otmVaultKeypair.publicKey.toBuffer()],
      vaultProgram.programId
    );

    const [otmVaultStockAta] = PublicKey.findProgramAddressSync(
      [otmVaultPda.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), otmVaultKeypair.publicKey.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const otmMarketId = "OTM_" + Date.now().toString().slice(-6);
    const [otmMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from(otmMarketId)],
      marketStateProgram.programId
    );

    await marketStateProgram.methods
      .initializeMarket(
        otmMarketId,
        new BN(500),
        new BN(10_000_000)
      )
      .accounts({
        market: otmMarketPda,
        authority: wallet.publicKey,
        priceFeed: pythAaplFeed,
        stockMint: otmVaultKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await marketStateProgram.methods
      .updateMarketState({ open: {} })
      .accounts({
        market: otmMarketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    await vaultProgram.methods
      .deposit(new BN(100_000_000))
      .accounts({
        user: wallet.publicKey,
        vault: otmVaultPda,
        stockMint: otmVaultKeypair.publicKey,
        userTokenAccount: otmUserStockAta.address,
        vaultTokenAccount: otmVaultStockAta,
        marketState: otmMarketPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const currentBlockTime = await getCurrentBlockTime();
    const expiryTimestamp = new BN(currentBlockTime + 3);
    const otmStrike = livePythPrice.add(new BN(5000000));

    await vaultProgram.methods
      .mintOption(otmStrike, expiryTimestamp)
      .accounts({
        owner: wallet.publicKey,
        vault: otmVaultPda,
        stockMint: otmVaultKeypair.publicKey,
        marketState: otmMarketPda,
        priceUpdate: pythAaplFeed,
      })
      .rpc();

    let otmVaultAcc = await vaultProgram.account.vault.fetch(otmVaultPda);
    assert.deepEqual(otmVaultAcc.activeStrategy, { coveredCall: {} });

    await new Promise((resolve) => setTimeout(resolve, 4500));

    let settledEvent = null;
    const listener = vaultProgram.addEventListener("OptionSettled", (event) => {
      settledEvent = event;
    });

    await vaultProgram.methods
      .settleOption()
      .accounts({
        caller: otherUser.publicKey,
        vault: otmVaultPda,
        stockMint: otmVaultKeypair.publicKey,
        marketState: otmMarketPda,
        priceUpdate: pythAaplFeed,
      })
      .signers([otherUser])
      .rpc();

    await vaultProgram.removeEventListener(listener);

    otmVaultAcc = await vaultProgram.account.vault.fetch(otmVaultPda);
    assert.deepEqual(otmVaultAcc.activeStrategy, { none: {} });
    assert.equal(otmVaultAcc.strikePrice.toNumber(), 0);
    assert.equal(otmVaultAcc.expiryTimestamp.toNumber(), 0);
    assert.equal(otmVaultAcc.notionalAmount.toNumber(), 0);

    if (settledEvent) {
      assert.isFalse(settledEvent.isItm);
      assert.equal(settledEvent.strikePrice.toString(), otmStrike.toString());
    }
  });

  it("8. Settlement blocked/rejected if attempted while market state is stale", async () => {
    const staleTestKeypair = Keypair.generate();
    const extensions = [ExtensionType.ScaledUiAmountConfig];
    const mintLen = getMintLen(extensions);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const initStockTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: staleTestKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeScaledUiAmountConfigInstruction(
        staleTestKeypair.publicKey,
        wallet.publicKey,
        1.0,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        staleTestKeypair.publicKey,
        8,
        wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(provider.connection, initStockTx, [wallet.payer, staleTestKeypair]);

    const stUserStockAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      staleTestKeypair.publicKey,
      wallet.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      staleTestKeypair.publicKey,
      stUserStockAta.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const [stVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), wallet.publicKey.toBuffer(), staleTestKeypair.publicKey.toBuffer()],
      vaultProgram.programId
    );

    const [stVaultStockAta] = PublicKey.findProgramAddressSync(
      [stVaultPda.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), staleTestKeypair.publicKey.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const stMarketId = "STCC8_" + Date.now().toString().slice(-6);
    const [stMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from(stMarketId)],
      marketStateProgram.programId
    );

    await marketStateProgram.methods
      .initializeMarket(
        stMarketId,
        new BN(500),
        new BN(10_000_000)
      )
      .accounts({
        market: stMarketPda,
        authority: wallet.publicKey,
        priceFeed: pythAaplFeed,
        stockMint: staleTestKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await marketStateProgram.methods
      .updateMarketState({ open: {} })
      .accounts({
        market: stMarketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    await vaultProgram.methods
      .deposit(new BN(100_000_000))
      .accounts({
        user: wallet.publicKey,
        vault: stVaultPda,
        stockMint: staleTestKeypair.publicKey,
        userTokenAccount: stUserStockAta.address,
        vaultTokenAccount: stVaultStockAta,
        marketState: stMarketPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const currentBlockTime = await getCurrentBlockTime();
    const expiryTimestamp = new BN(currentBlockTime + 2);
    const strike = livePythPrice;

    await vaultProgram.methods
      .mintOption(strike, expiryTimestamp)
      .accounts({
        owner: wallet.publicKey,
        vault: stVaultPda,
        stockMint: staleTestKeypair.publicKey,
        marketState: stMarketPda,
        priceUpdate: pythAaplFeed,
      })
      .rpc();

    await new Promise((resolve) => setTimeout(resolve, 3000));

    await marketStateProgram.methods
      .updateMarketState({ stale: {} })
      .accounts({
        market: stMarketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    try {
      await vaultProgram.methods
        .settleOption()
        .accounts({
          caller: wallet.publicKey,
          vault: stVaultPda,
          stockMint: staleTestKeypair.publicKey,
          marketState: stMarketPda,
          priceUpdate: pythAaplFeed,
        })
        .rpc();
      assert.fail("Should have failed due to stale market state on settlement");
    } catch (e) {
      assert.include(e.message, "MarketStateStale");
    }

    await marketStateProgram.methods
      .updateMarketState({ open: {} })
      .accounts({
        market: stMarketPda,
        authority: wallet.publicKey,
      })
      .rpc();
  });
});
