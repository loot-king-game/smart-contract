import Solana from "@ledgerhq/hw-app-solana";
import TransportNodeHid from "@ledgerhq/hw-transport-node-hid";
import * as anchor from "@coral-xyz/anchor";

const { PublicKey, Transaction, VersionedTransaction } = anchor.web3;

const LEDGER_PATH = process.env.LEDGER_PATH ?? "44'/501'/0'";
const REFRESH_BLOCKHASH = process.env.REFRESH_BLOCKHASH !== "false";

export type AnyTx = anchor.web3.Transaction | anchor.web3.VersionedTransaction;

export function deserialize(bytes: Buffer): AnyTx {
  try {
    return Transaction.from(bytes);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Versioned messages must be deserialized")
    ) {
      return VersionedTransaction.deserialize(bytes);
    }
    throw error;
  }
}

function signerIndex(
  tx: anchor.web3.VersionedTransaction,
  key: anchor.web3.PublicKey
) {
  const count = tx.message.header.numRequiredSignatures;
  return tx.message.staticAccountKeys
    .slice(0, count)
    .findIndex((signer) => signer.equals(key));
}

function requiresSigner(tx: AnyTx, key: anchor.web3.PublicKey): boolean {
  if (tx instanceof Transaction) {
    return tx.signatures.some(({ publicKey }) => publicKey.equals(key));
  }
  return signerIndex(tx, key) >= 0;
}

function setBlockhash(tx: AnyTx, blockhash: string) {
  if (tx instanceof Transaction) {
    tx.recentBlockhash = blockhash;
    tx.signatures = tx.signatures.map(({ publicKey }) => ({
      publicKey,
      signature: null,
    }));
  } else {
    tx.message.recentBlockhash = blockhash;
    tx.signatures = tx.signatures.map(() => new Uint8Array(64));
  }
}

function messageBytes(tx: AnyTx): Buffer {
  return tx instanceof Transaction
    ? tx.serializeMessage()
    : Buffer.from(tx.message.serialize());
}

function addSignature(tx: AnyTx, key: anchor.web3.PublicKey, sig: Buffer) {
  if (tx instanceof Transaction) tx.addSignature(key, sig);
  else tx.signatures[signerIndex(tx, key)] = sig;
}

/**
 * Some RPCs (e.g. PublicNode) report "block height exceeded" for transactions
 * that did land, so on a confirmation error the signature status decides.
 */
async function confirm(
  connection: anchor.web3.Connection,
  signature: string,
  latest: anchor.web3.BlockhashWithExpiryBlockHeight
) {
  try {
    await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    return;
  } catch (error) {
    // The status can lag behind the failed confirmation; poll for a while.
    for (let attempt = 0; attempt < 10; attempt++) {
      const { value } = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const status = value[0];
      if (status?.err) {
        throw new Error(
          `Transaction ${signature} failed: ${JSON.stringify(status.err)}`
        );
      }
      if (status?.confirmationStatus) return;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw error;
  }
}

/**
 * Signs each transaction with the Ledger (plus the hot wallet when it is a
 * required signer) and sends them in order. The blockhash is refreshed right
 * before signing because exported transactions often expire while waiting for
 * Ledger approval; set REFRESH_BLOCKHASH=false to keep the original one.
 */
export async function signAndSendWithLedger(
  connection: anchor.web3.Connection,
  txs: AnyTx[],
  hotWallet: anchor.web3.Keypair | null
): Promise<string[]> {
  const signatures: string[] = [];
  const transport = await TransportNodeHid.create();
  try {
    const solana = new Solana(transport);
    const { address } = await solana.getAddress(LEDGER_PATH, false);
    const ledger = new PublicKey(address);
    console.log(`Ledger signer: ${ledger}`);

    for (const [i, tx] of txs.entries()) {
      if (!requiresSigner(tx, ledger)) {
        throw new Error(`Transaction ${i + 1} does not require ${ledger}.`);
      }

      const latest = await connection.getLatestBlockhash("confirmed");
      if (REFRESH_BLOCKHASH) setBlockhash(tx, latest.blockhash);

      if (hotWallet && requiresSigner(tx, hotWallet.publicKey)) {
        if (tx instanceof Transaction) tx.partialSign(hotWallet);
        else tx.sign([hotWallet]);
      }

      console.log(`[${i + 1}/${txs.length}] Approve on Ledger...`);
      const { signature } = await solana.signTransaction(
        LEDGER_PATH,
        messageBytes(tx)
      );
      addSignature(tx, ledger, Buffer.from(signature));

      if (tx instanceof Transaction && !tx.verifySignatures()) {
        throw new Error("Signature verification failed before send.");
      }

      const txid = await connection.sendRawTransaction(tx.serialize(), {
        preflightCommitment: "confirmed",
      });
      await confirm(connection, txid, latest);
      console.log(`[${i + 1}/${txs.length}] Signature: ${txid}`);
      signatures.push(txid);
    }
  } finally {
    await transport.close();
  }
  return signatures;
}

export async function ledgerAddress(): Promise<anchor.web3.PublicKey> {
  const transport = await TransportNodeHid.create();
  try {
    const { address } = await new Solana(transport).getAddress(
      LEDGER_PATH,
      false
    );
    return new PublicKey(address);
  } finally {
    await transport.close();
  }
}
