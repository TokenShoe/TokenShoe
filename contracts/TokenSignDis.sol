// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

import {TokenDisBase} from "./TokenDisBase.sol";

contract TokenSignDis is TokenDisBase, EIP712Upgradeable {
    using SafeERC20 for IERC20;

    /// @custom:storage-location erc7201:tokendis.sign.storage
    struct SignStorage {
        address signer;
        uint64 startTime;
        uint64 endTime;
        uint64 totalPausedDuration;
        uint64 pausedSince;
        mapping(bytes32 => bool) usedClaimIds;
    }

    // keccak256(abi.encode(uint256(keccak256("tokendis.sign.storage")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant SIGN_STORAGE_LOCATION = 0x828045a1e184b2d81edaef517145cec67cd386eec1d24f138066e64c35077900;

    bytes32 public constant CLAIM_REQUEST_TYPEHASH =
        keccak256("ClaimRequest(address account,uint256 amount,bytes32 claimId,uint256 deadline)");

    error InvalidSigner();
    error InvalidTimeWindow();
    error NotInClaimWindow();
    error DeadlineExpired();
    error ClaimIdUsed(bytes32 claimId);
    error InvalidSignature();

    event SignerUpdated(address indexed oldSigner, address indexed newSigner);

    constructor() {
        _disableInitializers();
    }

    function initialize(address token_, address creator_, uint256 amount, bytes calldata initData) external initializer {
        (address signer_, uint64 startTime_, uint64 endTime_) = abi.decode(initData, (address, uint64, uint64));
        if (signer_ == address(0)) revert InvalidSigner();
        if (startTime_ == 0 || endTime_ <= startTime_) revert InvalidTimeWindow();

        __TokenDisBase_init(token_, creator_, amount);
        __EIP712_init("TokenSignDis", "1");

        SignStorage storage $ = _getSignStorage();
        $.signer = signer_;
        $.startTime = startTime_;
        $.endTime = endTime_;
    }

    function claim(address account, uint256 amount, bytes32 claimId, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
        whenNotPaused
    {
        SignStorage storage $ = _getSignStorage();

        if (block.timestamp < $.startTime || block.timestamp > effectiveEndTime()) revert NotInClaimWindow();
        if (deadline < block.timestamp) revert DeadlineExpired();
        if ($.usedClaimIds[claimId]) revert ClaimIdUsed(claimId);

        bytes32 structHash = keccak256(abi.encode(CLAIM_REQUEST_TYPEHASH, account, amount, claimId, deadline));
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, sig);
        if (recovered != $.signer) revert InvalidSignature();

        $.usedClaimIds[claimId] = true;
        _increaseClaimed(amount);
        IERC20(token()).safeTransfer(account, amount);

        emit Claimed(account, uint256(claimId), amount);
    }

    function setSigner(address newSigner) external onlyCreator {
        if (newSigner == address(0)) revert InvalidSigner();

        SignStorage storage $ = _getSignStorage();
        address oldSigner = $.signer;
        $.signer = newSigner;

        emit SignerUpdated(oldSigner, newSigner);
    }

    function signer() external view returns (address) {
        return _getSignStorage().signer;
    }

    function startTime() external view returns (uint64) {
        return _getSignStorage().startTime;
    }

    function endTime() external view returns (uint64) {
        return _getSignStorage().endTime;
    }

    function usedClaimIds(bytes32 claimId) external view returns (bool) {
        return _getSignStorage().usedClaimIds[claimId];
    }

    function effectiveEndTime() public view returns (uint64) {
        SignStorage storage $ = _getSignStorage();
        uint64 activePause = paused() ? uint64(block.timestamp) - $.pausedSince : 0;
        return $.endTime + $.totalPausedDuration + activePause;
    }

    function pause() public override onlyCreator {
        SignStorage storage $ = _getSignStorage();
        $.pausedSince = uint64(block.timestamp);
        super.pause();
    }

    function unpause() public override onlyCreator {
        SignStorage storage $ = _getSignStorage();
        $.totalPausedDuration += uint64(block.timestamp) - $.pausedSince;
        $.pausedSince = 0;
        super.unpause();
    }

    function _recoverableAmount() internal view override returns (uint256) {
        if (block.timestamp <= effectiveEndTime()) return 0;
        return IERC20(token()).balanceOf(address(this));
    }

    function _getSignStorage() private pure returns (SignStorage storage $) {
        assembly {
            $.slot := SIGN_STORAGE_LOCATION
        }
    }
}
