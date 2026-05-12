import { ethers, network, run } from 'hardhat';

// Deploy PaintballItems to the active network.
//
// Usage:
//   npx hardhat run scripts/deploy.ts --network localhost
//   npx hardhat run scripts/deploy.ts --network pulsechain
//
// Set PRIVATE_KEY in .env before deploying to a real network.

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ${network.name === 'pulsechain' ? 'PLS' : 'ETH'}`);

  const Factory = await ethers.getContractFactory('PaintballItems');
  const contract = await Factory.deploy(deployer.address);
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`PaintballItems deployed to: ${address}`);
  console.log(`Block explorer: ${explorerUrl(network.name, address)}`);
  console.log(`\nNext: paste this address into the engine's NFT-aware code paths.`);

  // Optional: auto-verify on Etherscan-style explorers when an API key is
  // configured. PulseChain's PulseScan doesn't currently support Hardhat
  // verify, so we skip there.
  if (network.name === 'pulsechain' || network.name === 'pulsechainTestnet') {
    console.log('(Verification skipped — PulseScan does not currently support Hardhat verify.)');
  } else {
    try {
      await run('verify:verify', { address, constructorArguments: [deployer.address] });
    } catch (err) {
      console.log('(Verification skipped — no API key or network not supported.)');
      void err;
    }
  }
}

function explorerUrl(network: string, address: string): string {
  switch (network) {
    case 'pulsechain': return `https://scan.pulsechain.com/address/${address}`;
    case 'pulsechainTestnet': return `https://scan.v4.testnet.pulsechain.com/address/${address}`;
    default: return `(local network)`;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
