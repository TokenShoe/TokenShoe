// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {TokenDisBase} from "./TokenDisBase.sol";

contract TokenVesting is TokenDisBase {
    using SafeERC20 for IERC20;

    struct Schedule {
        address beneficiary;
        uint256 totalAmount;
        uint256 claimed;
        uint256 revokedClaimableCap;
        uint64 tgeTime;
        uint16 tgeBps;
        uint64 cliffDuration;
        uint64 vestingDuration;
        uint32 interval;
        bool revocable;
        bool revoked;
    }

    /// @custom:storage-location erc7201:tokendis.vesting.storage
    struct VestingStorage {
        mapping(uint256 => Schedule) schedules;
        mapping(address => uint256[]) beneficiarySchedules;
        uint256 scheduleCount;
        uint256 totalAllocated;
    }

    // keccak256(abi.encode(uint256(keccak256("tokendis.vesting.storage")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant VESTING_STORAGE_LOCATION = 0x356e58db66ef13ac61626afe995e3471fead37ca96d6d0c6868439091c8b1800;

    error InvalidBeneficiary();
    error InvalidAmount();
    error InvalidTgeBps();
    error InvalidScheduleId(uint256 id);
    error NotBeneficiary(uint256 id);
    error NoClaimableAmount();
    error AllocationExceedsFunding(uint256 allocated, uint256 funded);
    error InsufficientFundingForSchedules(uint256 balance, uint256 allocated);
    error NotRevocable(uint256 id);
    error AlreadyRevoked(uint256 id);

    event ScheduleCreated(uint256 indexed id, address indexed beneficiary, uint256 totalAmount);
    event ScheduleRevoked(uint256 indexed id);

    constructor() {
        _disableInitializers();
    }

    function initialize(address token_, address creator_, uint256 amount, bytes calldata initData) external initializer {
        __TokenDisBase_init(token_, creator_, amount);

        Schedule[] memory list = abi.decode(initData, (Schedule[]));
        _addSchedules(list);

        uint256 allocated = _getVestingStorage().totalAllocated;
        if (allocated > amount) revert AllocationExceedsFunding(allocated, amount);
    }

    function addSchedules(Schedule[] calldata list) external onlyCreator {
        _addSchedules(list);

        uint256 balance = IERC20(token()).balanceOf(address(this));
        uint256 allocated = _getVestingStorage().totalAllocated;
        if (balance < allocated) revert InsufficientFundingForSchedules(balance, allocated);
    }

    function claim(uint256[] calldata ids) external nonReentrant {
        VestingStorage storage $ = _getVestingStorage();
        uint256 total = 0;

        uint256 length = ids.length;
        for (uint256 i = 0; i < length; ++i) {
            uint256 id = ids[i];
            if (id >= $.scheduleCount) revert InvalidScheduleId(id);

            Schedule storage schedule = $.schedules[id];
            if (msg.sender != schedule.beneficiary) revert NotBeneficiary(id);

            uint256 amount = _claimableFromSchedule(schedule);
            if (amount == 0) continue;

            schedule.claimed += amount;
            total += amount;

            emit Claimed(msg.sender, id, amount);
        }

        if (total == 0) revert NoClaimableAmount();

        _increaseClaimed(total);
        IERC20(token()).safeTransfer(msg.sender, total);
    }

    function revoke(uint256 id) external onlyCreator {
        VestingStorage storage $ = _getVestingStorage();
        if (id >= $.scheduleCount) revert InvalidScheduleId(id);

        Schedule storage schedule = $.schedules[id];
        if (!schedule.revocable) revert NotRevocable(id);
        if (schedule.revoked) revert AlreadyRevoked(id);

        uint256 unlockedNow = _claimableFromSchedule(schedule) + schedule.claimed;

        schedule.revokedClaimableCap = unlockedNow;
        $.totalAllocated -= schedule.totalAmount - unlockedNow;
        schedule.revoked = true;

        emit ScheduleRevoked(id);
    }

    function claimable(uint256 id) public view returns (uint256) {
        VestingStorage storage $ = _getVestingStorage();
        if (id >= $.scheduleCount) revert InvalidScheduleId(id);

        return _claimableFromSchedule($.schedules[id]);
    }

    function schedulesOf(address addr) external view returns (uint256[] memory) {
        return _getVestingStorage().beneficiarySchedules[addr];
    }

    function getSchedule(uint256 id) external view returns (Schedule memory) {
        VestingStorage storage $ = _getVestingStorage();
        if (id >= $.scheduleCount) revert InvalidScheduleId(id);

        return $.schedules[id];
    }

    function scheduleCount() external view returns (uint256) {
        return _getVestingStorage().scheduleCount;
    }

    function totalAllocated() external view returns (uint256) {
        return _getVestingStorage().totalAllocated;
    }

    function _recoverableAmount() internal view override returns (uint256) {
        VestingStorage storage $ = _getVestingStorage();

        uint256 reserved = $.totalAllocated - totalClaimed();
        uint256 balance = IERC20(token()).balanceOf(address(this));
        if (balance <= reserved) return 0;

        return balance - reserved;
    }

    function _claimableFromSchedule(Schedule storage schedule) internal view returns (uint256) {
        if (schedule.revoked) {
            return schedule.revokedClaimableCap > schedule.claimed ? schedule.revokedClaimableCap - schedule.claimed : 0;
        }

        uint256 unlocked = _unlockedAmount(schedule);
        if (unlocked > schedule.totalAmount) unlocked = schedule.totalAmount;
        if (unlocked <= schedule.claimed) return 0;

        return unlocked - schedule.claimed;
    }

    function _unlockedAmount(Schedule storage schedule) internal view returns (uint256 unlocked) {
        uint256 currentTime = block.timestamp;

        uint256 tgeAmount = (schedule.totalAmount * schedule.tgeBps) / 10_000;
        uint256 postTge = schedule.totalAmount - tgeAmount;
        uint256 cliffEnd = uint256(schedule.tgeTime) + uint256(schedule.cliffDuration);
        uint256 vestEnd = cliffEnd + uint256(schedule.vestingDuration);

        if (currentTime < schedule.tgeTime) {
            unlocked = 0;
        } else if (currentTime < cliffEnd) {
            unlocked = tgeAmount;
        } else if (schedule.vestingDuration == 0) {
            unlocked = schedule.totalAmount;
        } else if (schedule.interval == 0) {
            unlocked = tgeAmount + (postTge * (currentTime - cliffEnd)) / schedule.vestingDuration;
        } else {
            // Intentional: floor to completed interval boundary (div first, then mul)
            uint256 elapsed = ((currentTime - cliffEnd) / schedule.interval) * schedule.interval; // solhint-disable-line
            unlocked = tgeAmount + (postTge * elapsed) / schedule.vestingDuration;
        }

        if (currentTime >= vestEnd) {
            unlocked = schedule.totalAmount;
        }

        if (unlocked > schedule.totalAmount) {
            unlocked = schedule.totalAmount;
        }
    }

    function _addSchedules(Schedule[] memory list) internal {
        VestingStorage storage $ = _getVestingStorage();

        uint256 length = list.length;
        for (uint256 i = 0; i < length; ++i) {
            Schedule memory item = list[i];
            if (item.beneficiary == address(0)) revert InvalidBeneficiary();
            if (item.totalAmount == 0) revert InvalidAmount();
            if (item.tgeBps > 10_000) revert InvalidTgeBps();

            uint256 id = $.scheduleCount;
            Schedule storage schedule = $.schedules[id];

            schedule.beneficiary = item.beneficiary;
            schedule.totalAmount = item.totalAmount;
            schedule.claimed = 0;
            schedule.revokedClaimableCap = 0;
            schedule.tgeTime = item.tgeTime;
            schedule.tgeBps = item.tgeBps;
            schedule.cliffDuration = item.cliffDuration;
            schedule.vestingDuration = item.vestingDuration;
            schedule.interval = item.interval;
            schedule.revocable = item.revocable;
            schedule.revoked = false;

            $.beneficiarySchedules[item.beneficiary].push(id);
            $.scheduleCount = id + 1;
            $.totalAllocated += item.totalAmount;

            emit ScheduleCreated(id, item.beneficiary, item.totalAmount);
        }
    }

    function _getVestingStorage() private pure returns (VestingStorage storage $) {
        assembly {
            $.slot := VESTING_STORAGE_LOCATION
        }
    }
}
