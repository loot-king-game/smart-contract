import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LootKing } from "../idl/loot_king";
import { expect } from "chai";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { BankrunProvider } from "anchor-bankrun";
import {
  startAnchor,
  Clock,
  BanksClient,
  ProgramTestContext,
} from "solana-bankrun";

const NORMAL_BET = 10_000_000; // 0.01 SOL in lamports
const FAST_BET = 20_000_000; // 0.02 SOL in lamports

describe("loot-king", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let program: Program<LootKing>;
  let banksClient: BanksClient;

  const commissionWallet = Keypair.generate();
  let gameStatePda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    context = await startAnchor(
      "",
      [],
      [
        {
          address: commissionWallet.publicKey,
          info: {
            lamports: LAMPORTS_PER_SOL,
            data: Buffer.alloc(0),
            owner: SystemProgram.programId,
            executable: false,
          },
        },
      ]
    );
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);

    program = new Program<LootKing>(require("../idl/loot_king.json"), provider);
    banksClient = context.banksClient;

    [gameStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_state")],
      program.programId
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      program.programId
    );
  });

  // === Helpers ===

  async function getGameState() {
    return program.account.gameState.fetch(gameStatePda);
  }

  async function getBalance(pubkey: PublicKey): Promise<number> {
    const account = await banksClient.getAccount(pubkey);
    return account ? Number(account.lamports) : 0;
  }

  function createFundedKeypair(): Keypair {
    const kp = Keypair.generate();
    context.setAccount(kp.publicKey, {
      lamports: 5 * LAMPORTS_PER_SOL,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });
    return kp;
  }

  async function placeBet(
    player: Keypair,
    isFast: boolean,
    pendingWinner?: PublicKey | null,
    commissionWalletPubkey?: PublicKey | null
  ) {
    return program.methods
      .placeBet(isFast)
      .accounts({
        gameState: gameStatePda,
        vault: vaultPda,
        player: player.publicKey,
        pendingWinnerAccount: pendingWinner ?? null,
        commissionWalletAccount: commissionWalletPubkey ?? null,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([player])
      .rpc();
  }

  async function updateCommission(
    newCommissionBps: number,
    authority?: Keypair
  ) {
    const signer = authority ?? (provider.wallet as any).payer;
    return program.methods
      .updateCommission(new anchor.BN(newCommissionBps))
      .accounts({
        gameState: gameStatePda,
        authority: signer.publicKey,
      } as any)
      .signers(authority ? [authority] : [])
      .rpc();
  }

  async function claimPrize(winner: PublicKey) {
    return program.methods
      .claimPrize()
      .accounts({
        gameState: gameStatePda,
        vault: vaultPda,
        winner: winner,
        commissionWallet: commissionWallet.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
  }

  async function warpTime(secondsForward: number) {
    const currentClock = await banksClient.getClock();
    context.setClock(
      new Clock(
        currentClock.slot,
        currentClock.epochStartTimestamp,
        currentClock.epoch,
        currentClock.leaderScheduleEpoch,
        currentClock.unixTimestamp + BigInt(secondsForward)
      )
    );
  }

  // ============================================
  // INITIALIZE
  // ============================================

  describe("initialize", () => {
    it("initializes the game state correctly", async () => {
      await program.methods
        .initialize(commissionWallet.publicKey)
        .accounts({
          gameState: gameStatePda,
          vault: vaultPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const state = await getGameState();
      expect(state.authority.toString()).to.equal(
        provider.wallet.publicKey.toString()
      );
      expect(state.commissionWallet.toString()).to.equal(
        commissionWallet.publicKey.toString()
      );
      expect(state.commissionBps.toNumber()).to.equal(300);
      expect(state.roundNumber.toNumber()).to.equal(0);
      expect(state.isActive).to.equal(false);
      expect(state.hasPendingPrize).to.equal(false);
      expect(state.winnersCount).to.equal(0);
      expect(state.topWinnersCount).to.equal(0);
      expect(state.recentBetsCount).to.equal(0);
      expect(state.bank.toNumber()).to.equal(0);
      expect(state.betCount).to.equal(0);
    });
  });

  // ============================================
  // ROUND 1: MULTI-BET ROUND (11 bets)
  // Tests: first bet, overtake, leader can't re-bet, fast bet,
  //        timer phases, claim rejection, claim with 97%/3%
  // ============================================

  describe("round 1 — multi-bet round", () => {
    const player1 = Keypair.generate();
    const player2 = Keypair.generate();
    const player3 = Keypair.generate();
    const timerPlayers: Keypair[] = [];

    before(() => {
      [player1, player2, player3].forEach((kp) => {
        context.setAccount(kp.publicKey, {
          lamports: 5 * LAMPORTS_PER_SOL,
          data: Buffer.alloc(0),
          owner: SystemProgram.programId,
          executable: false,
        });
      });
      for (let i = 0; i < 8; i++) {
        timerPlayers.push(createFundedKeypair());
      }
    });

    it("first bet starts a round with 1 hour timer", async () => {
      await placeBet(player1, false);

      const state = await getGameState();
      expect(state.isActive).to.equal(true);
      expect(state.roundNumber.toNumber()).to.equal(1);
      expect(state.leader.toString()).to.equal(player1.publicKey.toString());
      expect(state.bank.toNumber()).to.equal(NORMAL_BET);
      expect(state.betCount).to.equal(1);
    });

    it("new player overtakes and becomes leader", async () => {
      const bankBefore = (await getGameState()).bank.toNumber();
      await placeBet(player2, false);

      const state = await getGameState();
      expect(state.leader.toString()).to.equal(player2.publicKey.toString());
      expect(state.bank.toNumber()).to.equal(bankBefore + NORMAL_BET);
      expect(state.betCount).to.equal(2);
    });

    it("current leader cannot bet again", async () => {
      const state = await getGameState();
      expect(state.leader.toString()).to.equal(player2.publicKey.toString());
      try {
        await placeBet(player2, false);
        expect.fail("Should have thrown");
      } catch (err: any) {
        // Verify it's a program error, not our expect.fail
        expect(err.message).to.not.equal("Should have thrown");
      }
    });

    it("fast bet costs 0.02 SOL", async () => {
      const bankBefore = (await getGameState()).bank.toNumber();
      await placeBet(player3, true);

      const state = await getGameState();
      expect(state.leader.toString()).to.equal(player3.publicKey.toString());
      expect(state.bank.toNumber()).to.equal(bankBefore + FAST_BET);
      expect(state.betCount).to.equal(3);
    });

    it("bets 4-10 use 5 min (300s) timer — early phase", async () => {
      for (let i = 0; i < 7; i++) {
        await placeBet(timerPlayers[i], false);
      }
      const state = await getGameState();
      expect(state.betCount).to.equal(10);
    });

    it("bet 11+ uses 1 min (60s) timer — late phase", async () => {
      await placeBet(timerPlayers[7], false);
      const state = await getGameState();
      expect(state.betCount).to.equal(11);
    });

    it("cannot claim while round is still active", async () => {
      // Use provider wallet (not the actual leader) as winner to make tx unique.
      // RoundStillActive is checked BEFORE winner validation, so the error is the same.
      try {
        await program.methods
          .claimPrize()
          .accounts({
            gameState: gameStatePda,
            vault: vaultPda,
            winner: provider.wallet.publicKey,
            commissionWallet: commissionWallet.publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("Should have thrown RoundStillActive");
      } catch (err: any) {
        expect(err.toString()).to.contain("RoundStillActive");
      }
    });

    it("winner gets 97%, commission wallet gets 3% after deadline", async () => {
      const stateBefore = await getGameState();
      const winner = stateBefore.leader;
      const bank = stateBefore.bank.toNumber();
      const expectedCommission = Math.floor((bank * 300) / 10000);
      const expectedPrize = bank - expectedCommission;

      const winnerBalanceBefore = await getBalance(winner);
      const commissionBalanceBefore = await getBalance(
        commissionWallet.publicKey
      );

      // Warp time past deadline
      await warpTime(3700);

      await claimPrize(winner);

      const state = await getGameState();
      expect(state.isActive).to.equal(false);
      expect(state.bank.toNumber()).to.equal(0);
      expect(state.betCount).to.equal(0);
      expect(state.roundNumber.toNumber()).to.equal(1);

      const winnerBalanceAfter = await getBalance(winner);
      const commissionBalanceAfter = await getBalance(
        commissionWallet.publicKey
      );

      expect(winnerBalanceAfter - winnerBalanceBefore).to.equal(expectedPrize);
      expect(commissionBalanceAfter - commissionBalanceBefore).to.equal(
        expectedCommission
      );

      // Leaderboard updated
      expect(state.winnersCount).to.equal(1);
      expect(state.winners[0].wallet.toString()).to.equal(winner.toString());
      expect(state.winners[0].prize.toNumber()).to.equal(expectedPrize);
      expect(state.winners[0].roundNumber.toNumber()).to.equal(1);

      // Top winners updated
      expect(state.topWinnersCount).to.equal(1);
      expect(state.topWinners[0].wallet.toString()).to.equal(winner.toString());
      expect(state.topWinners[0].prize.toNumber()).to.equal(expectedPrize);

      // Recent bets updated (11 bets placed in this round)
      expect(state.recentBetsCount).to.equal(10); // capped at 10
    });
  });

  // ============================================
  // ROUND 2: SOLO ROUND — 100% refund, 0% commission
  // ============================================

  describe("round 2 — solo round", () => {
    const soloPlayer = Keypair.generate();

    before(() => {
      context.setAccount(soloPlayer.publicKey, {
        lamports: 5 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    });

    it("solo player starts round 2", async () => {
      await placeBet(soloPlayer, false);

      const state = await getGameState();
      expect(state.roundNumber.toNumber()).to.equal(2);
      expect(state.isActive).to.equal(true);
      expect(state.betCount).to.equal(1);
      expect(state.leader.toString()).to.equal(soloPlayer.publicKey.toString());
    });

    it("solo player gets full refund after timeout (0% commission)", async () => {
      const balanceBefore = await getBalance(soloPlayer.publicKey);
      const commissionBefore = await getBalance(commissionWallet.publicKey);

      await warpTime(3700);
      await claimPrize(soloPlayer.publicKey);

      const balanceAfter = await getBalance(soloPlayer.publicKey);
      const commissionAfter = await getBalance(commissionWallet.publicKey);

      expect(balanceAfter - balanceBefore).to.equal(NORMAL_BET);
      expect(commissionAfter - commissionBefore).to.equal(0);

      const state = await getGameState();
      expect(state.isActive).to.equal(false);
      expect(state.winnersCount).to.equal(2);
    });
  });

  // ============================================
  // FAST BET REJECTED FOR FIRST BET
  // ============================================

  describe("fast bet — rejected for first bet of a round", () => {
    const player = Keypair.generate();

    before(() => {
      context.setAccount(player.publicKey, {
        lamports: 5 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    });

    it("cannot place fast bet as the first bet of a round", async () => {
      const state = await getGameState();
      expect(state.isActive).to.equal(false);

      try {
        await placeBet(player, true);
        expect.fail("Should have thrown FastBetNotAvailableForFirstBet");
      } catch (err: any) {
        expect(err.toString()).to.contain("FastBetNotAvailableForFirstBet");
      }
    });
  });

  // ============================================
  // ROUND 3 → 4: AUTO-PAYOUT ON NEW ROUND START
  // ============================================

  describe("round 3 → 4 — auto-payout pending prize", () => {
    const round3Player1 = Keypair.generate();
    const round3Player2 = Keypair.generate();
    const round4Starter = Keypair.generate();

    before(() => {
      [round3Player1, round3Player2, round4Starter].forEach((kp) => {
        context.setAccount(kp.publicKey, {
          lamports: 5 * LAMPORTS_PER_SOL,
          data: Buffer.alloc(0),
          owner: SystemProgram.programId,
          executable: false,
        });
      });
    });

    it("round 3: two bets, timer expires without claim", async () => {
      await placeBet(round3Player1, false);
      let state = await getGameState();
      expect(state.roundNumber.toNumber()).to.equal(3);

      await placeBet(round3Player2, false);
      state = await getGameState();
      expect(state.leader.toString()).to.equal(
        round3Player2.publicKey.toString()
      );
      expect(state.betCount).to.equal(2);
      expect(state.bank.toNumber()).to.equal(NORMAL_BET * 2);

      // Warp past deadline — DON'T call claim_prize
      await warpTime(400);
    });

    it("round 4 start auto-pays round 3 winner", async () => {
      const winnerBalanceBefore = await getBalance(round3Player2.publicKey);
      const commissionBefore = await getBalance(commissionWallet.publicKey);

      const bank = NORMAL_BET * 2;
      const expectedCommission = Math.floor((bank * 300) / 10000);
      const expectedPrize = bank - expectedCommission;

      // Start round 4 — auto-finalizes round 3, auto-pays winner
      await placeBet(
        round4Starter,
        false,
        round3Player2.publicKey,
        commissionWallet.publicKey
      );

      const winnerBalanceAfter = await getBalance(round3Player2.publicKey);
      const commissionAfter = await getBalance(commissionWallet.publicKey);

      expect(winnerBalanceAfter - winnerBalanceBefore).to.equal(expectedPrize);
      expect(commissionAfter - commissionBefore).to.equal(expectedCommission);

      const state = await getGameState();
      expect(state.roundNumber.toNumber()).to.equal(4);
      expect(state.isActive).to.equal(true);
      expect(state.leader.toString()).to.equal(
        round4Starter.publicKey.toString()
      );
      expect(state.hasPendingPrize).to.equal(false);
    });
  });

  // ============================================
  // CLAIM PRIZE — NO ACTIVE ROUND
  // ============================================

  describe("claim_prize — no active round", () => {
    it("cannot claim when no active round exists", async () => {
      // Round 4 is active (solo). Warp to expire and claim it first.
      await warpTime(3700);
      const state = await getGameState();
      await claimPrize(state.leader);

      const stateAfter = await getGameState();
      expect(stateAfter.isActive).to.equal(false);

      // Now try to claim again — no active round
      try {
        // Use a random pubkey to ensure unique tx
        const randomKey = Keypair.generate().publicKey;
        await program.methods
          .claimPrize()
          .accounts({
            gameState: gameStatePda,
            vault: vaultPda,
            winner: randomKey,
            commissionWallet: commissionWallet.publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("Should have thrown NoActiveRound");
      } catch (err: any) {
        expect(err.toString()).to.contain("NoActiveRound");
      }
    });
  });

  // ============================================
  // EXPIRED ROUND — MISSING PAYOUT ACCOUNTS
  // ============================================

  describe("place_bet — expired round without payout accounts", () => {
    const starter = Keypair.generate();
    const overtaker = Keypair.generate();
    const lateBettor = Keypair.generate();

    before(() => {
      [starter, overtaker, lateBettor].forEach((kp) => {
        context.setAccount(kp.publicKey, {
          lamports: 5 * LAMPORTS_PER_SOL,
          data: Buffer.alloc(0),
          owner: SystemProgram.programId,
          executable: false,
        });
      });
    });

    it("new bet after expiry requires pending winner accounts", async () => {
      await placeBet(starter, false);
      await placeBet(overtaker, false);

      await warpTime(400);

      // Try to bet without pending winner accounts — should fail
      try {
        await placeBet(lateBettor, false);
        expect.fail("Should have failed");
      } catch (err: any) {
        // pay_pending_prize returns MissingPendingWinnerAccount when accounts are missing
        expect(err.toString()).to.contain("MissingPendingWinnerAccount");
      }
    });
  });

  // ============================================
  // LEADERBOARD ACCUMULATION
  // ============================================

  describe("leaderboard", () => {
    it("accumulated all winners from claimed rounds", async () => {
      const state = await getGameState();
      // Rounds 1 (multi-bet), 2 (solo), 3 (auto-paid), 4 (claimed) = 4 winners
      // Round 5 was finalized internally but pay failed, so still 4 from add_winner
      // Actually round 5 finalize_round was called which does add_winner,
      // but the tx failed so it was rolled back
      expect(state.winnersCount).to.equal(4);
    });
  });

  // ============================================
  // VAULT BALANCE
  // ============================================

  describe("vault balance", () => {
    it("vault holds only unclaimed round funds", async () => {
      const vaultBalance = await getBalance(vaultPda);
      const state = await getGameState();

      // The last test (round 5) has an active expired round that was never claimed
      // because the lateBettor tx failed. The round is still active with bank = 2 * NORMAL_BET
      if (state.isActive) {
        expect(vaultBalance).to.be.at.least(state.bank.toNumber());
      } else if (state.hasPendingPrize) {
        expect(vaultBalance).to.be.at.least(
          state.pendingPrize.toNumber() + state.pendingCommission.toNumber()
        );
      } else {
        // All rounds claimed, vault should be empty (or near-empty)
        expect(state.bank.toNumber()).to.equal(0);
      }
    });
  });

  // ============================================
  // TIMER VALUE VERIFICATION
  // ============================================

  describe("timer value verification", () => {
    const players: Keypair[] = [];

    before(async () => {
      // Clean up: claim any active round first
      const state = await getGameState();
      if (state.isActive) {
        await warpTime(3700);
        await claimPrize(state.leader);
      }

      for (let i = 0; i < 12; i++) {
        players.push(createFundedKeypair());
      }
    });

    it("first bet sets deadline ≈ now + 3600", async () => {
      const clockBefore = await banksClient.getClock();
      const nowBefore = Number(clockBefore.unixTimestamp);

      await placeBet(players[0], false);

      const state = await getGameState();
      const deadline = state.deadline.toNumber();
      // First bet timer = 3600
      expect(deadline).to.be.closeTo(nowBefore + 3600, 2);
    });

    it("second bet (normal) sets deadline ≈ now + 300", async () => {
      const clock = await banksClient.getClock();
      const now = Number(clock.unixTimestamp);

      await placeBet(players[1], false);

      const state = await getGameState();
      const deadline = state.deadline.toNumber();
      expect(deadline).to.be.closeTo(now + 300, 2);
    });

    it("bet 11 (normal) sets deadline ≈ now + 60", async () => {
      // Place bets 3..10 to reach bet_count=10
      for (let i = 2; i <= 9; i++) {
        await placeBet(players[i], false);
      }
      const stateBefore = await getGameState();
      expect(stateBefore.betCount).to.equal(10);

      const clock = await banksClient.getClock();
      const now = Number(clock.unixTimestamp);

      await placeBet(players[10], false);

      const state = await getGameState();
      expect(state.betCount).to.equal(11);
      const deadline = state.deadline.toNumber();
      expect(deadline).to.be.closeTo(now + 60, 2);
    });

    it("fast bet in early phase sets deadline ≈ now + 150", async () => {
      // Expire the current round, claim it, and start fresh
      await warpTime(3700);
      await claimPrize(players[10].publicKey);

      const freshPlayers = [
        createFundedKeypair(),
        createFundedKeypair(),
        createFundedKeypair(),
      ];
      await placeBet(freshPlayers[0], false); // bet 1 — normal
      await placeBet(freshPlayers[1], false); // bet 2 — normal

      const clock = await banksClient.getClock();
      const now = Number(clock.unixTimestamp);

      await placeBet(freshPlayers[2], true); // bet 3 — fast

      const state = await getGameState();
      const deadline = state.deadline.toNumber();
      expect(deadline).to.be.closeTo(now + 150, 2);

      // Clean up
      await warpTime(3700);
      await claimPrize(freshPlayers[2].publicKey);
    });

    it("fast bet in late phase sets deadline ≈ now + 30", async () => {
      // Start a round and fill it to 11+ bets, then place a fast bet
      const latePlayers: Keypair[] = [];
      for (let i = 0; i < 12; i++) {
        latePlayers.push(createFundedKeypair());
      }

      // Bet 1 (first bet, normal)
      await placeBet(latePlayers[0], false);
      // Bets 2-10 (early phase, normal)
      for (let i = 1; i <= 9; i++) {
        await placeBet(latePlayers[i], false);
      }
      const stateBefore = await getGameState();
      expect(stateBefore.betCount).to.equal(10);

      // Bet 11 — normal, enters late phase
      await placeBet(latePlayers[10], false);

      const clock = await banksClient.getClock();
      const now = Number(clock.unixTimestamp);

      // Bet 12 — fast, late phase → 30s timer
      await placeBet(latePlayers[11], true);

      const state = await getGameState();
      expect(state.betCount).to.equal(12);
      const deadline = state.deadline.toNumber();
      expect(deadline).to.be.closeTo(now + 30, 2);

      // Clean up
      await warpTime(3700);
      await claimPrize(latePlayers[11].publicKey);
    });
  });

  // ============================================
  // UPDATE COMMISSION
  // ============================================

  describe("update_commission", () => {
    it("authority can update commission to 500 (5%)", async () => {
      await updateCommission(500);

      const state = await getGameState();
      expect(state.commissionBps.toNumber()).to.equal(500);
    });

    it("rejects commission above 1000 (10%)", async () => {
      try {
        await updateCommission(1001);
        expect.fail("Should have thrown CommissionTooHigh");
      } catch (err: any) {
        expect(err.toString()).to.contain("CommissionTooHigh");
      }
    });

    it("non-authority cannot update commission", async () => {
      const nonAuthority = createFundedKeypair();
      try {
        await updateCommission(200, nonAuthority);
        expect.fail("Should have thrown Unauthorized");
      } catch (err: any) {
        // Anchor constraint error or Unauthorized
        expect(err.toString()).to.match(
          /Unauthorized|unauthorized|ConstraintRaw|2003/i
        );
      }
    });

    it("reset commission to 300 for subsequent tests", async () => {
      await updateCommission(300);

      const state = await getGameState();
      expect(state.commissionBps.toNumber()).to.equal(300);
    });
  });

  // ============================================
  // RE-INITIALIZATION ATTEMPT
  // ============================================

  describe("re-initialization attempt", () => {
    it("cannot initialize the game state twice", async () => {
      try {
        await program.methods
          .initialize(commissionWallet.publicKey)
          .accounts({
            gameState: gameStatePda,
            vault: vaultPda,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("Should have thrown — account already exists");
      } catch (err: any) {
        // Anchor rejects init on an already-initialized account
        expect(err.toString()).to.match(
          /already in use|already been processed/i
        );
      }
    });
  });

  // ============================================
  // WRONG WINNER IN CLAIM_PRIZE
  // ============================================

  describe("claim_prize — wrong winner", () => {
    const playerA = Keypair.generate();
    const playerB = Keypair.generate();

    before(() => {
      [playerA, playerB].forEach((kp) => {
        context.setAccount(kp.publicKey, {
          lamports: 5 * LAMPORTS_PER_SOL,
          data: Buffer.alloc(0),
          owner: SystemProgram.programId,
          executable: false,
        });
      });
    });

    it("rejects claim with wrong winner pubkey", async () => {
      await placeBet(playerA, false);
      await placeBet(playerB, false);
      await warpTime(400);

      // playerA is NOT the leader (playerB is). Try to claim as playerA.
      try {
        await program.methods
          .claimPrize()
          .accounts({
            gameState: gameStatePda,
            vault: vaultPda,
            winner: playerA.publicKey,
            commissionWallet: commissionWallet.publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("Should have thrown InvalidWinner");
      } catch (err: any) {
        expect(err.toString()).to.contain("InvalidWinner");
      }

      // Clean up — claim with the real winner
      await claimPrize(playerB.publicKey);
    });
  });

  // ============================================
  // WRONG COMMISSION WALLET IN CLAIM_PRIZE
  // ============================================

  describe("claim_prize — wrong commission wallet", () => {
    const playerC = Keypair.generate();
    const playerD = Keypair.generate();
    const fakeCommission = Keypair.generate();

    before(() => {
      [playerC, playerD].forEach((kp) => {
        context.setAccount(kp.publicKey, {
          lamports: 5 * LAMPORTS_PER_SOL,
          data: Buffer.alloc(0),
          owner: SystemProgram.programId,
          executable: false,
        });
      });
      context.setAccount(fakeCommission.publicKey, {
        lamports: LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    });

    it("rejects claim with wrong commission wallet", async () => {
      await placeBet(playerC, false);
      await placeBet(playerD, false);
      await warpTime(400);

      try {
        await program.methods
          .claimPrize()
          .accounts({
            gameState: gameStatePda,
            vault: vaultPda,
            winner: playerD.publicKey,
            commissionWallet: fakeCommission.publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("Should have thrown InvalidCommissionWallet");
      } catch (err: any) {
        expect(err.toString()).to.contain("InvalidCommissionWallet");
      }

      // Clean up
      await claimPrize(playerD.publicKey);
    });
  });

  // ============================================
  // LEADERBOARD CIRCULAR BUFFER OVERFLOW
  // ============================================

  describe("leaderboard circular buffer overflow", () => {
    it("running 11+ rounds keeps count at 10 and drops oldest", async () => {
      const stateBefore = await getGameState();
      const currentWinners = stateBefore.winnersCount;

      // We need enough rounds to fill and overflow the buffer.
      // Current winners_count might already be > 0 from prior tests.
      const roundsNeeded = Math.max(0, 11 - currentWinners);

      for (let i = 0; i < roundsNeeded; i++) {
        const p1 = createFundedKeypair();
        const p2 = createFundedKeypair();
        await placeBet(p1, false);
        await placeBet(p2, false);
        await warpTime(400);
        await claimPrize(p2.publicKey);
      }

      const state = await getGameState();
      expect(state.winnersCount).to.equal(10);

      // Run one more round — oldest should be dropped, count stays 10
      const pA = createFundedKeypair();
      const pB = createFundedKeypair();
      await placeBet(pA, false);
      await placeBet(pB, false);
      await warpTime(400);
      await claimPrize(pB.publicKey);

      const stateAfter = await getGameState();
      expect(stateAfter.winnersCount).to.equal(10);

      // Last entry should be pB
      const lastWinner = stateAfter.winners[9];
      expect(lastWinner.wallet.toString()).to.equal(pB.publicKey.toString());
    });
  });

  // ============================================
  // TOP WINNERS — SORTED BY PRIZE DESC
  // ============================================

  describe("top winners — sorted by prize descending", () => {
    it("top winners are sorted by prize after rounds with different prizes", async () => {
      // Clean up any active round
      const stateBefore = await getGameState();
      if (stateBefore.isActive) {
        await warpTime(3700);
        await claimPrize(stateBefore.leader);
      }

      // Run 3 rounds with varying number of bets to create different prize sizes
      // Round A: 2 bets → bank = 2 * NORMAL_BET = 20_000_000 → prize ≈ 19_400_000
      const a1 = createFundedKeypair();
      const a2 = createFundedKeypair();
      await placeBet(a1, false);
      await placeBet(a2, false);
      await warpTime(400);
      await claimPrize(a2.publicKey);
      const stateA = await getGameState();
      const prizeA = stateA.winners[stateA.winnersCount - 1].prize.toNumber();

      // Round B: 3 bets → bank = 3 * NORMAL_BET = 30_000_000 → prize ≈ 29_100_000
      const b1 = createFundedKeypair();
      const b2 = createFundedKeypair();
      const b3 = createFundedKeypair();
      await placeBet(b1, false);
      await placeBet(b2, false);
      await placeBet(b3, false);
      await warpTime(400);
      await claimPrize(b3.publicKey);
      const stateB = await getGameState();
      const prizeB = stateB.winners[stateB.winnersCount - 1].prize.toNumber();

      // Round C: 2 bets with one fast → bank = NORMAL_BET + FAST_BET = 30_000_000 → prize ≈ 29_100_000
      const c1 = createFundedKeypair();
      const c2 = createFundedKeypair();
      await placeBet(c1, false);
      await placeBet(c2, true); // fast bet
      await warpTime(400);
      await claimPrize(c2.publicKey);

      const state = await getGameState();
      const topCount = state.topWinnersCount;
      expect(topCount).to.be.at.least(3);

      // Verify top winners are sorted by prize desc
      for (let i = 0; i < topCount - 1; i++) {
        const current = state.topWinners[i].prize.toNumber();
        const next = state.topWinners[i + 1].prize.toNumber();
        expect(current).to.be.at.least(
          next,
          `topWinners[${i}] should have prize >= topWinners[${i + 1}]`
        );
      }
    });
  });

  // ============================================
  // RECENT BETS — CIRCULAR BUFFER
  // ============================================

  describe("recent bets — circular buffer", () => {
    it("recent bets accumulate and overflow correctly", async () => {
      // Clean up any active round
      const stateBefore = await getGameState();
      if (stateBefore.isActive) {
        await warpTime(3700);
        await claimPrize(stateBefore.leader);
      }

      // Place 11 bets across multiple rounds to overflow the 10-slot buffer
      // We'll track the last 10 bettors
      const allBettors: Keypair[] = [];

      // Round with many bets: 6 bets
      const roundPlayers: Keypair[] = [];
      for (let i = 0; i < 6; i++) {
        roundPlayers.push(createFundedKeypair());
      }
      await placeBet(roundPlayers[0], false);
      allBettors.push(roundPlayers[0]);
      for (let i = 1; i < 6; i++) {
        await placeBet(roundPlayers[i], false);
        allBettors.push(roundPlayers[i]);
      }
      await warpTime(400);
      await claimPrize(roundPlayers[5].publicKey);

      // Another round with 6 bets (total 12 bets → overflow)
      const roundPlayers2: Keypair[] = [];
      for (let i = 0; i < 6; i++) {
        roundPlayers2.push(createFundedKeypair());
      }
      await placeBet(roundPlayers2[0], false);
      allBettors.push(roundPlayers2[0]);
      for (let i = 1; i < 6; i++) {
        await placeBet(roundPlayers2[i], false);
        allBettors.push(roundPlayers2[i]);
      }
      await warpTime(400);
      await claimPrize(roundPlayers2[5].publicKey);

      const state = await getGameState();
      // Count should be capped at 10
      expect(state.recentBetsCount).to.equal(10);

      // The last entry should be the most recent bettor
      const lastBet = state.recentBets[9];
      expect(lastBet.wallet.toString()).to.equal(
        allBettors[allBettors.length - 1].publicKey.toString()
      );

      // All recent bets should have non-zero amounts and positive timestamps
      for (let i = 0; i < 10; i++) {
        expect(state.recentBets[i].amount.toNumber()).to.be.greaterThan(0);
        expect(state.recentBets[i].timestamp.toNumber()).to.be.greaterThan(0);
      }
    });
  });

  // ============================================
  // UPDATE COMMISSION WALLET
  // ============================================

  describe("update_commission_wallet", () => {
    const newCommissionWallet = Keypair.generate();

    it("authority can update commission wallet", async () => {
      await program.methods
        .updateCommissionWallet(newCommissionWallet.publicKey)
        .accounts({
          gameState: gameStatePda,
          authority: provider.wallet.publicKey,
        } as any)
        .rpc();

      const state = await getGameState();
      expect(state.commissionWallet.toString()).to.equal(
        newCommissionWallet.publicKey.toString()
      );
    });

    it("non-authority cannot update commission wallet", async () => {
      const rando = createFundedKeypair();
      try {
        await program.methods
          .updateCommissionWallet(rando.publicKey)
          .accounts({
            gameState: gameStatePda,
            authority: rando.publicKey,
          } as any)
          .signers([rando])
          .rpc();
        expect.fail("Should have thrown Unauthorized");
      } catch (err: any) {
        const msg = err.toString();
        expect(
          msg.includes("Unauthorized") ||
            msg.includes("0x177b") ||
            msg.includes("ConstraintRaw") ||
            msg.includes("2003")
        ).to.be.true;
      }
    });

    it("restore original commission wallet for subsequent tests", async () => {
      await program.methods
        .updateCommissionWallet(commissionWallet.publicKey)
        .accounts({
          gameState: gameStatePda,
          authority: provider.wallet.publicKey,
        } as any)
        .rpc();

      const state = await getGameState();
      expect(state.commissionWallet.toString()).to.equal(
        commissionWallet.publicKey.toString()
      );
    });
  });

  // ============================================
  // COMMISSION LOCKED PER-ROUND (M-1)
  // ============================================

  describe("commission locked per-round", () => {
    it("round uses commission rate from round start, not current rate", async () => {
      // Ensure no active round
      const stateBefore = await getGameState();
      if (stateBefore.isActive) {
        await warpTime(3700);
        await claimPrize(stateBefore.leader);
      }

      const player1 = createFundedKeypair();
      const player2 = createFundedKeypair();

      // Start round — commission is 300 bps (3%)
      await placeBet(player1, false);

      let state = await getGameState();
      expect(state.roundCommissionBps.toNumber()).to.equal(300);

      // Change commission mid-round to 1000 bps (10%)
      await updateCommission(1000);

      // Second bet
      await placeBet(player2, false);

      // Expire and claim — should use 300 bps, not 1000
      await warpTime(400);

      const winnerBalBefore = await getBalance(player2.publicKey);
      await claimPrize(player2.publicKey);
      const winnerBalAfter = await getBalance(player2.publicKey);

      // Bank = 2 * 0.01 SOL = 20_000_000
      // Prize at 3% commission = 20_000_000 * 0.97 = 19_400_000
      const gained = winnerBalAfter - winnerBalBefore;
      expect(gained).to.equal(19_400_000);

      // Reset commission
      await updateCommission(300);
    });
  });

  // ============================================
  // COMMISSION WALLET VALIDATION (L-2)
  // ============================================

  describe("commission wallet validation", () => {
    it("rejects zero address as commission wallet in update", async () => {
      try {
        await program.methods
          .updateCommissionWallet(PublicKey.default)
          .accounts({
            gameState: gameStatePda,
            authority: provider.wallet.publicKey,
          } as any)
          .rpc();
        expect.fail("Should have thrown InvalidCommissionWalletAddress");
      } catch (err: any) {
        expect(err.message).to.not.equal(
          "Should have thrown InvalidCommissionWalletAddress"
        );
      }
    });
  });

  // ============================================
  // AUTHORITY TRANSFER (TWO-STEP)
  // ============================================

  describe("authority transfer", () => {
    it("authority can propose a new authority", async () => {
      const newAuth = createFundedKeypair();
      await program.methods
        .transferAuthority(newAuth.publicKey)
        .accounts({
          gameState: gameStatePda,
          authority: provider.wallet.publicKey,
        } as any)
        .rpc();

      const state = await getGameState();
      expect(state.pendingAuthority.toString()).to.equal(
        newAuth.publicKey.toString()
      );
    });

    it("random signer cannot accept authority", async () => {
      const rando = createFundedKeypair();
      try {
        await program.methods
          .acceptAuthority()
          .accounts({
            gameState: gameStatePda,
            newAuthority: rando.publicKey,
          } as any)
          .signers([rando])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).to.not.equal("Should have thrown");
      }
    });

    it("pending authority can accept", async () => {
      // First propose
      const newAuth = createFundedKeypair();
      await program.methods
        .transferAuthority(newAuth.publicKey)
        .accounts({
          gameState: gameStatePda,
          authority: provider.wallet.publicKey,
        } as any)
        .rpc();

      // Accept
      await program.methods
        .acceptAuthority()
        .accounts({
          gameState: gameStatePda,
          newAuthority: newAuth.publicKey,
        } as any)
        .signers([newAuth])
        .rpc();

      const state = await getGameState();
      expect(state.authority.toString()).to.equal(newAuth.publicKey.toString());
      expect(state.pendingAuthority.toString()).to.equal(
        PublicKey.default.toString()
      );

      // Transfer back for subsequent tests
      await program.methods
        .transferAuthority(provider.wallet.publicKey)
        .accounts({
          gameState: gameStatePda,
          authority: newAuth.publicKey,
        } as any)
        .signers([newAuth])
        .rpc();
      await program.methods
        .acceptAuthority()
        .accounts({
          gameState: gameStatePda,
          newAuthority: provider.wallet.publicKey,
        } as any)
        .rpc();
    });

    it("cannot accept when no transfer is pending", async () => {
      const rando = createFundedKeypair();
      try {
        await program.methods
          .acceptAuthority()
          .accounts({
            gameState: gameStatePda,
            newAuthority: rando.publicKey,
          } as any)
          .signers([rando])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).to.not.equal("Should have thrown");
      }
    });

    it("non-authority cannot propose transfer", async () => {
      const rando = createFundedKeypair();
      try {
        await program.methods
          .transferAuthority(rando.publicKey)
          .accounts({
            gameState: gameStatePda,
            authority: rando.publicKey,
          } as any)
          .signers([rando])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).to.not.equal("Should have thrown");
      }
    });
  });

  // ============================================
  // VAULT BALANCE DEFINITIVE CHECK
  // ============================================

  describe("vault balance — definitive zero", () => {
    it("vault balance is exactly 0 after all rounds are claimed", async () => {
      // Ensure no active/pending rounds
      const state = await getGameState();
      if (state.isActive) {
        await warpTime(3700);
        await claimPrize(state.leader);
      }

      const stateAfter = await getGameState();
      expect(stateAfter.isActive).to.equal(false);
      expect(stateAfter.hasPendingPrize).to.equal(false);

      const vaultBalance = await getBalance(vaultPda);
      expect(vaultBalance).to.equal(0);
    });
  });

  // ============================================
  // VAULT RENT-EXEMPT RESERVE
  // ============================================
  // The vault PDA only holds round banks. A payout that empties the bank but
  // leaves a few stray lamports would move the vault from rent-exempt to
  // rent-paying, which the runtime rejects. Pre-funding the vault with the
  // rent-exempt minimum (scripts/fund-vault.sh) keeps every payout valid.

  describe("vault rent-exempt reserve", () => {
    let donor: Keypair;
    let rentExemptMin: number;

    async function transferToVault(lamports: number) {
      const tx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: donor.publicKey,
          toPubkey: vaultPda,
          lamports,
        })
      );
      await provider.sendAndConfirm!(tx, [donor]);
    }

    async function playTwoBetRound() {
      const p1 = createFundedKeypair();
      const p2 = createFundedKeypair();
      await placeBet(p1, false);
      await placeBet(p2, false);
      return p2.publicKey;
    }

    before(async () => {
      donor = createFundedKeypair();
      const rent = await banksClient.getRent();
      rentExemptMin = Number(rent.minimumBalance(0n));
    });

    it("stray lamports in an unfunded vault block the payout", async () => {
      const winner = await playTwoBetRound();
      await transferToVault(1);
      await warpTime(3700);

      try {
        // Extra compute-budget ix keeps this tx distinct from the retry below.
        await program.methods
          .claimPrize()
          .accounts({
            gameState: gameStatePda,
            vault: vaultPda,
            winner,
            commissionWallet: commissionWallet.publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .preInstructions([
            ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
          ])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.not.contain("Should have thrown");
        expect(err.toString()).to.contain("insufficient funds for rent");
      }
      expect((await getGameState()).isActive).to.equal(true);
    });

    it("topping up to the rent-exempt minimum unblocks the payout", async () => {
      await transferToVault(rentExemptMin);
      const state = await getGameState();
      await claimPrize(state.leader);

      expect((await getGameState()).isActive).to.equal(false);
      expect(await getBalance(vaultPda)).to.equal(rentExemptMin + 1);
    });

    it("funded vault tolerates further donations", async () => {
      const winner = await playTwoBetRound();
      await transferToVault(1);
      await warpTime(3700);
      await claimPrize(winner);

      expect((await getGameState()).isActive).to.equal(false);
      expect(await getBalance(vaultPda)).to.equal(rentExemptMin + 2);
    });
  });
});
