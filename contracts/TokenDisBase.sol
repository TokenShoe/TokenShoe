// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

abstract contract TokenDisBase is Initializable, OwnableUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    /// @custom:storage-location erc7201:tokendis.base.storage
    struct BaseStorage {
        address token;
        address creator;
        address pendingCreator;
        uint256 totalFunded;
        uint256 totalClaimed;
    }

    // keccak256(abi.encode(uint256(keccak256("tokendis.base.storage")) - 1)) & ~bytes32(uint256(0xff))
    // solhint-disable-next-line state-visibility
    bytes32 private constant STORAGE_LOCATION = 0x5647a95c976ad4a57726d385c4245a2d5e3f118c374cdd8fe17c5748dc7c8c00;

    error ZeroAddress();
    error ZeroAmount();
    error NotCreator();
    error NotPendingCreator();
    error RecoverableExceeded(uint256 requested, uint256 recoverable);
    error OwnablePathDisabled();

    event Funded(address indexed funder, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event CreatorTransferInitiated(address indexed current, address indexed pending);
    event CreatorTransferred(address indexed oldCreator, address indexed newCreator);
    event Claimed(address indexed account, uint256 indexed claimKey, uint256 amount);

    modifier onlyCreator() {
        if (msg.sender != _getBaseStorage().creator) revert NotCreator();
        _;
    }

    function __TokenDisBase_init(address token_, address creator_, uint256 initialAmount) internal onlyInitializing {
        if (token_ == address(0) || creator_ == address(0)) revert ZeroAddress();
        if (initialAmount == 0) revert ZeroAmount();

        __Ownable_init(creator_);
        __Pausable_init();
        __ReentrancyGuard_init();

        BaseStorage storage $ = _getBaseStorage();
        $.token = token_;
        $.creator = creator_;
        $.totalFunded = initialAmount;

        emit Funded(creator_, initialAmount);
    }

    function fund(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        BaseStorage storage $ = _getBaseStorage();
        uint256 balBefore = IERC20($.token).balanceOf(address(this));
        IERC20($.token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20($.token).balanceOf(address(this)) - balBefore;
        $.totalFunded += received;

        emit Funded(msg.sender, received);
    }

    function pause() public virtual onlyCreator {
        _pause();
    }

    function unpause() public virtual onlyCreator {
        _unpause();
    }

    function transferCreator(address newCreator) external onlyCreator {
        if (newCreator == address(0)) revert ZeroAddress();

        BaseStorage storage $ = _getBaseStorage();
        $.pendingCreator = newCreator;

        emit CreatorTransferInitiated($.creator, newCreator);
    }

    function acceptCreator() external {
        BaseStorage storage $ = _getBaseStorage();
        if (msg.sender != $.pendingCreator) revert NotPendingCreator();

        address oldCreator = $.creator;
        $.creator = msg.sender;
        $.pendingCreator = address(0);
        _transferOwnership(msg.sender);

        emit CreatorTransferred(oldCreator, msg.sender);
    }

    function withdraw(address to, uint256 amount) external onlyCreator nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        BaseStorage storage $ = _getBaseStorage();
        uint256 recoverable = _recoverableAmount();
        if (amount > recoverable) revert RecoverableExceeded(amount, recoverable);

        $.totalFunded -= amount;
        IERC20($.token).safeTransfer(to, amount);

        emit Withdrawn(to, amount);
    }

    function transferOwnership(address) public view override onlyOwner {
        revert OwnablePathDisabled();
    }

    function renounceOwnership() public view override onlyOwner {
        revert OwnablePathDisabled();
    }

    function token() public view returns (address) {
        return _getBaseStorage().token;
    }

    function creator() public view returns (address) {
        return _getBaseStorage().creator;
    }

    function pendingCreator() public view returns (address) {
        return _getBaseStorage().pendingCreator;
    }

    function totalFunded() public view returns (uint256) {
        return _getBaseStorage().totalFunded;
    }

    function totalClaimed() public view returns (uint256) {
        return _getBaseStorage().totalClaimed;
    }

    function _increaseClaimed(uint256 amount) internal {
        _getBaseStorage().totalClaimed += amount;
    }

    function _recoverableAmount() internal view virtual returns (uint256);

    function _getBaseStorage() internal pure returns (BaseStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}
