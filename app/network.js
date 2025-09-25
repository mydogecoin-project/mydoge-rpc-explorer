const MyDogecoin = {
    networkId: "main",
    coinbaseMaturity: 30,
    powTargetSpacing: 60, // 1 minute
    powTargetTimespan: 4 * 60 * 60, // 4 hours
    difficultyAdjustmentBlockCount: 240,   // <-- add this line
    allowMinDifficultyBlocks: false,
    digishieldDifficulty: false,
    auxPow: true,
    nSubsidyHalvingInterval: 1000000000,
    bip34Height: 3,
    bip65Height: 3,
    bip66Height: 3,
    powLimit: "00000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    messageStart: [0xc7, 0xc7, 0xc7, 0xc7],
    defaultPort: 22777,
    seeds: [
        "seed01.mydogecoin.fun",
        "seed02.mydogecoin.fun",
        "seed03.mydogecoin.fun",
        "seed04.mydogecoin.fun",
        "seed05.mydogecoin.fun"
    ],
    base58Prefixes: {
        PUBKEY_ADDRESS: [51],  // M
        SCRIPT_ADDRESS: [30],  // 2
        SECRET_KEY: [158]
    },
    genesisHash: "d63fc9f6b1ac2a9c28d7874d8f279188de6970e01dcbed850570d5c09c2c07bf",
    merkleRoot: "fa4401e58664e8d90b00c9e6dc96c23c2f1377d0196de5a8669294066232d8e1"
};

module.exports = MyDogecoin;
