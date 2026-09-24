// Read-only health check of the deployed game.
// Usage: [RPC_URL=<url>] pnpm status -- devnet|mainnet
import * as anchor from "@coral-xyz/anchor";
import {
  connect,
  fetchGameState,
  lamportsToSol,
  loadProgram,
  maskRpc,
  parseCluster,
  pdas,
  programId,
  rpcUrl,
  run,
} from "./lib/common";

const { PublicKey } = anchor.web3;
const BPF_UPGRADEABLE_LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

run(async () => {
  const cluster = parseCluster("pnpm status -- devnet|mainnet");
  const connection = connect(cluster);
  const id = programId();
  const { gameState, vault } = pdas(id);
  const program = loadProgram(connection, id);
  const warnings: string[] = [];

  console.log(`Cluster:             ${cluster}`);
  console.log(`RPC:                 ${maskRpc(rpcUrl(cluster))}`);
  console.log(`Program ID:          ${id}`);

  const [programData] = PublicKey.findProgramAddressSync(
    [id.toBuffer()],
    BPF_UPGRADEABLE_LOADER
  );
  const programDataInfo = await connection.getAccountInfo(programData);
  if (!programDataInfo) {
    warnings.push("Program is not deployed on this cluster.");
  } else {
    // ProgramData layout: u32 tag, u64 slot, Option<Pubkey> authority.
    const hasAuthority = programDataInfo.data[12] === 1;
    const authority = hasAuthority
      ? new PublicKey(programDataInfo.data.subarray(13, 45)).toString()
      : "none (immutable)";
    console.log(`Upgrade authority:   ${authority}`);
  }

  const state = await fetchGameState(program, gameState);
  if (!state) {
    warnings.push("Game state is not initialized.");
  } else {
    const now = Math.floor(Date.now() / 1000);
    console.log(`Game state:          ${gameState}`);
    console.log(`Game authority:      ${state.authority}`);
    if (!state.pendingAuthority.equals(PublicKey.default)) {
      console.log(`Pending authority:   ${state.pendingAuthority}`);
      warnings.push("Game authority transfer is pending acceptance.");
    }
    console.log(`Commission wallet:   ${state.commissionWallet}`);
    console.log(`Commission bps:      ${state.commissionBps}`);
    console.log(`Round:               ${state.roundNumber}`);
    console.log(`Active:              ${state.isActive}`);
    if (state.isActive) {
      const left = state.deadline.toNumber() - now;
      console.log(`Leader:              ${state.leader}`);
      console.log(
        `Bank:                ${lamportsToSol(state.bank.toString())} SOL`
      );
      console.log(`Bets:                ${state.betCount}`);
      console.log(`Deadline in:         ${left > 0 ? `${left}s` : "expired"}`);
    }
    if (state.hasPendingPrize) {
      console.log(
        `Pending prize:       ${lamportsToSol(
          state.pendingPrize.toString()
        )} SOL → ${state.pendingWinner}`
      );
    }

    const vaultBalance = await connection.getBalance(vault);
    const rentMin = await connection.getMinimumBalanceForRentExemption(0);
    const owed =
      BigInt(state.bank.toString()) +
      (state.hasPendingPrize
        ? BigInt(state.pendingPrize.toString()) +
          BigInt(state.pendingCommission.toString())
        : 0n);
    const reserve = BigInt(vaultBalance) - owed;
    console.log(`Vault:               ${vault}`);
    console.log(`Vault balance:       ${lamportsToSol(vaultBalance)} SOL`);
    console.log(
      `Vault reserve:       ${reserve} lamports (rent-exempt min ${rentMin})`
    );
    if (reserve < BigInt(rentMin)) {
      warnings.push(
        `Vault reserve is below the rent-exempt minimum; payouts can be blocked. Run: pnpm fund-vault -- ${cluster}`
      );
    }
  }

  if (warnings.length) {
    console.log("\nWarnings:");
    warnings.forEach((w) => console.log(`- ${w}`));
    process.exitCode = 2;
  } else {
    console.log("\nOK");
  }
});
