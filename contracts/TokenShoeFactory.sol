// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ITokenDisImpl {
    function initialize(
        address token,
        address creator,
        uint256 amount,
        bytes calldata initData
    ) external;
}

contract TokenShoeFactory is Ownable2Step {
    using SafeERC20 for IERC20;

    mapping(uint8 => address) public implementations;
    mapping(address => address[]) public projectsOf;
    address[] public allProjects;

    error ZeroAddress();
    error ZeroAmount();
    error MissingImplementation(uint8 implType);

    event ImplementationSet(uint8 indexed implType, address indexed impl);
    event ProjectCreated(
        address indexed proxy,
        uint8 indexed implType,
        address indexed creator,
        address token,
        uint256 fundAmount
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setImplementation(
        uint8 implType,
        address impl
    ) external onlyOwner {
        if (impl == address(0)) revert ZeroAddress();

        implementations[implType] = impl;
        emit ImplementationSet(implType, impl);
    }

    function createProject(
        uint8 implType,
        address token,
        uint256 fundAmount,
        bytes32 userSalt,
        bytes calldata initData
    ) external returns (address proxy) {
        address impl = implementations[implType];
        if (impl == address(0)) revert MissingImplementation(implType);
        if (token == address(0)) revert ZeroAddress();
        if (fundAmount == 0) revert ZeroAmount();

        bytes32 salt = keccak256(abi.encodePacked(msg.sender, userSalt));
        proxy = Clones.cloneDeterministic(impl, salt);

        uint256 balBefore = IERC20(token).balanceOf(proxy);
        IERC20(token).safeTransferFrom(msg.sender, proxy, fundAmount);
        uint256 received = IERC20(token).balanceOf(proxy) - balBefore;
        ITokenDisImpl(proxy).initialize(token, msg.sender, received, initData);

        projectsOf[msg.sender].push(proxy);
        allProjects.push(proxy);

        emit ProjectCreated(proxy, implType, msg.sender, token, received);
    }

    function predictAddress(
        uint8 implType,
        address creator,
        bytes32 userSalt
    ) external view returns (address) {
        address impl = implementations[implType];
        if (impl == address(0)) revert MissingImplementation(implType);

        bytes32 salt = keccak256(abi.encodePacked(creator, userSalt));
        return Clones.predictDeterministicAddress(impl, salt, address(this));
    }

    function projectCountOf(address creator) external view returns (uint256) {
        return projectsOf[creator].length;
    }

    function allProjectsCount() external view returns (uint256) {
        return allProjects.length;
    }
}
