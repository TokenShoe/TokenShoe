// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TokenMerkleDis} from "../TokenMerkleDis.sol";
import {TokenSignDis} from "../TokenSignDis.sol";
import {TokenVesting} from "../TokenVesting.sol";
import {TokenDisFactory} from "../TokenDisFactory.sol";

contract Deploy is Script {
    function run() external {
        // vm.envAddress reads DEPLOYER_ADDRESS from your shell env (optional, just for logging)
        address deployer = vm.envOr("DEPLOYER_ADDRESS", msg.sender);

        vm.startBroadcast();

        // 1. Deploy implementation contracts
        TokenMerkleDis merkleImpl = new TokenMerkleDis();
        console.log("TokenMerkleDis impl:", address(merkleImpl));

        TokenSignDis signImpl = new TokenSignDis();
        console.log("TokenSignDis   impl:", address(signImpl));

        TokenVesting vestingImpl = new TokenVesting();
        console.log("TokenVesting   impl:", address(vestingImpl));

        // 2. Deploy factory with deployer as owner
        TokenDisFactory factory = new TokenDisFactory(deployer);
        console.log("TokenDisFactory    :", address(factory));

        // 3. Register implementations (type 0 = Merkle, 1 = Sign, 2 = Vesting)
        factory.setImplementation(0, address(merkleImpl));
        factory.setImplementation(1, address(signImpl));
        factory.setImplementation(2, address(vestingImpl));
        console.log("Implementations registered.");

        vm.stopBroadcast();

        // Print env block for easy copy-paste into .env
        console.log("\n--- copy into your .env ---");
        console.log("VITE_FACTORY=", address(factory));
        console.log("VITE_MERKLE_IMPL=", address(merkleImpl));
        console.log("VITE_SIGN_IMPL=", address(signImpl));
        console.log("VITE_VESTING_IMPL=", address(vestingImpl));
        console.log("---------------------------");
    }
}
