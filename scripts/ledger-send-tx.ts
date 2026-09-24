// Signs exported transactions with the Ledger (and the hot wallet if it is a
// required signer), then sends them in order.
//
// Usage:
//   TX_BASE64=<base64> pnpm ledger:send-tx -- devnet|mainnet
//   TX_FILE=<file with one base64 tx per line> pnpm ledger:send-tx -- devnet|mainnet
import fs from "fs";
import {
  connect,
  hotWalletPath,
  parseCluster,
  readOptionalKeypair,
  run,
} from "./lib/common";
import { deserialize, signAndSendWithLedger } from "./lib/ledger";

function readTransactions(): string[] {
  if (process.env.TX_BASE64) return [process.env.TX_BASE64.trim()];
  if (process.env.TX_FILE) {
    return fs
      .readFileSync(process.env.TX_FILE, "utf8")
      .split(/\s+/)
      .filter(Boolean);
  }
  console.error(
    "Set TX_BASE64=<base64> or TX_FILE=<path> (one base64 tx per line)."
  );
  process.exit(1);
}

run(async () => {
  const cluster = parseCluster("pnpm ledger:send-tx -- devnet|mainnet");
  const txs = readTransactions().map((b64) =>
    deserialize(Buffer.from(b64, "base64"))
  );
  await signAndSendWithLedger(
    connect(cluster),
    txs,
    readOptionalKeypair(hotWalletPath())
  );
});
