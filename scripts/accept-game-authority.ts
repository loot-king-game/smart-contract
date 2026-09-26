// Accepts a pending game authority transfer with the authority signer.
// The hot wallet pays the fee; the authority signer signs as the new authority.
//
// Usage: [RPC_URL=<url>] pnpm game-authority:accept -- devnet|mainnet
import * as anchor from "@coral-xyz/anchor";
import {
  connect,
  fetchGameState,
  hotWalletPath,
  loadProgram,
  parseCluster,
  pdas,
  programId,
  readKeypair,
  run,
} from "./lib/common";
import { signerAddress, signAndSendWithSigner } from "./lib/hw-signer";

const { Transaction } = anchor.web3;

run(async () => {
  const cluster = parseCluster("pnpm game-authority:accept -- devnet|mainnet");
  const connection = connect(cluster);
  const id = programId();
  const hotWallet = readKeypair(hotWalletPath());
  const program = loadProgram(connection, id, hotWallet);
  const { gameState } = pdas(id);
  const signer = await signerAddress();

  const before = await fetchGameState(program, gameState);
  if (!before) throw new Error("Game state is not initialized.");
  console.log(`Current authority:  ${before.authority}`);
  console.log(`Pending authority:  ${before.pendingAuthority}`);
  console.log(`Signer:             ${signer}`);

  if (!before.pendingAuthority.equals(signer)) {
    throw new Error(
      "Pending authority does not match the authority signer public key."
    );
  }

  const instruction = await program.methods
    .acceptAuthority()
    .accounts({ gameState, newAuthority: signer } as any)
    .instruction();
  const tx = new Transaction({
    feePayer: hotWallet.publicKey,
    ...(await connection.getLatestBlockhash("confirmed")),
  }).add(instruction);

  await signAndSendWithSigner(connection, [tx], hotWallet);

  const after = await fetchGameState(program, gameState);
  console.log(`Authority after:    ${after.authority}`);
  console.log(`Pending after:      ${after.pendingAuthority}`);
});
