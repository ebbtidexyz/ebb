// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Mirrors PonsV2FeeEscrow: per-recipient ETH + token ledgers, claimable only by the recipient (msg.sender).
contract MockPonsEscrow {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public balanceOfToken;

    error NoBalance();

    function credit(address r) external payable {
        balanceOf[r] += msg.value;
    }

    function creditToken(address r, address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        balanceOfToken[r][token] += amount;
    }

    function claim() external returns (uint256 a) {
        a = balanceOf[msg.sender];
        if (a == 0) revert NoBalance();
        balanceOf[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: a}("");
        require(ok, "eth");
    }

    function claimToken(address token) external returns (uint256 a) {
        a = balanceOfToken[msg.sender][token];
        if (a == 0) revert NoBalance();
        balanceOfToken[msg.sender][token] = 0;
        IERC20(token).transfer(msg.sender, a);
    }
}

/// @dev Curve stand-in: `sweepFees` credits its pending creator fees (ETH or token) to `creator` in the escrow,
///      callable only by `creator` (like PonsV2BondingCurve with buyback off). Can be set to revert.
contract MockPonsCurve {
    MockPonsEscrow public immutable escrow;
    address public immutable creator;
    address public immutable quoteToken; // 0 = ETH
    bool public graduated;
    uint256 public sweeps;

    error NotFeeSweepOperator();
    error AlreadyGraduated();

    constructor(MockPonsEscrow e, address creator_, address quoteToken_) {
        escrow = e;
        creator = creator_;
        quoteToken = quoteToken_;
    }

    receive() external payable {}

    function setGraduated(bool g) external {
        graduated = g;
    }

    function sweepFees(uint256) external {
        if (graduated) revert AlreadyGraduated();
        if (msg.sender != creator) revert NotFeeSweepOperator();
        sweeps++;
        if (quoteToken == address(0)) {
            if (address(this).balance != 0) escrow.credit{value: address(this).balance}(creator);
        } else {
            uint256 b = IERC20(quoteToken).balanceOf(address(this));
            if (b != 0) {
                IERC20(quoteToken).approve(address(escrow), b);
                escrow.creditToken(creator, quoteToken, b);
            }
        }
    }
}

/// @dev Hook stand-in: `sweepPoolFees` reverts unless `allowCreatorSweep` (models InternalSwapRequiresOperator).
contract MockPonsHook {
    bool public allowCreatorSweep;
    uint256 public sweeps;
    bytes32 public lastPoolId;

    error InternalSwapRequiresOperator();

    function setAllowCreatorSweep(bool v) external {
        allowCreatorSweep = v;
    }

    function sweepPoolFees(bytes32 poolId, uint256, uint256) external {
        if (!allowCreatorSweep) revert InternalSwapRequiresOperator();
        sweeps++;
        lastPoolId = poolId;
    }
}
