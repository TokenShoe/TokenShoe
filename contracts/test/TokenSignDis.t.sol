// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {TokenSignDis} from "../TokenSignDis.sol";
import {TokenDisBase} from "../TokenDisBase.sol";
import {MockERC20} from "./MockERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract TokenSignDisTest is Test {
    TokenSignDis internal impl;
    TokenSignDis internal dis;
    MockERC20 internal token;

    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal signerKey;
    address internal signerAddr;
    uint256 internal wrongKey;
    address internal wrongAddr;

    uint64 internal START;
    uint64 internal END;
    uint256 internal constant FUND = 10_000e18;
    uint256 internal constant CLAIM_AMT = 100e18;

    /// @dev Deploy a fresh clone and initialize it.
    /// Mirrors factory: transfer tokens to clone first, then initialize.
    function _newDis(address creator_, address signer_, uint64 start_, uint64 end_, uint256 fund_)
        internal
        returns (TokenSignDis d)
    {
        d = TokenSignDis(Clones.clone(address(impl)));
        token.mint(creator_, fund_);
        vm.prank(creator_);
        token.transfer(address(d), fund_);
        vm.prank(creator_);
        d.initialize(address(token), creator_, fund_, abi.encode(signer_, start_, end_));
    }

    function setUp() public {
        impl = new TokenSignDis();
        signerKey = 0xA11CE;
        signerAddr = vm.addr(signerKey);
        wrongKey = 0xBAD;
        wrongAddr = vm.addr(wrongKey);

        token = new MockERC20("Token", "TK", 18);

        START = uint64(block.timestamp + 100);
        END = uint64(block.timestamp + 1000);

        dis = _newDis(creator, signerAddr, START, END, FUND);
    }

    // ─── EIP-712 signature helpers ────────────────────────────────────────────────

    function _domainSeparator() internal view returns (bytes32) {
        // EIP712 domain separator: matches TokenSignDis init ("TokenSignDis","1")
        bytes32 typeHash = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        return keccak256(
            abi.encode(
                typeHash,
                keccak256("TokenSignDis"),
                keccak256("1"),
                block.chainid,
                address(dis)
            )
        );
    }

    bytes32 internal constant CLAIM_REQUEST_TYPEHASH =
        keccak256("ClaimRequest(address account,uint256 amount,bytes32 claimId,uint256 deadline)");

    function _signClaim(
        uint256 key,
        address account,
        uint256 amount,
        bytes32 claimId,
        uint256 deadline
    ) internal view returns (bytes memory sig) {
        bytes32 structHash = keccak256(abi.encode(CLAIM_REQUEST_TYPEHASH, account, amount, claimId, deadline));
        bytes32 digest = MessageHashUtils.toTypedDataHash(_domainSeparator(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        sig = abi.encodePacked(r, s, v);
    }

    // ─── initialization ───────────────────────────────────────────────────────────

    function test_Init_StoredCorrectly() public view {
        assertEq(dis.token(), address(token));
        assertEq(dis.creator(), creator);
        assertEq(dis.totalFunded(), FUND);
        assertEq(dis.signer(), signerAddr);
        assertEq(dis.startTime(), START);
        assertEq(dis.endTime(), END);
    }

    function test_Init_RevertsZeroSigner() public {
        TokenSignDis d = TokenSignDis(Clones.clone(address(impl)));
        token.mint(creator, FUND);
        vm.prank(creator);
        token.transfer(address(d), FUND);
        vm.prank(creator);
        vm.expectRevert(TokenSignDis.InvalidSigner.selector);
        d.initialize(address(token), creator, FUND, abi.encode(address(0), START, END));
    }

    // ─── claim — happy path ───────────────────────────────────────────────────────

    function test_Claim_HappyPath() public {
        vm.warp(START + 1);
        bytes32 claimId = bytes32("claim1");
        uint256 deadline = block.timestamp + 3600;

        bytes memory sig = _signClaim(signerKey, alice, CLAIM_AMT, claimId, deadline);

        uint256 balBefore = token.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(dis));
        emit TokenDisBase.Claimed(alice, uint256(claimId), CLAIM_AMT);
        dis.claim(alice, CLAIM_AMT, claimId, deadline, sig);

        assertEq(token.balanceOf(alice), balBefore + CLAIM_AMT);
        assertTrue(dis.usedClaimIds(claimId));
        assertEq(dis.totalClaimed(), CLAIM_AMT);
    }

    function test_Claim_DifferentClaimIdsIndependent() public {
        vm.warp(START + 1);
        uint256 deadline = block.timestamp + 3600;

        bytes memory sig1 = _signClaim(signerKey, alice, CLAIM_AMT, bytes32("id1"), deadline);
        bytes memory sig2 = _signClaim(signerKey, alice, CLAIM_AMT, bytes32("id2"), deadline);

        dis.claim(alice, CLAIM_AMT, bytes32("id1"), deadline, sig1);
        dis.claim(alice, CLAIM_AMT, bytes32("id2"), deadline, sig2);
        assertEq(token.balanceOf(alice), CLAIM_AMT * 2);
    }

    // ─── claim — revert paths ─────────────────────────────────────────────────────

    function test_Claim_RevertsBeforeStartTime() public {
        vm.warp(START - 1);
        bytes32 claimId = bytes32("c1");
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signClaim(signerKey, alice, CLAIM_AMT, claimId, deadline);
        vm.expectRevert(TokenSignDis.NotInClaimWindow.selector);
        dis.claim(alice, CLAIM_AMT, claimId, deadline, sig);
    }

    function test_Claim_RevertsAfterEndTime() public {
        vm.warp(uint256(END) + 1);
        bytes32 claimId = bytes32("c1");
        uint256 deadline = uint256(END) + 10000;
        bytes memory sig = _signClaim(signerKey, alice, CLAIM_AMT, claimId, deadline);
        vm.expectRevert(TokenSignDis.NotInClaimWindow.selector);
        dis.claim(alice, CLAIM_AMT, claimId, deadline, sig);
    }

    function test_Claim_RevertsExpiredDeadline() public {
        vm.warp(START + 1);
        bytes32 claimId = bytes32("c1");
        uint256 deadline = START; // already expired
        bytes memory sig = _signClaim(signerKey, alice, CLAIM_AMT, claimId, deadline);
        vm.expectRevert(TokenSignDis.DeadlineExpired.selector);
        dis.claim(alice, CLAIM_AMT, claimId, deadline, sig);
    }

    function test_Claim_RevertsUsedClaimId() public {
        vm.warp(START + 1);
        bytes32 claimId = bytes32("c1");
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signClaim(signerKey, alice, CLAIM_AMT, claimId, deadline);

        dis.claim(alice, CLAIM_AMT, claimId, deadline, sig);

        // Re-sign same claimId
        bytes memory sig2 = _signClaim(signerKey, alice, CLAIM_AMT, claimId, deadline);
        vm.expectRevert(abi.encodeWithSelector(TokenSignDis.ClaimIdUsed.selector, claimId));
        dis.claim(alice, CLAIM_AMT, claimId, deadline, sig2);
    }

    function test_Claim_RevertsWrongSigner() public {
        vm.warp(START + 1);
        bytes32 claimId = bytes32("c1");
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signClaim(wrongKey, alice, CLAIM_AMT, claimId, deadline);
        vm.expectRevert(TokenSignDis.InvalidSignature.selector);
        dis.claim(alice, CLAIM_AMT, claimId, deadline, sig);
    }

    function test_Claim_RevertsWhenPaused() public {
        vm.warp(START + 1);
        vm.prank(creator);
        dis.pause();

        bytes32 claimId = bytes32("c1");
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signClaim(signerKey, alice, CLAIM_AMT, claimId, deadline);
        vm.expectRevert();
        dis.claim(alice, CLAIM_AMT, claimId, deadline, sig);
    }

    // ─── setSigner ────────────────────────────────────────────────────────────────

    function test_SetSigner_HappyPath() public {
        address newSigner = makeAddr("newSigner");
        vm.prank(creator);
        vm.expectEmit(true, true, false, false, address(dis));
        emit TokenSignDis.SignerUpdated(signerAddr, newSigner);
        dis.setSigner(newSigner);
        assertEq(dis.signer(), newSigner);
    }

    function test_SetSigner_RevertsIfNotCreator() public {
        vm.prank(alice);
        vm.expectRevert(TokenDisBase.NotCreator.selector);
        dis.setSigner(makeAddr("newSigner"));
    }

    function test_SetSigner_RevertsZeroAddress() public {
        vm.prank(creator);
        vm.expectRevert(TokenSignDis.InvalidSigner.selector);
        dis.setSigner(address(0));
    }

    function test_SetSigner_NewSignerCanSign() public {
        uint256 newKey = 0xC0FFEE;
        address newSigner = vm.addr(newKey);

        vm.prank(creator);
        dis.setSigner(newSigner);

        vm.warp(START + 1);
        bytes32 claimId = bytes32("cx");
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signClaim(newKey, alice, CLAIM_AMT, claimId, deadline);
        dis.claim(alice, CLAIM_AMT, claimId, deadline, sig);
        assertEq(token.balanceOf(alice), CLAIM_AMT);
    }

    // ─── effectiveEndTime / pause rug prevention ─────────────────────────────────

    function test_EffectiveEndTime_NoPause() public view {
        assertEq(dis.effectiveEndTime(), END);
    }

    function test_EffectiveEndTime_WhilePaused() public {
        vm.warp(START + 1);
        vm.prank(creator);
        dis.pause();
        vm.warp(START + 51);
        assertEq(dis.effectiveEndTime(), END + 50);
    }

    function test_EffectiveEndTime_AfterUnpause() public {
        vm.warp(START + 1);
        vm.prank(creator);
        dis.pause();
        vm.warp(START + 101);
        vm.prank(creator);
        dis.unpause();
        assertEq(dis.effectiveEndTime(), END + 100);
    }

    function test_PauseRugPrevention_WithdrawFails() public {
        vm.warp(START + 1);
        vm.prank(creator);
        dis.pause();

        // Warp past nominal END
        vm.warp(uint256(END) + 500);
        // effectiveEndTime still in future (paused duration accumulates)

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(TokenDisBase.RecoverableExceeded.selector, 1, 0)
        );
        dis.withdraw(creator, 1);
    }

    // ─── withdraw ────────────────────────────────────────────────────────────────

    function test_Withdraw_AfterEndTime() public {
        vm.warp(START + 1);
        bytes32 claimId = bytes32("cw1");
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signClaim(signerKey, alice, CLAIM_AMT, claimId, deadline);
        dis.claim(alice, CLAIM_AMT, claimId, deadline, sig);

        vm.warp(uint256(END) + 1);
        uint256 remaining = token.balanceOf(address(dis));

        vm.prank(creator);
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

    // ─── fuzz: different amounts and claimIds ─────────────────────────────────────

    function testFuzz_Claim_DifferentAmountsAndIds(uint128 amount, bytes32 claimId) public {
        vm.assume(amount > 0 && amount <= FUND);
        vm.warp(START + 1);
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signClaim(signerKey, alice, uint256(amount), claimId, deadline);
        dis.claim(alice, uint256(amount), claimId, deadline, sig);
        assertEq(token.balanceOf(alice), uint256(amount));
    }
}
