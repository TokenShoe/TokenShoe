// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestToken, TestTokenFactory} from "../TestTokenFactory.sol";

contract TestTokenFactoryTest is Test {
    TestTokenFactory internal factory;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply);

    function setUp() public {
        factory = new TestTokenFactory();
    }

    function test_CreateToken_MintsFullSupplyToCaller() public {
        vm.prank(alice);
        address token = factory.createToken("Alice Token", "ALC");

        TestToken t = TestToken(token);
        assertEq(t.name(), "Alice Token");
        assertEq(t.symbol(), "ALC");
        assertEq(t.decimals(), 18);
        assertEq(t.totalSupply(), 100_000_000e18);
        assertEq(t.balanceOf(alice), 100_000_000e18);
        assertEq(t.balanceOf(address(factory)), 0);
    }

    function test_CreateToken_EmitsEvent() public {
        vm.expectEmit(false, true, false, true, address(factory));
        emit TokenCreated(address(0), alice, "Alice Token", "ALC", 100_000_000e18);
        vm.prank(alice);
        factory.createToken("Alice Token", "ALC");
    }

    function test_TokensOf_TracksPerCreator() public {
        vm.startPrank(alice);
        address a1 = factory.createToken("A1", "A1");
        address a2 = factory.createToken("A2", "A2");
        vm.stopPrank();
        vm.prank(bob);
        address b1 = factory.createToken("B1", "B1");

        address[] memory aliceTokens = factory.tokensOf(alice);
        assertEq(aliceTokens.length, 2);
        assertEq(aliceTokens[0], a1);
        assertEq(aliceTokens[1], a2);
        assertEq(factory.tokenCountOf(bob), 1);
        assertEq(factory.tokensOf(bob)[0], b1);
        assertEq(factory.allTokensCount(), 3);
        assertEq(factory.allTokens(2), b1);
    }

    function test_CreateToken_SameNameTwice_DifferentAddresses() public {
        vm.startPrank(alice);
        address a1 = factory.createToken("Same", "SAME");
        address a2 = factory.createToken("Same", "SAME");
        vm.stopPrank();
        assertTrue(a1 != a2);
    }

    function test_RevertWhen_NameEmpty() public {
        vm.expectRevert(TestTokenFactory.InvalidName.selector);
        factory.createToken("", "SYM");
    }

    function test_RevertWhen_NameTooLong() public {
        vm.expectRevert(TestTokenFactory.InvalidName.selector);
        factory.createToken("123456789012345678901234567890123456789012345678901", "SYM");
    }

    function test_RevertWhen_SymbolEmpty() public {
        vm.expectRevert(TestTokenFactory.InvalidSymbol.selector);
        factory.createToken("Name", "");
    }

    function test_RevertWhen_SymbolTooLong() public {
        vm.expectRevert(TestTokenFactory.InvalidSymbol.selector);
        factory.createToken("Name", "ABCDEFGHIJKL");
    }

    function test_Token_IsTransferable() public {
        vm.prank(alice);
        TestToken t = TestToken(factory.createToken("T", "T"));
        vm.prank(alice);
        assertTrue(t.transfer(bob, 1e18));
        assertEq(t.balanceOf(bob), 1e18);
    }
}
