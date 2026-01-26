import { ChronikClient } from "chronik-client";
import {
  Address,
  ALL_BIP143,
  Ecc,
  P2PKHSignatory,
  Script,
  TxBuilder,
  type TxBuilderOutput,
  shaRmd160,
  slpSend,
} from "ecash-lib";
import * as ecashLib from "ecash-lib";
import { decodeBase58Check } from "ecash-lib/dist/address/legacyaddr.js";

export type RmzSendParams = { toAddress: string; amountRmzAtoms: bigint };

const DUST_SATS = 546n;
const FEE_PER_KB = 1200n;

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set.`);
  }
  return value;
};

const normalizeChronikUrl = (url: string) => url.replace(/\/+$/, "");

const parseRecipientAddress = (address: string) => {
  if (!address.toLowerCase().startsWith("ecash:")) {
    throw new Error("Recipient address must start with ecash:.");
  }
  const parsed = Address.parse(address);
  const prefix = parsed.prefix ? parsed.prefix.toLowerCase() : "";
  if (parsed.encoding !== "cashaddr" || prefix !== "ecash") {
    throw new Error("Recipient address must be an ecash: cashaddr.");
  }
  return parsed.address;
};

const decodeWifCompat = (wif: string) => {
  const maybeDecodeWif = (ecashLib as { decodeWif?: unknown }).decodeWif;
  if (typeof maybeDecodeWif === "function") {
    const decoded = (maybeDecodeWif as (input: string) => unknown)(wif);
    if (decoded && typeof decoded === "object") {
      const maybeKey =
        (decoded as { privateKey?: Uint8Array }).privateKey ??
        (decoded as { privKey?: Uint8Array }).privKey ??
        (decoded as { key?: Uint8Array }).key;
      if (maybeKey instanceof Uint8Array && maybeKey.length === 32) {
        return maybeKey;
      }
    }
    throw new Error("ecash-lib decodeWif returned an unsupported shape.");
  }
  if (typeof maybeDecodeWif !== "undefined") {
    throw new Error(
      `ecash-lib decodeWif is not a function. Available exports: ${Object.keys(
        ecashLib
      ).join(", ")}`
    );
  }

  const payload = decodeBase58Check(wif);
  if (payload.length !== 33 && payload.length !== 34) {
    throw new Error("Invalid WIF payload length.");
  }
  const version = payload[0];
  if (version !== 0x80 && version !== 0xef) {
    throw new Error("Unsupported WIF version byte.");
  }
  if (payload.length === 34 && payload[33] !== 0x01) {
    throw new Error("Invalid WIF compression flag.");
  }
  return payload.slice(1, 33);
};

const extractUtxos = (data: unknown) => {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.flatMap((entry) =>
      Array.isArray((entry as { utxos?: unknown }).utxos)
        ? (entry as { utxos: [] }).utxos
        : []
    );
  }
  if (Array.isArray((data as { utxos?: unknown }).utxos)) {
    return (data as { utxos: [] }).utxos;
  }
  return [];
};

export const sendRmz = async (params: RmzSendParams): Promise<string> => {
  if (params.amountRmzAtoms <= 0n) {
    throw new Error("amountRmzAtoms must be greater than zero.");
  }

  const toAddress = parseRecipientAddress(params.toAddress);
  const chronikUrl = normalizeChronikUrl(getEnv("CHRONIK_URL"));
  const tokenId = getEnv("RMZ_TOKEN_ID");
  const wif = getEnv("REWARD_WALLET_WIF");

  const chronik = new ChronikClient([chronikUrl]);
  const tokenInfo = await chronik.token(tokenId);
  if (tokenInfo.tokenType.protocol !== "SLP") {
    throw new Error("RMZ token is not an SLP token.");
  }
  const tokenTypeNumber = tokenInfo.tokenType.number;

  const sk = decodeWifCompat(wif);
  const ecc = new Ecc();
  const pk = ecc.derivePubkey(sk);
  const pkh = shaRmd160(pk);
  const senderAddress = Address.p2pkh(pkh).address;
  const senderScript = Script.fromAddress(senderAddress);
  const recipientScript = Script.fromAddress(toAddress);

  const utxoResponse = await chronik.address(senderAddress).utxos();
  const utxos = extractUtxos(utxoResponse);
  if (utxos.length === 0) {
    throw new Error("No UTXOs available for the reward wallet.");
  }

  const tokenIdLower = tokenId.toLowerCase();
  const tokenUtxos = utxos
    .filter((utxo) => {
      const token = (utxo as { token?: { tokenId: string } }).token;
      if (!token) return false;
      if (token.tokenId.toLowerCase() !== tokenIdLower) return false;
      const tokenType = (token as { tokenType?: { protocol: string } })
        .tokenType;
      if (tokenType?.protocol !== "SLP") return false;
      return !(token as { isMintBaton?: boolean }).isMintBaton;
    })
    .sort((a, b) => {
      const aAtoms = BigInt(
        ((a as { token?: { atoms?: bigint } }).token?.atoms ?? 0n) as bigint
      );
      const bAtoms = BigInt(
        ((b as { token?: { atoms?: bigint } }).token?.atoms ?? 0n) as bigint
      );
      if (aAtoms === bAtoms) return 0;
      return aAtoms > bAtoms ? -1 : 1;
    });

  let selectedTokenAtoms = 0n;
  const selectedTokenUtxos = [];
  for (const utxo of tokenUtxos) {
    const atoms = BigInt(
      ((utxo as { token?: { atoms?: bigint } }).token?.atoms ?? 0n) as bigint
    );
    if (atoms <= 0n) continue;
    selectedTokenUtxos.push(utxo);
    selectedTokenAtoms += atoms;
    if (selectedTokenAtoms >= params.amountRmzAtoms) break;
  }
  if (selectedTokenAtoms < params.amountRmzAtoms) {
    throw new Error("Insufficient RMZ token balance for payout.");
  }
  const tokenChangeAtoms = selectedTokenAtoms - params.amountRmzAtoms;

  const sendAtomsArray =
    tokenChangeAtoms > 0n
      ? [params.amountRmzAtoms, tokenChangeAtoms]
      : [params.amountRmzAtoms];
  const slpScript = slpSend(tokenId, tokenTypeNumber, sendAtomsArray);

  const outputs: TxBuilderOutput[] = [
    { sats: 0n, script: slpScript },
    { sats: DUST_SATS, script: recipientScript },
  ];
  if (tokenChangeAtoms > 0n) {
    outputs.push({ sats: DUST_SATS, script: senderScript });
  }
  outputs.push(senderScript);

  const signatory = P2PKHSignatory(sk, pk, ALL_BIP143);
  const toInput = (utxo: {
    outpoint: { txid: string; outIdx: number };
    sats: bigint;
  }) => ({
    input: {
      prevOut: { txid: utxo.outpoint.txid, outIdx: utxo.outpoint.outIdx },
      signData: { sats: BigInt(utxo.sats), outputScript: senderScript },
    },
    signatory,
  });

  const xecUtxos = utxos
    .filter((utxo) => !(utxo as { token?: unknown }).token)
    .sort((a, b) => {
      const aSats = BigInt((a as { sats: bigint }).sats);
      const bSats = BigInt((b as { sats: bigint }).sats);
      if (aSats === bSats) return 0;
      return aSats > bSats ? -1 : 1;
    });

  const selectedXecUtxos = [];
  let tx = null;
  let xecIndex = 0;
  while (true) {
    const inputs = [
      ...selectedTokenUtxos.map(toInput),
      ...selectedXecUtxos.map(toInput),
    ];
    const txBuilder = new TxBuilder({ inputs, outputs });
    try {
      tx = txBuilder.sign({ feePerKb: FEE_PER_KB, dustSats: DUST_SATS });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Insufficient input sats")) {
        throw error;
      }
      if (xecIndex >= xecUtxos.length) {
        throw new Error(
          `Insufficient XEC for dust and fees. Last error: ${message}`
        );
      }
      selectedXecUtxos.push(xecUtxos[xecIndex]);
      xecIndex += 1;
    }
  }

  if (!tx) {
    throw new Error("Failed to build RMZ send transaction.");
  }

  const allSelectedUtxos = [...selectedTokenUtxos, ...selectedXecUtxos];
  const inputSats = allSelectedUtxos.reduce(
    (sum, utxo) => sum + BigInt((utxo as { sats: bigint }).sats),
    0n
  );
  const outputSats = tx.outputs.reduce(
    (sum, output) => sum + BigInt(output.sats),
    0n
  );
  const feeSats = inputSats - outputSats;

  console.log(
    [
      "RMZ send built",
      `inputs=${tx.inputs.length}`,
      `outputs=${tx.outputs.length}`,
      `feeSats=${feeSats}`,
      `tokenAmount=${params.amountRmzAtoms}`,
      `tokenChange=${tokenChangeAtoms}`,
    ].join(" ")
  );

  const result = await chronik.broadcastTx(tx.ser());
  return result.txid;
};

export default sendRmz;
