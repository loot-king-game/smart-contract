/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/loot_king.json`.
 */
export type LootKing = {
  "address": "6hKr9jCZtjfsjtdKZ7cBvMrQsXaHjewjwsC6uW1JYXwq",
  "metadata": {
    "name": "lootKing",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Loot King – King of the Hill betting game on Solana"
  },
  "instructions": [
    {
      "name": "acceptAuthority",
      "discriminator": [
        107,
        86,
        198,
        91,
        33,
        12,
        107,
        160
      ],
      "accounts": [
        {
          "name": "gameState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "newAuthority",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "claimPrize",
      "discriminator": [
        157,
        233,
        139,
        121,
        246,
        62,
        234,
        235
      ],
      "accounts": [
        {
          "name": "gameState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "winner",
          "writable": true
        },
        {
          "name": "commissionWallet",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "gameState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "commissionWallet",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "placeBet",
      "discriminator": [
        222,
        62,
        67,
        220,
        63,
        166,
        126,
        33
      ],
      "accounts": [
        {
          "name": "gameState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "pendingWinnerAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "commissionWalletAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "isFast",
          "type": "bool"
        }
      ]
    },
    {
      "name": "transferAuthority",
      "discriminator": [
        48,
        169,
        76,
        72,
        229,
        180,
        55,
        161
      ],
      "accounts": [
        {
          "name": "gameState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updateCommission",
      "discriminator": [
        2,
        202,
        72,
        156,
        19,
        253,
        91,
        174
      ],
      "accounts": [
        {
          "name": "gameState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newCommissionBps",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateCommissionWallet",
      "discriminator": [
        33,
        233,
        7,
        76,
        94,
        210,
        20,
        9
      ],
      "accounts": [
        {
          "name": "gameState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newCommissionWallet",
          "type": "pubkey"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "gameState",
      "discriminator": [
        144,
        94,
        208,
        172,
        248,
        99,
        134,
        120
      ]
    }
  ],
  "events": [
    {
      "name": "authorityTransferProposed",
      "discriminator": [
        103,
        244,
        27,
        116,
        177,
        4,
        100,
        119
      ]
    },
    {
      "name": "authorityTransferred",
      "discriminator": [
        245,
        109,
        179,
        54,
        135,
        92,
        22,
        64
      ]
    },
    {
      "name": "betPlaced",
      "discriminator": [
        88,
        88,
        145,
        226,
        126,
        206,
        32,
        0
      ]
    },
    {
      "name": "commissionUpdated",
      "discriminator": [
        107,
        183,
        135,
        132,
        231,
        24,
        226,
        183
      ]
    },
    {
      "name": "commissionWalletUpdated",
      "discriminator": [
        110,
        182,
        197,
        188,
        157,
        223,
        108,
        143
      ]
    },
    {
      "name": "pendingPrizePaid",
      "discriminator": [
        160,
        215,
        21,
        111,
        253,
        179,
        230,
        156
      ]
    },
    {
      "name": "roundEnded",
      "discriminator": [
        70,
        113,
        6,
        162,
        176,
        78,
        201,
        19
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "roundEnded",
      "msg": "Round has already ended, claim the prize first"
    },
    {
      "code": 6001,
      "name": "noActiveRound",
      "msg": "No active round"
    },
    {
      "code": 6002,
      "name": "roundStillActive",
      "msg": "Round is still active, wait for the deadline"
    },
    {
      "code": 6003,
      "name": "leaderCannotBetAgain",
      "msg": "Current leader cannot bet again"
    },
    {
      "code": 6004,
      "name": "fastBetNotAvailableForFirstBet",
      "msg": "Fast bet is not available for the first bet"
    },
    {
      "code": 6005,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6006,
      "name": "invalidWinner",
      "msg": "Invalid winner account"
    },
    {
      "code": 6007,
      "name": "invalidCommissionWallet",
      "msg": "Invalid commission wallet account"
    },
    {
      "code": 6008,
      "name": "missingPendingWinnerAccount",
      "msg": "Missing pending winner account"
    },
    {
      "code": 6009,
      "name": "missingCommissionWalletAccount",
      "msg": "Missing commission wallet account"
    },
    {
      "code": 6010,
      "name": "commissionTooHigh",
      "msg": "Commission exceeds maximum of 10%"
    },
    {
      "code": 6011,
      "name": "unauthorized",
      "msg": "Only the authority can perform this action"
    },
    {
      "code": 6012,
      "name": "invalidCommissionWalletAddress",
      "msg": "Commission wallet cannot be the default (zero) address"
    },
    {
      "code": 6013,
      "name": "noPendingAuthorityTransfer",
      "msg": "No pending authority transfer"
    },
    {
      "code": 6014,
      "name": "invalidPendingAuthority",
      "msg": "Signer does not match pending authority"
    }
  ],
  "types": [
    {
      "name": "authorityTransferProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "currentAuthority",
            "type": "pubkey"
          },
          {
            "name": "pendingAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "authorityTransferred",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldAuthority",
            "type": "pubkey"
          },
          {
            "name": "newAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "betPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "roundNumber",
            "type": "u64"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "betCount",
            "type": "u32"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "bank",
            "type": "u64"
          },
          {
            "name": "isFast",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "betRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "docs": [
              "Bettor wallet address"
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "docs": [
              "Bet amount (in lamports)"
            ],
            "type": "u64"
          },
          {
            "name": "roundNumber",
            "docs": [
              "Round number"
            ],
            "type": "u64"
          },
          {
            "name": "timestamp",
            "docs": [
              "Timestamp when bet was placed"
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "commissionUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldCommissionBps",
            "type": "u64"
          },
          {
            "name": "newCommissionBps",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "commissionWalletUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldWallet",
            "type": "pubkey"
          },
          {
            "name": "newWallet",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "gameState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Program authority (deployer)"
            ],
            "type": "pubkey"
          },
          {
            "name": "pendingAuthority",
            "docs": [
              "Proposed new authority (for two-step transfer)"
            ],
            "type": "pubkey"
          },
          {
            "name": "commissionWallet",
            "docs": [
              "Wallet that receives commission"
            ],
            "type": "pubkey"
          },
          {
            "name": "commissionBps",
            "docs": [
              "Commission in basis points (max 1000 = 10%)"
            ],
            "type": "u64"
          },
          {
            "name": "roundNumber",
            "docs": [
              "Current round number (starts at 1)"
            ],
            "type": "u64"
          },
          {
            "name": "leader",
            "docs": [
              "Current leader's pubkey"
            ],
            "type": "pubkey"
          },
          {
            "name": "bank",
            "docs": [
              "Total bank for current round (in lamports)"
            ],
            "type": "u64"
          },
          {
            "name": "betCount",
            "docs": [
              "Number of bets in current round"
            ],
            "type": "u32"
          },
          {
            "name": "roundCommissionBps",
            "docs": [
              "Commission rate locked at round start (basis points)"
            ],
            "type": "u64"
          },
          {
            "name": "deadline",
            "docs": [
              "Deadline timestamp (unix seconds)"
            ],
            "type": "i64"
          },
          {
            "name": "isActive",
            "docs": [
              "Whether a round is currently active"
            ],
            "type": "bool"
          },
          {
            "name": "pendingWinner",
            "docs": [
              "Winner of the previous unclaimed round"
            ],
            "type": "pubkey"
          },
          {
            "name": "pendingPrize",
            "docs": [
              "Prize amount for the pending winner"
            ],
            "type": "u64"
          },
          {
            "name": "pendingCommission",
            "docs": [
              "Commission amount for the pending round"
            ],
            "type": "u64"
          },
          {
            "name": "hasPendingPrize",
            "docs": [
              "Whether there is an unclaimed prize"
            ],
            "type": "bool"
          },
          {
            "name": "winners",
            "docs": [
              "Last N winners (circular buffer)"
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "winnerRecord"
                  }
                },
                10
              ]
            }
          },
          {
            "name": "winnersCount",
            "docs": [
              "How many winner records have been filled (max 10)"
            ],
            "type": "u8"
          },
          {
            "name": "topWinners",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "winnerRecord"
                  }
                },
                10
              ]
            }
          },
          {
            "name": "topWinnersCount",
            "type": "u8"
          },
          {
            "name": "recentBets",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "betRecord"
                  }
                },
                10
              ]
            }
          },
          {
            "name": "recentBetsCount",
            "type": "u8"
          },
          {
            "name": "pendingRoundNumber",
            "docs": [
              "Round number for the pending prize (for correct event emission)"
            ],
            "type": "u64"
          },
          {
            "name": "pendingBetCount",
            "docs": [
              "Number of bets in the pending round (for correct prize calculation context)"
            ],
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "pendingPrizePaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "roundNumber",
            "type": "u64"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "prize",
            "type": "u64"
          },
          {
            "name": "commission",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "roundEnded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "roundNumber",
            "type": "u64"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "prize",
            "type": "u64"
          },
          {
            "name": "commission",
            "type": "u64"
          },
          {
            "name": "betCount",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "winnerRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "docs": [
              "Winner wallet address"
            ],
            "type": "pubkey"
          },
          {
            "name": "prize",
            "docs": [
              "Prize amount (in lamports)"
            ],
            "type": "u64"
          },
          {
            "name": "roundNumber",
            "docs": [
              "Round number"
            ],
            "type": "u64"
          },
          {
            "name": "timestamp",
            "docs": [
              "Timestamp when round ended"
            ],
            "type": "i64"
          }
        ]
      }
    }
  ]
};
