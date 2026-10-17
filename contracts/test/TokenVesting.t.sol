// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {TokenVesting} from "../TokenVesting.sol";
import {TokenDisBase} from "../TokenDisBase.sol";
import {MockERC20} from "./MockERC20.sol";

contract TokenVestingTest is Test {
    TokenVesting internal vestImpl;
    TokenVesting internal v;
    MockERC20 internal token;

    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant FUND = 100_000e18;
    uint256 internal constant TOTAL_AMT = 10_000e18;

    // Timestamps
    uint64 internal TGE_TIME;

    function setUp() public {
        vestImpl = new TokenVesting();
        token = new MockERC20("Tk", "TK", 18);
        TGE_TIME = uint64(block.timestamp + 1000);
    }

    // ─── helpers ──────────────────────────────────────────────────────────────────

    function _deploy(TokenVesting.Schedule[] memory schedules, uint256 fundAmt) internal returns (TokenVesting vest) {
        vest = TokenVesting(Clones.clone(address(vestImpl)));
        token.mint(creator, fundAmt);
        // Transfer tokens to clone first (mirrors factory pattern)
        vm.prank(creator);
        token.transfer(address(vest), fundAmt);
        vm.prank(creator);
        vest.initialize(address(token), creator, fundAmt, abi.encode(schedules));
    }

    function _simpleSchedule(address beneficiary, uint256 amount) internal view returns (TokenVesting.Schedule memory) {
        return TokenVesting.Schedule({
            beneficiary: beneficiary,
            totalAmount: amount,
            claimed: 0,
            revokedClaimableCap: 0,
            tgeTime: TGE_TIME,
            tgeBps: 1000, // 10% at TGE
            cliffDuration: 30 days,
            vestingDuration: 180 days,
            interval: 0, // continuous
            revocable: false,
            revoked: false
        });
    }

    function _claimIds(uint256 id) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = id;
    }

    function _claimIds2(uint256 id0, uint256 id1) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](2);
        ids[0] = id0;
        ids[1] = id1;
    }

    // ─── initialization ───────────────────────────────────────────────────────────

    function test_Init_BasicSchedule() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        v = _deploy(list, FUND);

        assertEq(v.scheduleCount(), 1);
        assertEq(v.totalAllocated(), TOTAL_AMT);
        TokenVesting.Schedule memory s = v.getSchedule(0);
        assertEq(s.beneficiary, alice);
        assertEq(s.totalAmount, TOTAL_AMT);
    }

    function test_Init_EmitsScheduleCreated() public {
        TokenVesting vest = TokenVesting(Clones.clone(address(vestImpl)));
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);

        token.mint(creator, FUND);
        vm.prank(creator);
        token.transfer(address(vest), FUND);
        vm.prank(creator);
        vm.expectEmit(true, true, false, true, address(vest));
        emit TokenVesting.ScheduleCreated(0, alice, TOTAL_AMT);
        vest.initialize(address(token), creator, FUND, abi.encode(list));
    }

    function test_Init_RevertsAllocationExceedsFunding() public {
        TokenVesting vest = TokenVesting(Clones.clone(address(vestImpl)));
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, FUND + 1); // over-allocate
        token.mint(creator, FUND);
        vm.prank(creator);
        token.transfer(address(vest), FUND);
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(TokenVesting.AllocationExceedsFunding.selector, FUND + 1, FUND)
        );
        vest.initialize(address(token), creator, FUND, abi.encode(list));
    }

    function test_Init_RevertsInvalidBeneficiary() public {
        TokenVesting vest = TokenVesting(Clones.clone(address(vestImpl)));
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(address(0), TOTAL_AMT);
        token.mint(creator, FUND);
        vm.prank(creator);
        token.transfer(address(vest), FUND);
        vm.prank(creator);
        vm.expectRevert(TokenVesting.InvalidBeneficiary.selector);
        vest.initialize(address(token), creator, FUND, abi.encode(list));
    }

    function test_Init_RevertsInvalidAmount() public {
        TokenVesting vest = TokenVesting(Clones.clone(address(vestImpl)));
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, 0);
        token.mint(creator, FUND);
        vm.prank(creator);
        token.transfer(address(vest), FUND);
        vm.prank(creator);
        vm.expectRevert(TokenVesting.InvalidAmount.selector);
        vest.initialize(address(token), creator, FUND, abi.encode(list));
    }

    function test_Init_RevertsInvalidTgeBps() public {
        TokenVesting vest = TokenVesting(Clones.clone(address(vestImpl)));
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].tgeBps = 10_001; // > 10_000
        token.mint(creator, FUND);
        vm.prank(creator);
        token.transfer(address(vest), FUND);
        vm.prank(creator);
        vm.expectRevert(TokenVesting.InvalidTgeBps.selector);
        vest.initialize(address(token), creator, FUND, abi.encode(list));
    }

    // ─── TGE unlock ───────────────────────────────────────────────────────────────

    function test_Claim_TGEUnlock_10pct() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT); // 10% TGE = 1000e18
        v = _deploy(list, FUND);

        // Before TGE: nothing claimable
        assertEq(v.claimable(0), 0);

        // At TGE
        vm.warp(TGE_TIME);
        uint256 tgeAmount = TOTAL_AMT * 1000 / 10_000; // 1000e18
        assertEq(v.claimable(0), tgeAmount);

        vm.prank(alice);
        v.claim(_claimIds(0));
        assertEq(token.balanceOf(alice), tgeAmount);
    }

    function test_Claim_TgeBps_Zero_NoTGEUnlock() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].tgeBps = 0;
        v = _deploy(list, FUND);

        vm.warp(TGE_TIME);
        assertEq(v.claimable(0), 0);

        // After cliff: nothing still because vestingDuration not started
        vm.warp(TGE_TIME + 30 days);
        assertEq(v.claimable(0), 0); // cliff end just reached, interval 0 → tiny amount
        // At cliff end exactly: elapsed = 0 → 0 post-TGE portion
        // Actually: cliffEnd = TGE_TIME + 30 days, elapsed = 0 → unlocked = 0
        // But vestingDuration > 0 so we check: currentTime >= vestEnd? No.
        // unlocked = tgeAmount + (postTge * elapsed / vestingDuration) = 0 + 0 = 0
    }

    function test_Claim_TgeBps_10000_FullTGEUnlock() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].tgeBps = 10_000; // 100% at TGE
        v = _deploy(list, FUND);

        vm.warp(TGE_TIME);
        assertEq(v.claimable(0), TOTAL_AMT);

        vm.prank(alice);
        v.claim(_claimIds(0));
        assertEq(token.balanceOf(alice), TOTAL_AMT);
    }

    // ─── cliff period ────────────────────────────────────────────────────────────

    function test_Claim_DuringCliff_OnlyTGEAmount() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT); // 10% TGE, 30d cliff
        v = _deploy(list, FUND);

        // During cliff (just after TGE, before cliff end)
        vm.warp(TGE_TIME + 1 days);
        uint256 expected = TOTAL_AMT * 1000 / 10_000; // 10% TGE only
        assertEq(v.claimable(0), expected);
    }

    function test_Claim_AtCliffEnd_TGEOnly() public {
        // At exact cliffEnd with continuous vesting: elapsed=0, so only TGE unlocked
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        v = _deploy(list, FUND);

        vm.warp(TGE_TIME + 30 days);
        uint256 tge = TOTAL_AMT * 1000 / 10_000;
        // elapsed = (TGE_TIME+30days) - (TGE_TIME+30days) = 0, so unlocked = tge + 0
        assertEq(v.claimable(0), tge);
    }

    // ─── linear (continuous, interval=0) vesting ─────────────────────────────────

    function test_Claim_LinearVesting_Midpoint() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT); // 10% TGE, 30d cliff, 180d vesting
        v = _deploy(list, FUND);

        // 90 days into vesting (half of 180d)
        vm.warp(TGE_TIME + 30 days + 90 days);
        uint256 tge = TOTAL_AMT * 1000 / 10_000; // 1000e18
        uint256 postTge = TOTAL_AMT - tge; // 9000e18
        uint256 elapsed = 90 days;
        uint256 vestingDuration = 180 days;
        uint256 expected = tge + (postTge * elapsed) / vestingDuration;
        assertEq(v.claimable(0), expected);
    }

    function test_Claim_LinearVesting_Full() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        v = _deploy(list, FUND);

        vm.warp(TGE_TIME + 30 days + 180 days + 1);
        assertEq(v.claimable(0), TOTAL_AMT);

        vm.prank(alice);
        v.claim(_claimIds(0));
        assertEq(token.balanceOf(alice), TOTAL_AMT);
    }

    // ─── interval (discrete) vesting ─────────────────────────────────────────────

    function test_Claim_IntervalVesting_NotYetCrossed() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].interval = uint32(30 days); // monthly
        v = _deploy(list, FUND);

        uint64 cliffEnd = TGE_TIME + 30 days;
        // 29 days into vesting (interval not crossed)
        vm.warp(cliffEnd + 29 days);
        uint256 tge = TOTAL_AMT * 1000 / 10_000;
        // elapsed = floor(29days / 30days) * 30days = 0
        assertEq(v.claimable(0), tge);
    }

    function test_Claim_IntervalVesting_OneBoundary() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].interval = uint32(30 days);
        v = _deploy(list, FUND);

        uint64 cliffEnd = TGE_TIME + 30 days;
        vm.warp(cliffEnd + 30 days); // exactly 1 interval crossed
        uint256 tge = TOTAL_AMT * 1000 / 10_000;
        uint256 postTge = TOTAL_AMT - tge;
        uint256 elapsed = 30 days; // 1 full interval
        uint256 expected = tge + (postTge * elapsed) / uint256(180 days);
        assertEq(v.claimable(0), expected);
    }

    // ─── vestingDuration = 0 (all unlocks at cliff) ───────────────────────────────

    function test_Claim_VestingDurationZero_AllAtCliff() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].vestingDuration = 0;
        v = _deploy(list, FUND);

        // Before cliff: only TGE
        vm.warp(TGE_TIME);
        uint256 tge = TOTAL_AMT * 1000 / 10_000;
        assertEq(v.claimable(0), tge);

        // At cliff end (vestingDuration=0 → full amount unlocked)
        vm.warp(TGE_TIME + 30 days);
        assertEq(v.claimable(0), TOTAL_AMT);

        vm.prank(alice);
        v.claim(_claimIds(0));
        assertEq(token.balanceOf(alice), TOTAL_AMT);
    }

    // ─── batch claim multiple ids ─────────────────────────────────────────────────

    function test_Claim_Batch_MultipleIds() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](2);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].tgeBps = 10_000;
        list[1] = _simpleSchedule(alice, TOTAL_AMT);
        list[1].tgeBps = 10_000;
        v = _deploy(list, FUND);

        vm.warp(TGE_TIME);
        vm.prank(alice);
        v.claim(_claimIds2(0, 1));
        assertEq(token.balanceOf(alice), TOTAL_AMT * 2);
    }

    function test_Claim_Batch_SkipsZeroAmount() public {
        // schedule 0: claimable, schedule 1: nothing claimable yet
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](2);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].tgeBps = 10_000; // fully claimable at TGE
        list[1] = _simpleSchedule(alice, TOTAL_AMT);
        list[1].tgeBps = 0; // nothing at TGE
        v = _deploy(list, FUND);

        vm.warp(TGE_TIME);
        // id=1 has 0 claimable but id=0 has TOTAL_AMT → batch should succeed, skip id=1
        vm.prank(alice);
        v.claim(_claimIds2(0, 1));
        assertEq(token.balanceOf(alice), TOTAL_AMT); // only schedule 0 claimed
    }

    function test_Claim_Batch_AllZeroReverts() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].tgeBps = 0;
        v = _deploy(list, FUND);

        // Before TGE
        vm.prank(alice);
        vm.expectRevert(TokenVesting.NoClaimableAmount.selector);
        v.claim(_claimIds(0));
    }

    function test_Claim_RevertsNotBeneficiary() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].tgeBps = 10_000;
        v = _deploy(list, FUND);

        vm.warp(TGE_TIME);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(TokenVesting.NotBeneficiary.selector, uint256(0)));
        v.claim(_claimIds(0));
    }

    function test_Claim_RevertsInvalidScheduleId() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        v = _deploy(list, FUND);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 99;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TokenVesting.InvalidScheduleId.selector, uint256(99)));
        v.claim(ids);
    }

    function test_Claim_RevertsEmptyIds_NoClaimableAmount() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        v = _deploy(list, FUND);

        // Empty ids array → total=0 → NoClaimableAmount
        vm.prank(alice);
        vm.expectRevert(TokenVesting.NoClaimableAmount.selector);
        v.claim(new uint256[](0));
    }

    // ─── revoke ───────────────────────────────────────────────────────────────────

    function test_Revoke_RevocableSchedule_HappyPath() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].revocable = true;
        v = _deploy(list, FUND);

        // Warp to half vesting
        vm.warp(TGE_TIME + 30 days + 90 days);
        uint256 unlockedNow = v.claimable(0);

        vm.prank(creator);
        vm.expectEmit(true, false, false, false, address(v));
        emit TokenVesting.ScheduleRevoked(0);
        v.revoke(0);

        TokenVesting.Schedule memory s = v.getSchedule(0);
        assertTrue(s.revoked);
        // revokedClaimableCap = claimable + claimed (0 claimed before revoke)
        assertEq(s.revokedClaimableCap, unlockedNow);
    }

    function test_Revoke_BeneficiaryCanClaimUpToCap() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].revocable = true;
        v = _deploy(list, FUND);

        vm.warp(TGE_TIME + 30 days + 90 days);
        uint256 cap = v.claimable(0);

        vm.prank(creator);
        v.revoke(0);

        // Alice claims up to cap
        vm.prank(alice);
        v.claim(_claimIds(0));
        assertEq(token.balanceOf(alice), cap);

        // Nothing more claimable
        assertEq(v.claimable(0), 0);
    }

    function test_Revoke_BeneficiaryCannotClaimAboveCap() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].revocable = true;
        v = _deploy(list, FUND);

        // TGE only
        vm.warp(TGE_TIME);
        uint256 capAtRevoke = v.claimable(0); // TGE amount

        vm.prank(creator);
        v.revoke(0);

        // Alice claims the cap
        vm.prank(alice);
        v.claim(_claimIds(0));
        assertEq(token.balanceOf(alice), capAtRevoke);

        // Warp far into the future → claimable should still be 0 (revoked)
        vm.warp(TGE_TIME + 365 days);
        assertEq(v.claimable(0), 0);
    }

    function test_Revoke_CreatorCanWithdrawRemainder() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].revocable = true;
        v = _deploy(list, FUND);

        vm.warp(TGE_TIME);
        vm.prank(creator);
        v.revoke(0);

        // totalAllocated reduced → surplus is recoverable
        uint256 recoverable = FUND - (TOTAL_AMT * 1000 / 10_000); // FUND - TGEAmount
        assertEq(v.totalAllocated(), TOTAL_AMT * 1000 / 10_000);

        uint256 balance = token.balanceOf(address(v));
        uint256 reserved = v.totalAllocated() - v.totalClaimed();
        uint256 surplus = balance - reserved;
        assertEq(surplus, recoverable);

        vm.prank(creator);
        v.withdraw(creator, surplus);
        assertEq(token.balanceOf(creator), surplus);
    }

    function test_Revoke_RevertsNonRevocable() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT); // revocable=false
        v = _deploy(list, FUND);

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(TokenVesting.NotRevocable.selector, uint256(0)));
        v.revoke(0);
    }

    function test_Revoke_RevertsAlreadyRevoked() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].revocable = true;
        v = _deploy(list, FUND);

        vm.prank(creator);
        v.revoke(0);

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(TokenVesting.AlreadyRevoked.selector, uint256(0)));
        v.revoke(0);
    }

    function test_Revoke_RevertsNotCreator() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].revocable = true;
        v = _deploy(list, FUND);

        vm.prank(alice);
        vm.expectRevert(TokenDisBase.NotCreator.selector);
        v.revoke(0);
    }

    // ─── addSchedules ─────────────────────────────────────────────────────────────

    function test_AddSchedules_HappyPath() public {
        TokenVesting.Schedule[] memory init = new TokenVesting.Schedule[](1);
        init[0] = _simpleSchedule(alice, TOTAL_AMT);
        v = _deploy(init, FUND);

        // Fund more
        token.mint(creator, TOTAL_AMT);
        vm.startPrank(creator);
        token.approve(address(v), TOTAL_AMT);
        v.fund(TOTAL_AMT);
        vm.stopPrank();

        TokenVesting.Schedule[] memory extra = new TokenVesting.Schedule[](1);
        extra[0] = _simpleSchedule(bob, TOTAL_AMT);

        vm.prank(creator);
        v.addSchedules(extra);

        assertEq(v.scheduleCount(), 2);
        assertEq(v.totalAllocated(), TOTAL_AMT * 2);
        assertEq(v.getSchedule(1).beneficiary, bob);
    }

    function test_AddSchedules_RevertsAllocationExceedsBalance() public {
        TokenVesting.Schedule[] memory init = new TokenVesting.Schedule[](1);
        init[0] = _simpleSchedule(alice, TOTAL_AMT);
        v = _deploy(init, FUND);

        // Try to add a schedule that exceeds available balance
        TokenVesting.Schedule[] memory extra = new TokenVesting.Schedule[](1);
        extra[0] = _simpleSchedule(bob, FUND); // TOTAL_AMT + FUND > FUND balance

        // Capture balance before vm.prank so the balanceOf call doesn't consume the prank
        uint256 bal = token.balanceOf(address(v));
        uint256 newAllocated = TOTAL_AMT + FUND;

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(
                TokenVesting.InsufficientFundingForSchedules.selector,
                bal,
                newAllocated
            )
        );
        v.addSchedules(extra);
    }

    function test_AddSchedules_RevertsIfNotCreator() public {
        TokenVesting.Schedule[] memory init = new TokenVesting.Schedule[](1);
        init[0] = _simpleSchedule(alice, TOTAL_AMT);
        v = _deploy(init, FUND);

        TokenVesting.Schedule[] memory extra = new TokenVesting.Schedule[](1);
        extra[0] = _simpleSchedule(bob, TOTAL_AMT);

        vm.prank(alice);
        vm.expectRevert(TokenDisBase.NotCreator.selector);
        v.addSchedules(extra);
    }

    // ─── schedulesOf ─────────────────────────────────────────────────────────────

    function test_SchedulesOf_MultipleSchedules() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](3);
        list[0] = _simpleSchedule(alice, TOTAL_AMT / 3);
        list[1] = _simpleSchedule(alice, TOTAL_AMT / 3);
        list[2] = _simpleSchedule(bob, TOTAL_AMT / 3);
        v = _deploy(list, FUND);

        uint256[] memory aliceIds = v.schedulesOf(alice);
        assertEq(aliceIds.length, 2);
        assertEq(aliceIds[0], 0);
        assertEq(aliceIds[1], 1);

        uint256[] memory bobIds = v.schedulesOf(bob);
        assertEq(bobIds.length, 1);
        assertEq(bobIds[0], 2);
    }

    // ─── _recoverableAmount ───────────────────────────────────────────────────────

    function test_RecoverableAmount_AfterAllClaimed() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        list[0].tgeBps = 10_000;
        v = _deploy(list, FUND);

        vm.warp(TGE_TIME);
        vm.prank(alice);
        v.claim(_claimIds(0));

        // Surplus = FUND - TOTAL_AMT (not allocated)
        uint256 surplus = FUND - TOTAL_AMT;
        vm.prank(creator);
        v.withdraw(creator, surplus);
        assertEq(token.balanceOf(creator), surplus);
    }

    function test_RecoverableAmount_NothingRecoverableWhileAllocated() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, FUND); // full allocation
        v = _deploy(list, FUND);

        // Nothing recoverable while schedule is active
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(TokenDisBase.RecoverableExceeded.selector, 1, 0)
        );
        v.withdraw(creator, 1);
    }

    // ─── fund emits Funded ────────────────────────────────────────────────────────

    function test_Fund_EmitsFunded() public {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = _simpleSchedule(alice, TOTAL_AMT);
        v = _deploy(list, FUND);

        uint256 extra = 500e18;
        token.mint(alice, extra);
        vm.startPrank(alice);
        token.approve(address(v), extra);
        vm.expectEmit(true, false, false, true, address(v));
        emit TokenDisBase.Funded(alice, extra);
        v.fund(extra);
        vm.stopPrank();
    }

    // ─── fuzz: tgeBps, totalAmount, vestingDuration ───────────────────────────────

    function testFuzz_UnlockedAmount_NeverExceedsTotalAmount(
        uint16 tgeBps,
        uint128 totalAmount,
        uint64 vestingDuration,
        uint64 elapsed
    ) public {
        tgeBps = uint16(bound(tgeBps, 0, 10_000));
        totalAmount = uint128(bound(totalAmount, 1e6, 1e30));
        vestingDuration = uint64(bound(vestingDuration, 0, 730 days));
        elapsed = uint64(bound(elapsed, 0, 730 days + 365 days));

        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = TokenVesting.Schedule({
            beneficiary: alice,
            totalAmount: uint256(totalAmount),
            claimed: 0,
            revokedClaimableCap: 0,
            tgeTime: TGE_TIME,
            tgeBps: tgeBps,
            cliffDuration: 0,
            vestingDuration: vestingDuration,
            interval: 0,
            revocable: false,
            revoked: false
        });

        token.mint(creator, uint256(totalAmount));
        v = TokenVesting(Clones.clone(address(vestImpl)));
        vm.prank(creator);
        token.transfer(address(v), uint256(totalAmount));
        vm.prank(creator);
        v.initialize(address(token), creator, uint256(totalAmount), abi.encode(list));

        vm.warp(TGE_TIME + elapsed);
        uint256 claimableAmt = v.claimable(0);
        assertLe(claimableAmt, uint256(totalAmount));
    }

    function testFuzz_UnlockedAmount_NeverExceedsTotalAmount_WithInterval(
        uint16 tgeBps,
        uint128 totalAmount,
        uint64 vestingDuration,
        uint32 interval,
        uint64 elapsed
    ) public {
        tgeBps = uint16(bound(tgeBps, 0, 10_000));
        totalAmount = uint128(bound(totalAmount, 1e6, 1e30));
        vestingDuration = uint64(bound(vestingDuration, 1 days, 730 days));
        interval = uint32(bound(interval, 1 days, uint256(vestingDuration)));
        elapsed = uint64(bound(elapsed, 0, 730 days + 365 days));

        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = TokenVesting.Schedule({
            beneficiary: alice,
            totalAmount: uint256(totalAmount),
            claimed: 0,
            revokedClaimableCap: 0,
            tgeTime: TGE_TIME,
            tgeBps: tgeBps,
            cliffDuration: 0,
            vestingDuration: vestingDuration,
            interval: interval,
            revocable: false,
            revoked: false
        });

        token.mint(creator, uint256(totalAmount));
        v = TokenVesting(Clones.clone(address(vestImpl)));
        vm.prank(creator);
        token.transfer(address(v), uint256(totalAmount));
        vm.prank(creator);
        v.initialize(address(token), creator, uint256(totalAmount), abi.encode(list));

        vm.warp(TGE_TIME + elapsed);
        uint256 claimableAmt = v.claimable(0);
        assertLe(claimableAmt, uint256(totalAmount));
    }

    function testFuzz_ClaimedNeverExceedsTotal(uint16 tgeBps, uint128 totalAmount, uint64 warpTime) public {
        tgeBps = uint16(bound(tgeBps, 0, 10_000));
        totalAmount = uint128(bound(totalAmount, 1e6, 1e30));
        warpTime = uint64(bound(warpTime, uint64(TGE_TIME), TGE_TIME + 730 days));

        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = TokenVesting.Schedule({
            beneficiary: alice,
            totalAmount: uint256(totalAmount),
            claimed: 0,
            revokedClaimableCap: 0,
            tgeTime: TGE_TIME,
            tgeBps: tgeBps,
            cliffDuration: 0,
            vestingDuration: 365 days,
            interval: 0,
            revocable: false,
            revoked: false
        });

        token.mint(creator, uint256(totalAmount));
        v = TokenVesting(Clones.clone(address(vestImpl)));
        vm.prank(creator);
        token.transfer(address(v), uint256(totalAmount));
        vm.prank(creator);
        v.initialize(address(token), creator, uint256(totalAmount), abi.encode(list));

        vm.warp(warpTime);
        uint256 claimableAmt = v.claimable(0);
        if (claimableAmt > 0) {
            vm.prank(alice);
            v.claim(_claimIds(0));
        }

        assertLe(token.balanceOf(alice), uint256(totalAmount));
    }

    // ─── invariant: totalAllocated - totalClaimed == reserved ─────────────────────

    // Invariant: token balance >= totalAllocated - totalClaimed
    function invariant_BalanceCoversFutureObligations() public view {
        if (address(v) == address(0)) return;
        uint256 balance = token.balanceOf(address(v));
        uint256 allocated = v.totalAllocated();
        uint256 claimed = v.totalClaimed();
        assertGe(balance + claimed, allocated);
    }
}
