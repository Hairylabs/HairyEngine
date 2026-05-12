// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PaintballItems
/// @notice In-game items for HairyEngine paintball: gun skins, hats, badges,
///         match-MVP trophies. Mintable only by the owner (the game server
///         hosting matches). Holders use their items inside the game by
///         connecting their wallet and walking through the engine — the
///         renderer reads owned token IDs and unlocks corresponding cosmetics.
///
/// @dev Standard ERC-721 + Enumerable so the engine can walk balances; +
///      URIStorage so each token can carry its own metadata pointer.
contract PaintballItems is ERC721, ERC721Enumerable, ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    constructor(address initialOwner)
        ERC721("HairyEngine Paintball Items", "HEPB")
        Ownable(initialOwner)
    {}

    /// Mint a new item to `to` with metadata at `uri`. Owner-only so we
    /// don't accidentally allow open mints; the game server signs match
    /// rewards before submitting.
    function safeMint(address to, string memory uri) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        return tokenId;
    }

    // The following overrides are required by Solidity for multiple inheritance.

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
