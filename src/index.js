import { ethers } from "https://raw.githubusercontent.com/ethers-io/ethers.js/v5.5.1/packages/ethers/dist/ethers.esm.js";

const provider = new ethers.providers.Web3Provider(window.ethereum);
const signer = provider.getSigner();

const GNOSIS_SAFE = new ethers.utils.Interface([
"function execTransaction(\
  address to,\
  uint256 value,\
  bytes calldata data,\
  uint8 operation,\
  uint256 safeTxGas,\
  uint256 baseGas,\
  uint256 gasPrice,\
  address gasToken,\
  address payable refundReceiver,\
  bytes memory signatures\
) public payable returns (bool success)",
]);

function handleError(inner) {
  return () =>
    Promise.resolve(inner()).catch((err) => {
      console.error(err);
      alert(err.message);
    });
}

function flagSignature(signature, flag) {
  const { r, s, v } = ethers.utils.splitSignature(signature);
  return ethers.utils.solidityPack(
    ["bytes32", "bytes32", "uint8"],
    [r, s, flag(v)],
  );
}

function recoverOwner(domain, tx, signature) {
  const signatureArray = ethers.utils.arrayify(signature);
  const [r, s] = ethers.utils.defaultAbiCoder.decode(
    ["bytes32", "bytes32"],
    signatureArray.subarray(0, 64),
  );
  const v = signatureArray[64];

  if (v >= 27 && v <= 30) {
    return ethers.utils.verifyTypedData(
      domain,
      { SafeTx: SAFE_TX_TYPE },
      tx,
      signature,
    );
  } else if (v >= 31 && v <= 34) {
    return ethers.utils.verifyMessage(
      ethers.utils.arrayify(
        ethers.utils._TypedDataEncoder.hash(
          domain,
          { SafeTx: SAFE_TX_TYPE },
          tx,
        ),
      ),
      ethers.utils.joinSignature({ r, s, v: v - 4 }),
    );
  } else if (v === 1) {
    const [owner] = ethers.utils.defaultAbiCoder.decode(["address"], r);
    return owner;
  } else {
    throw new Error(`invalid signature V-value ${v}`);
  }
}

function readTx() {
  const a = ethers.utils.getAddress;
  const i = ethers.BigNumber.from;
  const b = ethers.utils.hexlify;
  return {
    to: a(document.querySelector("#to").value),
    value: i(document.querySelector("#value").value),
    data: b(document.querySelector("#data").value),
    operation: parseInt(document.querySelector("#operation").value),
    safeTxGas: i(document.querySelector("#safeTxGas").value),
    baseGas: i(document.querySelector("#baseGas").value),
    gasPrice: i(document.querySelector("#gasPrice").value),
    gasToken: a(document.querySelector("#gasToken").value),
    refundReceiver: a(document.querySelector("#refundReceiver").value),
    nonce: i(document.querySelector("#nonce").value),
    chainId: i(document.querySelector("#chainId").value),
  };
}

function readSignatures() {
  const rawSignatures = document.querySelector("#signatures").value;
  const byteLength = ethers.utils.hexDataLength(rawSignatures);
  if (byteLength % 65 !== 0) {
    throw new Error("invalid signatures");
  }

  const signatures = [];
  for (let i = 0; i < byteLength; i += 65) {
    signatures.push(ethers.utils.hexDataSlice(rawSignatures, i, i + 65));
  }
  return signatures;
}

const SAFE_TX_TYPE = [
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "data", type: "bytes" },
  { name: "operation", type: "uint8" },
  { name: "safeTxGas", type: "uint256" },
  { name: "baseGas", type: "uint256" },
  { name: "gasPrice", type: "uint256" },
  { name: "gasToken", type: "address" },
  { name: "refundReceiver", type: "address" },
  { name: "nonce", type: "uint256" },
];

document.querySelector("#clearsig").addEventListener(
  "click",
  handleError(() => {
    document.querySelector("#signatures").value = "0x";
  }),
);

document.querySelector("#sign").addEventListener(
  "click",
  handleError(async () => {
    await ethereum.request({ method: "eth_requestAccounts" });

    const tx = readTx();
    const { chainId } = tx;
    const domain = {
      chainId,
      verifyingContract: document.querySelector("#safe").value,
    };
    const signingScheme = document.querySelector("#signingScheme").value;
    const signatures = readSignatures();

    let signature;
    switch (signingScheme) {
      case "eip712":
        signature = await signer._signTypedData(
          domain,
          { SafeTx: SAFE_TX_TYPE },
          tx,
        );
        break;
      case "ethsign":
        signature = flagSignature(
          await signer.signMessage(
            ethers.utils.arrayify(
              ethers.utils._TypedDataEncoder.hash(
                domain,
                { SafeTx: SAFE_TX_TYPE },
                tx,
              ),
            ),
          ),
          (v) => v + 4,
        );
        break;
      case "validator":
        signature = ethers.utils.solidityPack(
          ["uint256", "uint256", "uint8"],
          [await signer.getAddress(), 0, 1],
        );
        break;
    }

    signatures.push(signature);
    document.querySelector("#signatures").value = ethers.utils.hexConcat(
      signatures
        .map((signature) => {
          const owner = recoverOwner(domain, tx, signature);
          return [owner, signature];
        })
        .sort(([a], [b]) => {
          const al = a.toLowerCase();
          const bl = b.toLowerCase();
          if (al == bl) {
            throw new Error("duplicate owner");
          }
          return al < bl ? -1 : 1;
        })
        .map(([, signature]) => signature),
    );
  }),
);

document.querySelector("#execute").addEventListener(
  "click",
  handleError(async () => {
    await ethereum.request({ method: "eth_requestAccounts" });

    const safe = new ethers.Contract(
      document.querySelector("#safe").value,
      GNOSIS_SAFE,
      signer,
    );
    const tx = readTx();

    await safe.execTransaction(
      tx.to,
      tx.value,
      tx.data,
      tx.operation,
      tx.safeTxGas,
      tx.baseGas,
      tx.gasPrice,
      tx.gasToken,
      tx.refundReceiver,
      document.querySelector("#signatures").value,
    );
  }),
);
