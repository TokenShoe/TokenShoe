// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {TokenDisBase} from "./TokenDisBase.sol";

contract TokenMerkleDis is TokenDisBase {
    using BitMaps for BitMaps.BitMap;
    using SafeERC20 for IERC20;

    /// @custom:storage-location erc7201:tokendis.merkle.storage
    struct MerkleStorage {
        bytes32 merkleRoot;
        uint64 startTime;
        uint64 endTime;
        uint64 totalPausedDuration;
        uint64 pausedSince;
        BitMaps.BitMap claimed;
    }

    // keccak256(abi.encode(uint256(keccak256("tokendis.merkle.storage")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant MERKLE_STORAGE_LOCATION = 0xd99d1b0fee69942bfa70857f2f84f9f4479a416e064c19c3964d6a881e3a6a00;

    error InvalidTimeWindow();
    error NotInClaimWindow();
    error AlreadyClaimed(uint256 index);
    error InvalidProof();

    event RootUpdated(bytes32 indexed newRoot);

    constructor() {
        _disableInitializers();
    }

    function initialize(address token_, address creator_, uint256 amount, bytes calldata initData) external initializer {
        (bytes32 root, uint64 startTime_, uint64 endTime_) = abi.decode(initData, (bytes32, uint64, uint64));
        if (startTime_ == 0 || endTime_ <= startTime_) revert InvalidTimeWindow();

        __TokenDisBase_init(token_, creator_, amount);

        MerkleStorage storage $ = _getMerkleStorage();
        $.merkleRoot = root;
        $.startTime = startTime_;
        $.endTime = endTime_;
    }

    function claim(uint256 index, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
        whenNotPaused
    {
        MerkleStorage storage $ = _getMerkleStorage();
        if (block.timestamp < $.startTime || block.timestamp > effectiveEndTime()) revert NotInClaimWindow();
        if ($.claimed.get(index)) revert AlreadyClaimed(index);

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
        if (!MerkleProof.verify(proof, $.merkleRoot, leaf)) revert InvalidProof();

        $.claimed.set(index);
        _increaseClaimed(amount);
        IERC20(token()).safeTransfer(account, amount);

        emit Claimed(account, index, amount);
    }

    function setRoot(bytes32 newRoot) external onlyCreator {
        MerkleStorage storage $ = _getMerkleStorage();
        if (block.timestamp >= $.startTime || block.timestamp > effectiveEndTime()) revert InvalidTimeWindow();
        $.merkleRoot = newRoot;
        emit RootUpdated(newRoot);
    }

    function isClaimed(uint256 index) public view returns (bool) {
        return _getMerkleStorage().claimed.get(index);
    }

    function merkleRoot() external view returns (bytes32) {
        return _getMerkleStorage().merkleRoot;
    }

    function startTime() external view returns (uint64) {
        return _getMerkleStorage().startTime;
    }

    function endTime() external view returns (uint64) {
        return _getMerkleStorage().endTime;
    }

    function effectiveEndTime() public view returns (uint64) {
        MerkleStorage storage $ = _getMerkleStorage();
        uint64 activePause = paused() ? uint64(block.timestamp) - $.pausedSince : 0;
        return $.endTime + $.totalPausedDuration + activePause;
    }

    function pause() public override onlyCreator {
        MerkleStorage storage $ = _getMerkleStorage();
        $.pausedSince = uint64(block.timestamp);
        super.pause();
    }

    function unpause() public override onlyCreator {
        MerkleStorage storage $ = _getMerkleStorage();
        $.totalPausedDuration += uint64(block.timestamp) - $.pausedSince;
        $.pausedSince = 0;
        super.unpause();
    }

    function _recoverableAmount() internal view override returns (uint256) {
        if (block.timestamp <= effectiveEndTime()) return 0;
        return IERC20(token()).balanceOf(address(this));
    }

    function _getMerkleStorage() private pure returns (MerkleStorage storage $) {
        assembly {
            $.slot := MERKLE_STORAGE_LOCATION
        }
    }
}
