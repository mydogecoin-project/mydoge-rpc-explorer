"use strict";

const mydoge = require("./coins/mydoge.js");
const Decimal = require("decimal.js");

module.exports = {
    "MYDOGE": mydoge,

    "coins": ["MYDOGE"],

    getTotalTxVolume: function(txs) {
        let totalVolume = new Decimal(0);
        for (const tx of txs) {
            for (const vout of tx.vout) {
                totalVolume = totalVolume.plus(new Decimal(vout.value));
            }
        }
        return totalVolume;
    },

    getBlockVolume: function(block) {
        const txVolume = this.getTotalTxVolume(block.tx || []);
        const fees = block.coinbaseTx?.fee || 0; 
        return txVolume.minus(new Decimal(fees));
    }
};
