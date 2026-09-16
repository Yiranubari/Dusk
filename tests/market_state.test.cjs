const anchor = require("@coral-xyz/anchor");
const { assert } = require("chai");
const { PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

describe("Market State Program Tests", () => {
  const secretKey = JSON.parse(fs.readFileSync("/home/vikky/.config/solana/id.json", "utf-8"));
  const wallet = new anchor.Wallet(anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secretKey)));
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection("http://127.0.0.1:8899", "confirmed"),
    wallet,
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  let program;

  before(async () => {
    const idlPath = path.join(__dirname, "..", "target", "idl", "market_state.json");
    const idlJson = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    program = new anchor.Program(idlJson, provider);
  });

  async function deriveMarketPda(marketId) {
    const [pda] = await PublicKey.findProgramAddress(
      [Buffer.from("market"), Buffer.from(marketId)],
      program.programId
    );
    return pda;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  describe("Initialize Market", () => {
    it("Initializes a market with valid ID", async () => {
      const marketId = "INIT_TEST_1";
      const marketPda = await deriveMarketPda(marketId);

      await program.methods
        .initializeMarket(marketId)
        .accounts({
          market: marketPda,
          authority: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const acct = await program.account.market.fetch(marketPda);
      assert.equal(acct.marketId, marketId);
      assert.isTrue(wallet.publicKey.equals(acct.authority));
      assert.isTrue(acct.state.stale !== undefined);
      assert.isNumber(acct.lastUpdateTs.toNumber());
      assert.isNumber(acct.createdAt.toNumber());
    });

    it("Fails when market ID exceeds max length (16 chars)", async () => {
            const longMarketId = "THIS_IS_TOO_LONG_";
      const marketPda = await deriveMarketPda(longMarketId);

      try {
        await program.methods
          .initializeMarket(longMarketId)
          .accounts({
            market: marketPda,
            authority: wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        assert.fail("Should have thrown an error for too-long market ID");
      } catch (err) {
        const errStr = JSON.stringify(err);
        const hasError =
          errStr.includes("MarketIdTooLong") ||
          errStr.includes("6005") ||
          errStr.includes("custom program error");
        assert.isTrue(hasError, "Expected MarketIdTooLong error but got: " + errStr);
      }
    });

    it("Can initialize different markets", async () => {
      const marketId = "INIT_TEST_2";
      const marketPda = await deriveMarketPda(marketId);

      await program.methods
        .initializeMarket(marketId)
        .accounts({
          market: marketPda,
          authority: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const acct = await program.account.market.fetch(marketPda);
      assert.equal(acct.marketId, marketId);
      assert.isTrue(acct.state.stale !== undefined);
    });

    it("Cannot initialize the same market twice", async () => {
      const marketId = "INIT_TEST_3";
      const marketPda = await deriveMarketPda(marketId);

      await program.methods
        .initializeMarket(marketId)
        .accounts({
          market: marketPda,
          authority: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      try {
        await program.methods
          .initializeMarket(marketId)
          .accounts({
            market: marketPda,
            authority: wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        assert.fail("Should fail because market already exists");
      } catch (err) {
                assert.include(JSON.stringify(err).toLowerCase(), "already in use");
      }
    });
  });

  describe("Update Market State", () => {
    let marketPda;
    const testMarketId = "UPD_TEST";

    beforeEach(async () => {
      marketPda = await deriveMarketPda(testMarketId);

      const existing = await provider.connection.getAccountInfo(marketPda);
      if (!existing) {
        await program.methods
          .initializeMarket(testMarketId)
          .accounts({
            market: marketPda,
            authority: wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        await delay(500);
      }
    });

    it("Stale -> Open", async () => {
      await program.methods
        .updateMarketState({ open: true })
        .accounts({ market: marketPda, authority: wallet.publicKey })
        .rpc();
      const acct = await program.account.market.fetch(marketPda);
      assert.isTrue(acct.state.open !== undefined);
    });

    it("Stale -> Closed", async () => {
      await program.methods
        .updateMarketState({ closed: true })
        .accounts({ market: marketPda, authority: wallet.publicKey })
        .rpc();
      const acct = await program.account.market.fetch(marketPda);
      assert.isTrue(acct.state.closed !== undefined);
    });

    it("Back to Stale", async () => {
      await program.methods
        .updateMarketState({ stale: true })
        .accounts({ market: marketPda, authority: wallet.publicKey })
        .rpc();
      const acct = await program.account.market.fetch(marketPda);
      assert.isTrue(acct.state.stale !== undefined);
    });

    it("Unauthorized update fails", async () => {
      const unauth = anchor.web3.Keypair.generate();
      try {
        await program.methods
          .updateMarketState({ open: true })
          .accounts({ market: marketPda, authority: unauth.publicKey })
          .signers([unauth])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(JSON.stringify(err), "Unauthorized");
      }
    });
  });
});
