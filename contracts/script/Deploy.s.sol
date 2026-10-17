// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TokenMerkleDis} from "../TokenMerkleDis.sol";
import {TokenSignDis} from "../TokenSignDis.sol";
import {TokenVesting} from "../TokenVesting.sol";
import {TokenShoeFactory} from "../TokenShoeFactory.sol";
import {TestTokenFactory} from "../TestTokenFactory.sol";

/// @title TokenDis one-shot deployment script
/// @notice Deploys the 3 implementation contracts + the factory and registers the implementations (type 0 Merkle / 1 Sign / 2 Vesting).
///         Also deploys TestTokenFactory (lets website users mint a test ERC-20) unless disabled.
///
/// Environment variables (in the project-root .env, which forge loads automatically):
///   PRIVATE_KEY     required, deployer wallet private key (needs gas; gas on Arc is USDC)
///   FACTORY_OWNER   optional, final factory owner (e.g. a multisig). Empty = the deployer wallet itself.
///                   If set: the deployer registers the implementations first, then starts a two-step transfer; the new owner must call acceptOwnership().
///   DEPLOY_TEST_TOKEN_FACTORY  optional, default true. Set to false to skip TestTokenFactory (e.g. on mainnet).
///
/// Usage: ./deploy.sh (recommended, with checks) or
///   forge script contracts/script/Deploy.s.sol --rpc-url arc_testnet --broadcast
contract Deploy is Script {
    uint8 internal constant TYPE_MERKLE = 0;
    uint8 internal constant TYPE_SIGN = 1;
    uint8 internal constant TYPE_VESTING = 2;

    struct Deployed {
        address factory;
        address merkleImpl;
        address signImpl;
        address vestingImpl;
        address testTokenFactory; // address(0) when skipped
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address finalOwner = vm.envOr("FACTORY_OWNER", deployer);

        console.log("Chain id      :", block.chainid);
        console.log("Deployer      :", deployer);
        console.log("Final owner   :", finalOwner);
        console.log("Balance (wei) :", deployer.balance);

        vm.startBroadcast(pk);

        // 1. Implementation contracts (the constructor calls _disableInitializers, so they can't be initialized themselves)
        TokenMerkleDis merkleImpl = new TokenMerkleDis();
        TokenSignDis signImpl = new TokenSignDis();
        TokenVesting vestingImpl = new TokenVesting();

        // 2. Factory: the deployer must be the owner first in order to register
        TokenShoeFactory factory = new TokenShoeFactory(deployer);

        // 3. Register the implementations
        factory.setImplementation(TYPE_MERKLE, address(merkleImpl));
        factory.setImplementation(TYPE_SIGN, address(signImpl));
        factory.setImplementation(TYPE_VESTING, address(vestingImpl));

        // 4. Optional: hand the factory to the final owner (Ownable2Step: takes effect only after acceptOwnership)
        if (finalOwner != deployer) {
            factory.transferOwnership(finalOwner);
        }

        // 5. Optional: test token factory for the website's "mint a test token" feature
        bool withTestTokens = vm.envOr("DEPLOY_TEST_TOKEN_FACTORY", true);
        address testTokenFactory = withTestTokens
            ? address(new TestTokenFactory())
            : address(0);

        vm.stopBroadcast();

        // 6. Self-check: registration must be correct, otherwise the whole script fails
        require(
            factory.implementations(TYPE_MERKLE) == address(merkleImpl),
            "merkle impl not registered"
        );
        require(
            factory.implementations(TYPE_SIGN) == address(signImpl),
            "sign impl not registered"
        );
        require(
            factory.implementations(TYPE_VESTING) == address(vestingImpl),
            "vesting impl not registered"
        );
        require(factory.owner() == deployer, "unexpected factory owner");
        if (finalOwner != deployer) {
            require(
                factory.pendingOwner() == finalOwner,
                "ownership transfer not started"
            );
        }

        console.log("");
        console.log("TokenShoeFactory     :", address(factory));
        console.log("TokenMerkleDis impl :", address(merkleImpl));
        console.log("TokenSignDis impl   :", address(signImpl));
        console.log("TokenVesting impl   :", address(vestingImpl));
        console.log("Implementations registered and verified.");
        if (testTokenFactory != address(0))
            console.log("TestTokenFactory    :", testTokenFactory);
        if (finalOwner != deployer) {
            console.log(
                "NEXT STEP: FACTORY_OWNER must call acceptOwnership() on the factory."
            );
        }

        // Don't write the file on a dry run (DEPLOY_DRY_RUN=1), so no addresses that never went on-chain are left behind
        if (!vm.envOr("DEPLOY_DRY_RUN", false)) {
            Deployed memory d = Deployed({
                factory: address(factory),
                merkleImpl: address(merkleImpl),
                signImpl: address(signImpl),
                vestingImpl: address(vestingImpl),
                testTokenFactory: testTokenFactory
            });
            _writeDeployment(d, deployer, finalOwner);
        }
    }

    /// @dev Write deployments/<chainId>.json; deploy.sh uses it to update web/.env.local
    function _writeDeployment(
        Deployed memory d,
        address deployer,
        address finalOwner
    ) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "deployer", deployer);
        vm.serializeAddress(k, "owner", finalOwner);
        vm.serializeAddress(k, "factory", d.factory);
        vm.serializeAddress(k, "merkleImpl", d.merkleImpl);
        vm.serializeAddress(k, "signImpl", d.signImpl);
        vm.serializeAddress(k, "vestingImpl", d.vestingImpl);
        string memory json = vm.serializeAddress(
            k,
            "testTokenFactory",
            d.testTokenFactory
        );

        string memory path = string.concat(
            vm.projectRoot(),
            "/deployments/",
            vm.toString(block.chainid),
            ".json"
        );
        vm.writeJson(json, path);
        console.log("Saved:", path);
    }
}
