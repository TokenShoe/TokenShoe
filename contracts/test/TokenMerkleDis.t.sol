// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {TokenMerkleDis} from "../TokenMerkleDis.sol";
import {TokenDisBase} from "../TokenDisBase.sol";
import {MockERC20, FeeOnTransferToken} from "./MockERC20.sol";

/// @dev Helpers for building minimal Merkle trees with the same double-hash leaf
///      encoding used by TokenMerkleDis (OZ StandardMerkleTree compatible):
///      leaf = keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))))
contract MerkleTestLib {
    function leafHash(uint256 index, address account, uint256 amount) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
    }

    /// @dev Build a 2-leaf Merkle root and return proof for leaf 0 or 1.
    function twoLeafTree(uint256 i0, address a0, uint256 amt0, uint256 i1, address a1, uint256 amt1)
        public
        pure
        returns (bytes32 root, bytes32[] memory proof0, bytes32[] memory proof1)
    {
        bytes32 l0 = leafHash(i0, a0, amt0);
        bytes32 l1 = leafHash(i1, a1, amt1);

        // Sort so the root is deterministic regardless of argument order
        bytes32 leftNode = l0 < l1 ? l0 : l1;
        bytes32 rightNode = l0 < l1 ? l1 : l0;
        root = keccak256(abi.encodePacked(leftNode, rightNode));

        proof0 = new bytes32[](1);
        proof0[0] = l1;

        proof1 = new bytes32[](1);
        proof1[0] = l0;
    }

    /// @dev Single-leaf tree (proof is empty).
    function singleLeafTree(uint256 index, address account, uint256 amount)
        public
        pure
        returns (bytes32 root, bytes32[] memory proof)
    {
        root = leafHash(index, account, amount);
        proof = new bytes32[](0);
    }
}

contract TokenMerkleDisTest is Test {
    TokenMerkleDis internal impl;
    TokenMerkleDis internal dis;
    MockERC20 internal token;
    MerkleTestLib internal lib;

    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint64 internal START;
    uint64 internal END;
    uint256 internal constant FUND = 10_000e18;
    uint256 internal constant CLAIM_AMT = 100e18;

    // Current tree data
    bytes32 internal root;
    bytes32[] internal proofAlice;
    bytes32[] internal proofBob;

    /// @dev Deploy a fresh clone of the implementation and initialize it.
    /// Mirrors the factory pattern: transfer tokens INTO the clone first, then initialize.
    function _newDis(
        address token_,
        address creator_,
        uint256 fund_,
        bytes32 root_,
        uint64 start_,
        uint64 end_
    ) internal returns (TokenMerkleDis d) {
        d = TokenMerkleDis(Clones.clone(address(impl)));
        token.mint(creator_, fund_);
        // Transfer tokens to clone before calling initialize (matches factory pattern)
        vm.prank(creator_);
        token.transfer(address(d), fund_);
        vm.prank(creator_);
        d.initialize(token_, creator_, fund_, abi.encode(root_, start_, end_));
    }

    function setUp() public {
        impl = new TokenMerkleDis();
        lib = new MerkleTestLib();
        token = new MockERC20("Token", "TK", 18);

        START = uint64(block.timestamp + 100);
        END = uint64(block.timestamp + 1000);

        // Build a 2-leaf tree: index=0 → alice 100e18, index=1 → bob 100e18
        (root, proofAlice, proofBob) =
            lib.twoLeafTree(0, alice, CLAIM_AMT, 1, bob, CLAIM_AMT);

        dis = _newDis(address(token), creator, FUND, root, START, END);
    }

    // ─── initialization / deployment ─────────────────────────────────────────────

    function test_Init_StoredCorrectly() public view {
        assertEq(dis.token(), address(token));
        assertEq(dis.creator(), creator);
        assertEq(dis.totalFunded(), FUND);
        assertEq(dis.startTime(), START);
        assertEq(dis.endTime(), END);
        assertEq(dis.merkleRoot(), root);
    }

    function test_Init_RevertsIfZeroStartTime() public {
        TokenMerkleDis d = TokenMerkleDis(Clones.clone(address(impl)));
        token.mint(creator, FUND);
        vm.prank(creator);
        token.transfer(address(d), FUND);
        vm.prank(creator);
        vm.expectRevert(TokenMerkleDis.InvalidTimeWindow.selector);
        d.initialize(
            address(token), creator, FUND, abi.encode(root, uint64(0), uint64(block.timestamp + 1000))
        );
    }

    function test_Init_RevertsIfEndBeforeStart() public {
        TokenMerkleDis d = TokenMerkleDis(Clones.clone(address(impl)));
        token.mint(creator, FUND);
        vm.prank(creator);
        token.transfer(address(d), FUND);
        vm.prank(creator);
        vm.expectRevert(TokenMerkleDis.InvalidTimeWindow.selector);
        d.initialize(
            address(token), creator, FUND, abi.encode(root, uint64(block.timestamp + 1000), uint64(block.timestamp + 100))
        );
    }

    // ─── claim — happy path ───────────────────────────────────────────────────────

    function test_Claim_HappyPath_Alice() public {
        vm.warp(START + 1);

        uint256 balBefore = token.balanceOf(alice);

        vm.expectEmit(true, true, false, true, address(dis));
        emit TokenDisBase.Claimed(alice, 0, CLAIM_AMT);
        dis.claim(0, alice, CLAIM_AMT, proofAlice);

        assertEq(token.balanceOf(alice), balBefore + CLAIM_AMT);
        assertTrue(dis.isClaimed(0));
        assertEq(dis.totalClaimed(), CLAIM_AMT);
    }

    function test_Claim_HappyPath_Bob() public {
        vm.warp(START + 1);
        dis.claim(1, bob, CLAIM_AMT, proofBob);
        assertEq(token.balanceOf(bob), CLAIM_AMT);
        assertTrue(dis.isClaimed(1));
    }

    function test_Claim_TwoClaimers() public {
        vm.warp(START + 1);
        dis.claim(0, alice, CLAIM_AMT, proofAlice);
        dis.claim(1, bob, CLAIM_AMT, proofBob);
        assertEq(dis.totalClaimed(), CLAIM_AMT * 2);
    }

    // ─── claim — revert paths ─────────────────────────────────────────────────────

    function test_Claim_RevertsBeforeStartTime() public {
        vm.warp(START - 1);
        vm.expectRevert(TokenMerkleDis.NotInClaimWindow.selector);
        dis.claim(0, alice, CLAIM_AMT, proofAlice);
    }

    function test_Claim_RevertsAfterEndTime() public {
        vm.warp(uint256(END) + 1);
        vm.expectRevert(TokenMerkleDis.NotInClaimWindow.selector);
        dis.claim(0, alice, CLAIM_AMT, proofAlice);
    }

    function test_Claim_RevertsAlreadyClaimed() public {
        vm.warp(START + 1);
        dis.claim(0, alice, CLAIM_AMT, proofAlice);

        vm.expectRevert(abi.encodeWithSelector(TokenMerkleDis.AlreadyClaimed.selector, uint256(0)));
        dis.claim(0, alice, CLAIM_AMT, proofAlice);
    }

    function test_Claim_RevertsInvalidProof() public {
        vm.warp(START + 1);
        bytes32[] memory badProof = new bytes32[](1);
        badProof[0] = bytes32("bad");
        vm.expectRevert(TokenMerkleDis.InvalidProof.selector);
        dis.claim(0, alice, CLAIM_AMT, badProof);
    }

    function test_Claim_RevertsWrongAccount() public {
        vm.warp(START + 1);
        // Claim with alice's proof but wrong address
        vm.expectRevert(TokenMerkleDis.InvalidProof.selector);
        dis.claim(0, bob, CLAIM_AMT, proofAlice);
    }

    function test_Claim_RevertsWhenPaused() public {
        vm.warp(START + 1);
        vm.prank(creator);
        dis.pause();
        vm.expectRevert();
        dis.claim(0, alice, CLAIM_AMT, proofAlice);
    }

    // ─── setRoot ──────────────────────────────────────────────────────────────────

    function test_SetRoot_BeforeStartTime() public {
        // block.timestamp < startTime → can update root
        bytes32 newRoot = bytes32(uint256(1));
        vm.prank(creator);
        vm.expectEmit(true, false, false, false, address(dis));
        emit TokenMerkleDis.RootUpdated(newRoot);
        dis.setRoot(newRoot);
        assertEq(dis.merkleRoot(), newRoot);
    }

    function test_SetRoot_RevertsAfterStartTime() public {
        vm.warp(START + 1);
        vm.prank(creator);
        vm.expectRevert(TokenMerkleDis.InvalidTimeWindow.selector);
        dis.setRoot(bytes32(uint256(1)));
    }

    function test_SetRoot_RevertsIfNotCreator() public {
        vm.prank(alice);
        vm.expectRevert(TokenDisBase.NotCreator.selector);
        dis.setRoot(bytes32(uint256(1)));
    }

    // ─── pause / unpause / effectiveEndTime ──────────────────────────────────────

    function test_EffectiveEndTime_NoPause() public view {
        assertEq(dis.effectiveEndTime(), END);
    }

    function test_EffectiveEndTime_WhilePaused() public {
        vm.warp(START + 1);
        vm.prank(creator);
        dis.pause();
        // 50 seconds later, effectiveEndTime should extend by 50
        vm.warp(START + 51);
        uint64 expected = END + 50;
        assertEq(dis.effectiveEndTime(), expected);
    }

    function test_EffectiveEndTime_AfterUnpause() public {
        vm.warp(START + 1);
        vm.prank(creator);
        dis.pause();
        vm.warp(START + 101); // paused for 100 seconds
        vm.prank(creator);
        dis.unpause();
        // effectiveEndTime = END + 100 (totalPausedDuration)
        assertEq(dis.effectiveEndTime(), END + 100);
    }

    function test_PauseRugPrevention_WithdrawFailsDuringExtendedWindow() public {
        // Pause through the entire nominal window
        vm.warp(START + 1);
        vm.prank(creator);
        dis.pause();

        // Warp past nominal END (but contract is paused → effectiveEndTime extended)
        uint256 pauseDuration = uint256(END - START) + 500;
        vm.warp(uint256(START) + pauseDuration);

        // At this point block.timestamp > END but effectiveEndTime > block.timestamp (still paused)
        // So recoverableAmount = 0 → withdraw must revert
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(TokenDisBase.RecoverableExceeded.selector, 1, 0)
        );
        dis.withdraw(creator, 1);
    }

    function test_Unpause_AllowsClaimingAgain() public {
        vm.warp(START + 1);
        vm.prank(creator);
        dis.pause();
        vm.warp(START + 50);
        vm.prank(creator);
        dis.unpause();
        // Claim should succeed within effective window
        dis.claim(0, alice, CLAIM_AMT, proofAlice);
        assertEq(token.balanceOf(alice), CLAIM_AMT);
    }

    // ─── withdraw ────────────────────────────────────────────────────────────────

    function test_Withdraw_AfterEndTime() public {
        vm.warp(START + 1);
        dis.claim(0, alice, CLAIM_AMT, proofAlice);

        vm.warp(uint256(END) + 1);
        uint256 remaining = token.balanceOf(address(dis));

        vm.prank(creator);
        vm.expectEmit(true, false, false, true, address(dis));
        emit TokenDisBase.Withdrawn(creator, remaining);
        dis.withdraw(creator, remaining);

        assertEq(token.balanceOf(creator), remaining);
    }

    function test_Withdraw_RevertsBeforeEndTime() public {
        vm.warp(START + 1);
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(TokenDisBase.RecoverableExceeded.selector, 1, 0)
        );
        dis.withdraw(creator, 1);
    }

    function test_Withdraw_RevertsIfNotCreator() public {
        vm.warp(uint256(END) + 1);
        vm.prank(alice);
        vm.expectRevert(TokenDisBase.NotCreator.selector);
        dis.withdraw(alice, 1);
    }

    function test_Withdraw_RevertsAmountExceedsBalance() public {
        vm.warp(uint256(END) + 1);
        uint256 bal = token.balanceOf(address(dis));
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(TokenDisBase.RecoverableExceeded.selector, bal + 1, bal)
        );
        dis.withdraw(creator, bal + 1);
    }

    // ─── fund / fee-on-transfer ───────────────────────────────────────────────────

    function test_Fund_BalanceDeltaAccounting_Normal() public {
        uint256 extra = 500e18;
        token.mint(alice, extra);
        vm.startPrank(alice);
        token.approve(address(dis), extra);
        uint256 balBefore = dis.totalFunded();
        dis.fund(extra);
        vm.stopPrank();
        assertEq(dis.totalFunded(), balBefore + extra);
    }

    function test_Fund_FeeOnTransfer_AccountsActualReceived() public {
        FeeOnTransferToken feeToken = new FeeOnTransferToken("FT", "FT", 18);
        uint256 fundAmt = 100e18;
        feeToken.mint(creator, fundAmt * 2);

        // Deploy a new merkle dis clone with the fee token.
        // Transfer tokens to clone first (mirrors factory). Fee is taken on transfer,
        // but initialize receives the tracked amount param (not balance). Then test
        // that fund() correctly tracks actual received (balance delta) for fee tokens.
        TokenMerkleDis d = TokenMerkleDis(Clones.clone(address(impl)));
        // Transfer fundAmt to clone; 1% fee → 99e18 lands in clone
        vm.prank(creator);
        feeToken.transfer(address(d), fundAmt);
        uint256 actualDeposited = feeToken.balanceOf(address(d)); // 99e18
        vm.prank(creator);
        d.initialize(address(feeToken), creator, actualDeposited, abi.encode(root, START, END));
        vm.stopPrank();

        uint256 fundExtra = 200e18;
        feeToken.mint(alice, fundExtra);
        vm.startPrank(alice);
        feeToken.approve(address(d), fundExtra);
        uint256 totalFundedBefore = d.totalFunded();
        d.fund(fundExtra);
        vm.stopPrank();

        // 1% fee → received = fundExtra * 99/100
        uint256 expectedReceived = fundExtra - fundExtra / 100;
        assertEq(d.totalFunded(), totalFundedBefore + expectedReceived);
    }

    function test_Fund_RevertsZeroAmount() public {
        vm.expectRevert(TokenDisBase.ZeroAmount.selector);
        dis.fund(0);
    }

    // ─── transferCreator ─────────────────────────────────────────────────────────

    function test_TransferCreator_HappyPath() public {
        vm.prank(creator);
        vm.expectEmit(true, true, false, false, address(dis));
        emit TokenDisBase.CreatorTransferInitiated(creator, alice);
        dis.transferCreator(alice);
        assertEq(dis.pendingCreator(), alice);

        vm.prank(alice);
        vm.expectEmit(true, true, false, false, address(dis));
        emit TokenDisBase.CreatorTransferred(creator, alice);
        dis.acceptCreator();
        assertEq(dis.creator(), alice);
    }

    function test_TransferCreator_RevertsIfNotCreator() public {
        vm.prank(alice);
        vm.expectRevert(TokenDisBase.NotCreator.selector);
        dis.transferCreator(bob);
    }

    function test_TransferCreator_RevertsZeroAddress() public {
        vm.prank(creator);
        vm.expectRevert(TokenDisBase.ZeroAddress.selector);
        dis.transferCreator(address(0));
    }

    function test_TransferOwnership_Reverts() public {
        vm.prank(creator);
        vm.expectRevert(TokenDisBase.OwnablePathDisabled.selector);
        dis.transferOwnership(alice);
    }

    function test_RenounceOwnership_Reverts() public {
        vm.prank(creator);
        vm.expectRevert(TokenDisBase.OwnablePathDisabled.selector);
        dis.renounceOwnership();
    }
}
