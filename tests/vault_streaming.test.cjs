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

describe("Vault Streaming Strategy", () => {
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

  let recipientKeypair;
  let recipientStockAta;

  let thirdPartyKeypair;
  let staleMarketPda;

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

    recipientKeypair = Keypair.generate();
    const airdropRecipient = await provider.connection.requestAirdrop(
      recipientKeypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropRecipient);

    thirdPartyKeypair = Keypair.generate();
    const airdropThirdParty = await provider.connection.requestAirdrop(
      thirdPartyKeypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropThirdParty);

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

    recipientStockAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      stockMint,
      recipientKeypair.publicKey,
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

    const marketId = "STRM_" + Date.now().toString().slice(-6);
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

    const staleMarketId = "STSTRM_" + Date.now().toString().slice(-6);
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
  });

  async function getCurrentBlockTime() {
    const slot = await provider.connection.getSlot();
    return await provider.connection.getBlockTime(slot);
  }

  async function createFreshVault(initialDeposit) {
    const freshStockKeypair = Keypair.generate();
    const extensions = [ExtensionType.ScaledUiAmountConfig];
    const mintLen = getMintLen(extensions);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const initTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: freshStockKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeScaledUiAmountConfigInstruction(
        freshStockKeypair.publicKey,
        wallet.publicKey,
        1.0,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        freshStockKeypair.publicKey,
        8,
        wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(provider.connection, initTx, [wallet.payer, freshStockKeypair]);

    const uAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      freshStockKeypair.publicKey,
      wallet.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const rAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      freshStockKeypair.publicKey,
      recipientKeypair.publicKey,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      freshStockKeypair.publicKey,
      uAta.address,
      wallet.publicKey,
      1_000_000_000,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const [vPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), wallet.publicKey.toBuffer(), freshStockKeypair.publicKey.toBuffer()],
      vaultProgram.programId
    );

    const [vStockAta] = PublicKey.findProgramAddressSync(
      [vPda.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), freshStockKeypair.publicKey.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await vaultProgram.methods
      .deposit(new BN(initialDeposit))
      .accounts({
        user: wallet.publicKey,
        vault: vPda,
        stockMint: freshStockKeypair.publicKey,
        userTokenAccount: uAta.address,
        vaultTokenAccount: vStockAta,
        marketState: marketPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    return {
      stockMint: freshStockKeypair.publicKey,
      vaultPda: vPda,
      vaultStockAta: vStockAta,
      userStockAta: uAta.address,
      recipientStockAta: rAta.address,
    };
  }

  it("1. Setup succeeds, correct state transition and field values, active_strategy = Streaming", async () => {
    const currentBlockTime = await getCurrentBlockTime();
    const start = new BN(currentBlockTime);
    const end = new BN(currentBlockTime + 100);
    const cliff = new BN(currentBlockTime + 30);
    const amount = new BN(50_000_000);

    await vaultProgram.methods
      .setupStream(recipientKeypair.publicKey, start, end, cliff, amount, true)
      .accounts({
        owner: wallet.publicKey,
        vault: vaultPda,
        stockMint: stockMint,
      })
      .rpc();

    const vaultAccount = await vaultProgram.account.vault.fetch(vaultPda);
    assert.deepEqual(vaultAccount.activeStrategy, { streaming: {} });
    assert.equal(vaultAccount.streamRecipient.toBase58(), recipientKeypair.publicKey.toBase58());
    assert.equal(vaultAccount.streamStart.toString(), start.toString());
    assert.equal(vaultAccount.streamEnd.toString(), end.toString());
    assert.equal(vaultAccount.streamCliff.toString(), cliff.toString());
    assert.equal(vaultAccount.streamTotalAmount.toString(), amount.toString());
    assert.equal(vaultAccount.streamReleasedAmount.toString(), "0");
    assert.isTrue(vaultAccount.streamRevocable);
  });

  it("2. Setup fails if a strategy is already active", async () => {
    const currentBlockTime = await getCurrentBlockTime();
    try {
      await vaultProgram.methods
        .setupStream(
          recipientKeypair.publicKey,
          new BN(currentBlockTime),
          new BN(currentBlockTime + 100),
          new BN(0),
          new BN(10_000_000),
          true
        )
        .accounts({
          owner: wallet.publicKey,
          vault: vaultPda,
          stockMint: stockMint,
        })
        .rpc();
      assert.fail("Should have failed due to strategy already active");
    } catch (e) {
      assert.include(e.message, "IncompatibleStrategy");
    }
  });

  it("3. Setup fails for invalid schedule (start >= end, or cliff outside range)", async () => {
    const fresh = await createFreshVault(100_000_000);
    const currentBlockTime = await getCurrentBlockTime();

    try {
      await vaultProgram.methods
        .setupStream(
          recipientKeypair.publicKey,
          new BN(currentBlockTime + 100),
          new BN(currentBlockTime + 50),
          new BN(0),
          new BN(10_000_000),
          true
        )
        .accounts({
          owner: wallet.publicKey,
          vault: fresh.vaultPda,
          stockMint: fresh.stockMint,
        })
        .rpc();
      assert.fail("Should have failed due to start >= end");
    } catch (e) {
      assert.include(e.message, "InvalidStreamSchedule");
    }

    try {
      await vaultProgram.methods
        .setupStream(
          recipientKeypair.publicKey,
          new BN(currentBlockTime),
          new BN(currentBlockTime + 100),
          new BN(currentBlockTime + 150),
          new BN(10_000_000),
          true
        )
        .accounts({
          owner: wallet.publicKey,
          vault: fresh.vaultPda,
          stockMint: fresh.stockMint,
        })
        .rpc();
      assert.fail("Should have failed due to cliff > end");
    } catch (e) {
      assert.include(e.message, "InvalidStreamSchedule");
    }
  });

  it("4. Setup fails if amount exceeds collateral or is zero", async () => {
    const fresh = await createFreshVault(50_000_000);
    const currentBlockTime = await getCurrentBlockTime();

    try {
      await vaultProgram.methods
        .setupStream(
          recipientKeypair.publicKey,
          new BN(currentBlockTime),
          new BN(currentBlockTime + 100),
          new BN(0),
          new BN(60_000_000),
          true
        )
        .accounts({
          owner: wallet.publicKey,
          vault: fresh.vaultPda,
          stockMint: fresh.stockMint,
        })
        .rpc();
      assert.fail("Should have failed due to amount exceeding collateral");
    } catch (e) {
      assert.include(e.message, "InsufficientCollateral");
    }

    try {
      await vaultProgram.methods
        .setupStream(
          recipientKeypair.publicKey,
          new BN(currentBlockTime),
          new BN(currentBlockTime + 100),
          new BN(0),
          new BN(0),
          true
        )
        .accounts({
          owner: wallet.publicKey,
          vault: fresh.vaultPda,
          stockMint: fresh.stockMint,
        })
        .rpc();
      assert.fail("Should have failed due to zero stream amount");
    } catch (e) {
      assert.include(e.message, "InvalidStreamAmount");
    }
  });

  it("5. Claim before cliff returns 0 claimable and rejects with NothingToClaim", async () => {
    const fresh = await createFreshVault(100_000_000);
    const currentBlockTime = await getCurrentBlockTime();

    await vaultProgram.methods
      .setupStream(
        recipientKeypair.publicKey,
        new BN(currentBlockTime),
        new BN(currentBlockTime + 10),
        new BN(currentBlockTime + 8),
        new BN(40_000_000),
        true
      )
      .accounts({
        owner: wallet.publicKey,
        vault: fresh.vaultPda,
        stockMint: fresh.stockMint,
      })
      .rpc();

    try {
      await vaultProgram.methods
        .claimStream()
        .accounts({
          recipient: recipientKeypair.publicKey,
          vault: fresh.vaultPda,
          stockMint: fresh.stockMint,
          marketState: marketPda,
          priceUpdate: pythAaplFeed,
          vaultTokenAccount: fresh.vaultStockAta,
          recipientTokenAccount: fresh.recipientStockAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([recipientKeypair])
        .rpc();
      assert.fail("Should have failed before cliff with NothingToClaim");
    } catch (e) {
      assert.include(e.message, "NothingToClaim");
    }
  });

  it("6. Claim after cliff partway through schedule transfers correct linear vested amount", async () => {
    const fresh = await createFreshVault(100_000_000);
    const currentBlockTime = await getCurrentBlockTime();
    const duration = 6;
    const cliffSec = 2;
    const streamAmount = 60_000_000;

    await vaultProgram.methods
      .setupStream(
        recipientKeypair.publicKey,
        new BN(currentBlockTime),
        new BN(currentBlockTime + duration),
        new BN(currentBlockTime + cliffSec),
        new BN(streamAmount),
        true
      )
      .accounts({
        owner: wallet.publicKey,
        vault: fresh.vaultPda,
        stockMint: fresh.stockMint,
      })
      .rpc();

    await new Promise((r) => setTimeout(r, 3500));

    const beforeBal = await provider.connection.getTokenAccountBalance(fresh.recipientStockAta);
    const beforeAmount = BigInt(beforeBal.value.amount);

    await vaultProgram.methods
      .claimStream()
      .accounts({
        recipient: recipientKeypair.publicKey,
        vault: fresh.vaultPda,
        stockMint: fresh.stockMint,
        marketState: marketPda,
        priceUpdate: pythAaplFeed,
        vaultTokenAccount: fresh.vaultStockAta,
        recipientTokenAccount: fresh.recipientStockAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([recipientKeypair])
      .rpc();

    const afterBal = await provider.connection.getTokenAccountBalance(fresh.recipientStockAta);
    const afterAmount = BigInt(afterBal.value.amount);
    const received = afterAmount - beforeAmount;

    assert.isTrue(received > 0n);
    assert.isTrue(received <= BigInt(streamAmount));

    const vaultAcc = await vaultProgram.account.vault.fetch(fresh.vaultPda);
    assert.equal(vaultAcc.streamReleasedAmount.toString(), received.toString());
    assert.equal(vaultAcc.collateralAmount.toString(), (100_000_000n - received).toString());
  });

  it("7. Two sequential claims at different times correctly account for previously-released amount", async () => {
    const fresh = await createFreshVault(100_000_000);
    const currentBlockTime = await getCurrentBlockTime();
    const duration = 8;
    const streamAmount = 80_000_000;

    await vaultProgram.methods
      .setupStream(
        recipientKeypair.publicKey,
        new BN(currentBlockTime),
        new BN(currentBlockTime + duration),
        new BN(0),
        new BN(streamAmount),
        true
      )
      .accounts({
        owner: wallet.publicKey,
        vault: fresh.vaultPda,
        stockMint: fresh.stockMint,
      })
      .rpc();

    await new Promise((r) => setTimeout(r, 2000));

    await vaultProgram.methods
      .claimStream()
      .accounts({
        recipient: recipientKeypair.publicKey,
        vault: fresh.vaultPda,
        stockMint: fresh.stockMint,
        marketState: marketPda,
        priceUpdate: pythAaplFeed,
        vaultTokenAccount: fresh.vaultStockAta,
        recipientTokenAccount: fresh.recipientStockAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([recipientKeypair])
      .rpc();

    const vAcc1 = await vaultProgram.account.vault.fetch(fresh.vaultPda);
    const firstRelease = vAcc1.streamReleasedAmount.toNumber();
    assert.isTrue(firstRelease > 0);

    await new Promise((r) => setTimeout(r, 2500));

    await vaultProgram.methods
      .claimStream()
      .accounts({
        recipient: recipientKeypair.publicKey,
        vault: fresh.vaultPda,
        stockMint: fresh.stockMint,
        marketState: marketPda,
        priceUpdate: pythAaplFeed,
        vaultTokenAccount: fresh.vaultStockAta,
        recipientTokenAccount: fresh.recipientStockAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([recipientKeypair])
      .rpc();

    const vAcc2 = await vaultProgram.account.vault.fetch(fresh.vaultPda);
    const secondRelease = vAcc2.streamReleasedAmount.toNumber();
    assert.isTrue(secondRelease > firstRelease);
  });

  it("8. Claim by non-recipient (owner or third party) fails", async () => {
    const fresh = await createFreshVault(100_000_000);
    const currentBlockTime = await getCurrentBlockTime();

    await vaultProgram.methods
      .setupStream(
        recipientKeypair.publicKey,
        new BN(currentBlockTime),
        new BN(currentBlockTime + 10),
        new BN(0),
        new BN(50_000_000),
        true
      )
      .accounts({
        owner: wallet.publicKey,
        vault: fresh.vaultPda,
        stockMint: fresh.stockMint,
      })
      .rpc();

    await new Promise((r) => setTimeout(r, 2000));

    try {
      await vaultProgram.methods
        .claimStream()
        .accounts({
          recipient: thirdPartyKeypair.publicKey,
          vault: fresh.vaultPda,
          stockMint: fresh.stockMint,
          marketState: marketPda,
          priceUpdate: pythAaplFeed,
          vaultTokenAccount: fresh.vaultStockAta,
          recipientTokenAccount: fresh.recipientStockAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([thirdPartyKeypair])
        .rpc();
      assert.fail("Should have failed due to non-recipient caller");
    } catch (e) {
      assert.ok(e);
    }
  });

  it("9. Claim fails while market state is stale", async () => {
    const fresh = await createFreshVault(100_000_000);
    const currentBlockTime = await getCurrentBlockTime();

    await vaultProgram.methods
      .setupStream(
        recipientKeypair.publicKey,
        new BN(currentBlockTime),
        new BN(currentBlockTime + 10),
        new BN(0),
        new BN(50_000_000),
        true
      )
      .accounts({
        owner: wallet.publicKey,
        vault: fresh.vaultPda,
        stockMint: fresh.stockMint,
      })
      .rpc();

    await new Promise((r) => setTimeout(r, 2000));

    await marketStateProgram.methods
      .updateMarketState({ stale: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    try {
      await vaultProgram.methods
        .claimStream()
        .accounts({
          recipient: recipientKeypair.publicKey,
          vault: fresh.vaultPda,
          stockMint: fresh.stockMint,
          marketState: marketPda,
          priceUpdate: pythAaplFeed,
          vaultTokenAccount: fresh.vaultStockAta,
          recipientTokenAccount: fresh.recipientStockAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([recipientKeypair])
        .rpc();
      assert.fail("Should have failed due to stale market on claim");
    } catch (e) {
      assert.include(e.message, "MarketStateStale");
    }

    await marketStateProgram.methods
      .updateMarketState({ open: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();
  });

  it("10. Revoke by owner succeeds when revocable == true, force-transfers vested remainder, resets vault state", async () => {
    const fresh = await createFreshVault(100_000_000);
    const currentBlockTime = await getCurrentBlockTime();

    await vaultProgram.methods
      .setupStream(
        recipientKeypair.publicKey,
        new BN(currentBlockTime),
        new BN(currentBlockTime + 10),
        new BN(0),
        new BN(50_000_000),
        true
      )
      .accounts({
        owner: wallet.publicKey,
        vault: fresh.vaultPda,
        stockMint: fresh.stockMint,
      })
      .rpc();

    await new Promise((r) => setTimeout(r, 2500));

    const beforeBal = await provider.connection.getTokenAccountBalance(fresh.recipientStockAta);
    const beforeAmount = BigInt(beforeBal.value.amount);

    await vaultProgram.methods
      .revokeStream()
      .accounts({
        owner: wallet.publicKey,
        vault: fresh.vaultPda,
        stockMint: fresh.stockMint,
        marketState: marketPda,
        priceUpdate: pythAaplFeed,
        vaultTokenAccount: fresh.vaultStockAta,
        recipientTokenAccount: fresh.recipientStockAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const afterBal = await provider.connection.getTokenAccountBalance(fresh.recipientStockAta);
    const afterAmount = BigInt(afterBal.value.amount);
    const vestedPayout = afterAmount - beforeAmount;

    assert.isTrue(vestedPayout > 0n);

    const vAcc = await vaultProgram.account.vault.fetch(fresh.vaultPda);
    assert.deepEqual(vAcc.activeStrategy, { none: {} });
    assert.equal(vAcc.streamTotalAmount.toNumber(), 0);
    assert.equal(vAcc.streamReleasedAmount.toNumber(), 0);
    assert.isFalse(vAcc.streamRevocable);
    assert.equal(vAcc.collateralAmount.toString(), (100_000_000n - vestedPayout).toString());
  });

  it("11. Revoke fails when revocable == false", async () => {
    const fresh = await createFreshVault(100_000_000);
    const currentBlockTime = await getCurrentBlockTime();

    await vaultProgram.methods
      .setupStream(
        recipientKeypair.publicKey,
        new BN(currentBlockTime),
        new BN(currentBlockTime + 10),
        new BN(0),
        new BN(50_000_000),
        false
      )
      .accounts({
        owner: wallet.publicKey,
        vault: fresh.vaultPda,
        stockMint: fresh.stockMint,
      })
      .rpc();

    try {
      await vaultProgram.methods
        .revokeStream()
        .accounts({
          owner: wallet.publicKey,
          vault: fresh.vaultPda,
          stockMint: fresh.stockMint,
          marketState: marketPda,
          priceUpdate: pythAaplFeed,
          vaultTokenAccount: fresh.vaultStockAta,
          recipientTokenAccount: fresh.recipientStockAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have failed due to stream non-revocable");
    } catch (e) {
      assert.include(e.message, "StreamNotRevocable");
    }
  });

  it("12. Revoke fails when called by non-owner", async () => {
    const fresh = await createFreshVault(100_000_000);
    const currentBlockTime = await getCurrentBlockTime();

    await vaultProgram.methods
      .setupStream(
        recipientKeypair.publicKey,
        new BN(currentBlockTime),
        new BN(currentBlockTime + 10),
        new BN(0),
        new BN(50_000_000),
        true
      )
      .accounts({
        owner: wallet.publicKey,
        vault: fresh.vaultPda,
        stockMint: fresh.stockMint,
      })
      .rpc();

    try {
      await vaultProgram.methods
        .revokeStream()
        .accounts({
          owner: thirdPartyKeypair.publicKey,
          vault: fresh.vaultPda,
          stockMint: fresh.stockMint,
          marketState: marketPda,
          priceUpdate: pythAaplFeed,
          vaultTokenAccount: fresh.vaultStockAta,
          recipientTokenAccount: fresh.recipientStockAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([thirdPartyKeypair])
        .rpc();
      assert.fail("Should have failed due to unauthorized caller");
    } catch (e) {
      assert.ok(e);
    }
  });

  it("13. Revoke fails when market state is stale", async () => {
    const fresh = await createFreshVault(100_000_000);
    const currentBlockTime = await getCurrentBlockTime();

    await vaultProgram.methods
      .setupStream(
        recipientKeypair.publicKey,
        new BN(currentBlockTime),
        new BN(currentBlockTime + 10),
        new BN(0),
        new BN(50_000_000),
        true
      )
      .accounts({
        owner: wallet.publicKey,
        vault: fresh.vaultPda,
        stockMint: fresh.stockMint,
      })
      .rpc();

    await marketStateProgram.methods
      .updateMarketState({ stale: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();

    try {
      await vaultProgram.methods
        .revokeStream()
        .accounts({
          owner: wallet.publicKey,
          vault: fresh.vaultPda,
          stockMint: fresh.stockMint,
          marketState: marketPda,
          priceUpdate: pythAaplFeed,
          vaultTokenAccount: fresh.vaultStockAta,
          recipientTokenAccount: fresh.recipientStockAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have failed due to stale market on revoke");
    } catch (e) {
      assert.include(e.message, "MarketStateStale");
    }

    await marketStateProgram.methods
      .updateMarketState({ open: {} })
      .accounts({
        market: marketPda,
        authority: wallet.publicKey,
      })
      .rpc();
  });
});
