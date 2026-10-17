// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TokenDisFactory} from "../TokenDisFactory.sol";
import {TokenMerkleDis} from "../TokenMerkleDis.sol";
import {TokenSignDis} from "../TokenSignDis.sol";
import {TokenVesting} from "../TokenVesting.sol";
import {MockERC20} from "./MockERC20.sol";

contract TokenDisFactoryTest is Test {
    TokenDisFactory internal factory;
    TokenMerkleDis internal merkleImpl;
    TokenSignDis internal signImpl;
    TokenVesting internal vestingImpl;
    MockERC20 internal token;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint8 internal constant TYPE_MERKLE = 0;
    uint8 internal constant TYPE_SIGN = 1;
    uint8 internal constant TYPE_VESTING = 2;

    uint256 internal constant FUND = 1_000e18;

    function setUp() public {
        vm.startPrank(owner);
        factory = new TokenDisFactory(owner);
        merkleImpl = new TokenMerkleDis();
        signImpl = new TokenSignDis();
        vestingImpl = new TokenVesting();
        vm.stopPrank();

        token = new MockERC20("Token", "TK", 18);
        token.mint(alice, 10_000e18);
        token.mint(bob, 10_000e18);
    }

    // ─── setImplementation ───────────────────────────────────────────────────────

    function test_SetImplementation_HappyPath() public {
        vm.prank(owner);
        factory.setImplementation(TYPE_MERKLE, address(merkleImpl));
        assertEq(factory.implementations(TYPE_MERKLE), address(merkleImpl));
    }

    function test_SetImplementation_EmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, false, address(factory));
        emit TokenDisFactory.ImplementationSet(TYPE_MERKLE, address(merkleImpl));
        factory.setImplementation(TYPE_MERKLE, address(merkleImpl));
    }

    function test_SetImplementation_RevertsIfNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        factory.setImplementation(TYPE_MERKLE, address(merkleImpl));
    }

    function test_SetImplementation_RevertsIfZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(TokenDisFactory.ZeroAddress.selector);
        factory.setImplementation(TYPE_MERKLE, address(0));
    }

    // ─── createProject — MerkleDis ───────────────────────────────────────────────

    function _setupImpls() internal {
        vm.startPrank(owner);
        factory.setImplementation(TYPE_MERKLE, address(merkleImpl));
        factory.setImplementation(TYPE_SIGN, address(signImpl));
        factory.setImplementation(TYPE_VESTING, address(vestingImpl));
        vm.stopPrank();
    }

    function _merkleInitData() internal view returns (bytes memory) {
        bytes32 root = bytes32(0);
        uint64 start = uint64(block.timestamp + 100);
        uint64 end = uint64(block.timestamp + 1000);
        return abi.encode(root, start, end);
    }

    function _signInitData(address signerAddr) internal view returns (bytes memory) {
        uint64 start = uint64(block.timestamp + 100);
        uint64 end = uint64(block.timestamp + 1000);
        return abi.encode(signerAddr, start, end);
    }

    function _vestingInitData(address beneficiary) internal view returns (bytes memory) {
        TokenVesting.Schedule[] memory list = new TokenVesting.Schedule[](1);
        list[0] = TokenVesting.Schedule({
            beneficiary: beneficiary,
            totalAmount: FUND,
            claimed: 0,
            revokedClaimableCap: 0,
            tgeTime: uint64(block.timestamp + 100),
            tgeBps: 1000,
            cliffDuration: 30 days,
            vestingDuration: 180 days,
            interval: 0,
            revocable: false,
            revoked: false
        });
        return abi.encode(list);
    }

    function test_CreateProject_Merkle_HappyPath() public {
        _setupImpls();
        bytes memory initData = _merkleInitData();

        vm.startPrank(alice);
        token.approve(address(factory), FUND);
        address proxy = factory.createProject(TYPE_MERKLE, address(token), FUND, bytes32(0), initData);
        vm.stopPrank();

        assertTrue(proxy != address(0));
        assertEq(token.balanceOf(proxy), FUND);
        assertEq(factory.projectCountOf(alice), 1);
        assertEq(factory.projectsOf(alice, 0), proxy);
    }

    function test_CreateProject_Sign_HappyPath() public {
        _setupImpls();

        vm.startPrank(alice);
        token.approve(address(factory), FUND);
        address proxy =
            factory.createProject(TYPE_SIGN, address(token), FUND, bytes32("s1"), _signInitData(makeAddr("signer")));
        vm.stopPrank();

        assertTrue(proxy != address(0));
        assertEq(token.balanceOf(proxy), FUND);
    }

    function test_CreateProject_Vesting_HappyPath() public {
        _setupImpls();

        vm.startPrank(alice);
        token.approve(address(factory), FUND);
        address proxy =
            factory.createProject(TYPE_VESTING, address(token), FUND, bytes32("v1"), _vestingInitData(alice));
        vm.stopPrank();

        assertTrue(proxy != address(0));
        assertEq(token.balanceOf(proxy), FUND);
    }

    function test_CreateProject_EmitsProjectCreated() public {
        _setupImpls();
        bytes memory initData = _merkleInitData();
        bytes32 userSalt = bytes32("salt");
        address predicted = factory.predictAddress(TYPE_MERKLE, alice, userSalt);

        vm.startPrank(alice);
        token.approve(address(factory), FUND);
        vm.expectEmit(true, true, true, false, address(factory));
        emit TokenDisFactory.ProjectCreated(predicted, TYPE_MERKLE, alice, address(token), FUND);
        factory.createProject(TYPE_MERKLE, address(token), FUND, userSalt, initData);
        vm.stopPrank();
    }

    function test_CreateProject_RevertsIfMissingImplementation() public {
        // TYPE_MERKLE not set
        vm.startPrank(alice);
        token.approve(address(factory), FUND);
        vm.expectRevert(abi.encodeWithSelector(TokenDisFactory.MissingImplementation.selector, TYPE_MERKLE));
        factory.createProject(TYPE_MERKLE, address(token), FUND, bytes32(0), _merkleInitData());
        vm.stopPrank();
    }

    function test_CreateProject_RevertsIfZeroToken() public {
        _setupImpls();
        vm.prank(alice);
        vm.expectRevert(TokenDisFactory.ZeroAddress.selector);
        factory.createProject(TYPE_MERKLE, address(0), FUND, bytes32(0), _merkleInitData());
    }

    function test_CreateProject_RevertsIfZeroAmount() public {
        _setupImpls();
        vm.prank(alice);
        vm.expectRevert(TokenDisFactory.ZeroAmount.selector);
        factory.createProject(TYPE_MERKLE, address(token), 0, bytes32(0), _merkleInitData());
    }

    // ─── predictAddress ──────────────────────────────────────────────────────────

    function test_PredictAddress_MatchesActual() public {
        _setupImpls();
        bytes32 userSalt = bytes32("mysalt");
        address predicted = factory.predictAddress(TYPE_MERKLE, alice, userSalt);

        vm.startPrank(alice);
        token.approve(address(factory), FUND);
        address actual = factory.createProject(TYPE_MERKLE, address(token), FUND, userSalt, _merkleInitData());
        vm.stopPrank();

        assertEq(predicted, actual);
    }

    function test_PredictAddress_DifferentSalts() public {
        _setupImpls();
        address p1 = factory.predictAddress(TYPE_MERKLE, alice, bytes32("salt1"));
        address p2 = factory.predictAddress(TYPE_MERKLE, alice, bytes32("salt2"));
        assertTrue(p1 != p2);
    }

    function test_PredictAddress_RevertsIfMissingImpl() public {
        vm.expectRevert(abi.encodeWithSelector(TokenDisFactory.MissingImplementation.selector, 99));
        factory.predictAddress(99, alice, bytes32(0));
    }

    // ─── projectsOf / projectCountOf ─────────────────────────────────────────────

    function test_ProjectCountOf_Multiple() public {
        _setupImpls();
        vm.startPrank(alice);
        token.approve(address(factory), FUND * 3);
        factory.createProject(TYPE_MERKLE, address(token), FUND, bytes32("a"), _merkleInitData());
        factory.createProject(TYPE_MERKLE, address(token), FUND, bytes32("b"), _merkleInitData());
        factory.createProject(TYPE_MERKLE, address(token), FUND, bytes32("c"), _merkleInitData());
        vm.stopPrank();

        assertEq(factory.projectCountOf(alice), 3);
        assertEq(factory.allProjectsCount(), 3);
    }

    function test_ProjectsOf_DifferentCreators() public {
        _setupImpls();
        vm.startPrank(alice);
        token.approve(address(factory), FUND);
        factory.createProject(TYPE_MERKLE, address(token), FUND, bytes32("a1"), _merkleInitData());
        vm.stopPrank();

        vm.startPrank(bob);
        token.approve(address(factory), FUND);
        factory.createProject(TYPE_MERKLE, address(token), FUND, bytes32("b1"), _merkleInitData());
        vm.stopPrank();

        assertEq(factory.projectCountOf(alice), 1);
        assertEq(factory.projectCountOf(bob), 1);
        assertEq(factory.allProjectsCount(), 2);
        assertTrue(factory.projectsOf(alice, 0) != factory.projectsOf(bob, 0));
    }

    function test_ProjectCountOf_ZeroForUnknownCreator() public {
        address nobody = makeAddr("nobody");
        assertEq(factory.projectCountOf(nobody), 0);
    }
}
