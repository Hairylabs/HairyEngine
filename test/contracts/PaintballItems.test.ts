import { expect } from 'chai';
import { ethers } from 'hardhat';

// Smoke tests for PaintballItems — verify mint, ownership, and tokenURI.
// Run with: npx hardhat test

describe('PaintballItems', () => {
  it('mints an item and assigns owner', async () => {
    const [deployer, alice] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('PaintballItems');
    const contract = await Factory.deploy(deployer.address);
    await contract.waitForDeployment();

    const tx = await contract.safeMint(alice.address, 'ipfs://test/0.json');
    await tx.wait();

    expect(await contract.ownerOf(0)).to.equal(alice.address);
    expect(await contract.tokenURI(0)).to.equal('ipfs://test/0.json');
    expect(await contract.balanceOf(alice.address)).to.equal(1n);
  });

  it('refuses mints from non-owner', async () => {
    const [deployer, alice] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('PaintballItems');
    const contract = await Factory.deploy(deployer.address);
    await contract.waitForDeployment();

    await expect(
      contract.connect(alice).safeMint(alice.address, 'ipfs://test/x.json'),
    ).to.be.revertedWithCustomError(contract, 'OwnableUnauthorizedAccount');
  });
});
