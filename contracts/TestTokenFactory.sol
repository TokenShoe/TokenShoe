// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestToken
/// @notice Plain ERC-20 (18 decimals) for trying out TokenDis. The full supply is minted to the creator at deployment.
/// @dev No owner, no mint function after construction: supply is fixed at 100,000,000 tokens.
contract TestToken is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 1e18;

    constructor(string memory name_, string memory symbol_, address recipient) ERC20(name_, symbol_) {
        _mint(recipient, INITIAL_SUPPLY);
    }
}

/// @title TestTokenFactory
/// @notice Lets anyone deploy a TestToken in one transaction and receive 100,000,000 tokens.
///         Testnet convenience only — it is not part of the distribution protocol.
contract TestTokenFactory {
    uint256 public constant MAX_NAME_LENGTH = 50;
    uint256 public constant MAX_SYMBOL_LENGTH = 11;

    /// @dev creator -> tokens they created (newest last)
    mapping(address => address[]) private _tokensOf;
    address[] private _allTokens;

    error InvalidName();
    error InvalidSymbol();

    event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply);

    /// @notice Deploy a new TestToken and mint the whole supply to msg.sender.
    /// @param name_ Token name, 1-50 bytes
    /// @param symbol_ Token symbol, 1-11 bytes
    /// @return token Address of the new token
    function createToken(string calldata name_, string calldata symbol_) external returns (address token) {
        uint256 nameLen = bytes(name_).length;
        uint256 symbolLen = bytes(symbol_).length;
        if (nameLen == 0 || nameLen > MAX_NAME_LENGTH) revert InvalidName();
        if (symbolLen == 0 || symbolLen > MAX_SYMBOL_LENGTH) revert InvalidSymbol();

        token = address(new TestToken(name_, symbol_, msg.sender));
        _tokensOf[msg.sender].push(token);
        _allTokens.push(token);

        emit TokenCreated(token, msg.sender, name_, symbol_, TestToken(token).INITIAL_SUPPLY());
    }

    /// @notice All tokens created by `creator`, oldest first.
    function tokensOf(address creator) external view returns (address[] memory) {
        return _tokensOf[creator];
    }

    function tokenCountOf(address creator) external view returns (uint256) {
        return _tokensOf[creator].length;
    }

    function allTokensCount() external view returns (uint256) {
        return _allTokens.length;
    }

    function allTokens(uint256 index) external view returns (address) {
        return _allTokens[index];
    }
}
