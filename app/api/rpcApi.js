"use strict";

const debug = require('debug');
const debugLog = debug("btcexp:rpc");

const async = require("async");
const semver = require("semver");

const utils = require("../utils.js");
const config = require("../config.js");
const coins = require("../coins.js");
const statTracker = require("../statTracker.js");

let activeQueueTasks = 0;

const rpcQueue = async.queue(function(task, callback) {
	activeQueueTasks++;
	//debugLog("activeQueueTasks: " + activeQueueTasks);

	task.rpcCall(function() {
		callback();

		activeQueueTasks--;
		//debugLog("activeQueueTasks: " + activeQueueTasks);
	});

}, config.rpcConcurrency);

const minRpcVersions = {
	getblockstats: "0.17.0",
	getindexinfo: "0.21.0",
	getdeploymentinfo: "23.0.0"
};

global.rpcStats = {};



function getBlockchainInfo() {
	return new Promise((resolve, reject) => {
		getRpcData("getblockchaininfo").then((getblockchaininfo) => {
			// keep global.pruneHeight updated
			if (getblockchaininfo.pruned) {
				global.pruneHeight = getblockchaininfo.pruneheight;
			}

			resolve(getblockchaininfo);
			
		}).catch(reject);
	});
	
}

function getBlockCount() {
	return getRpcData("getblockcount");
}

function getNetworkInfo() {
	return getRpcData("getnetworkinfo");
}

function getNetTotals() {
	return getRpcData("getnettotals");
}

function getMempoolInfo() {
	return getRpcData("getmempoolinfo");
}

function getMiningInfo() {
	return getRpcData("getmininginfo");
}

function getIndexInfo() {
	// Respect coin config: if coin explicitly disables getIndexInfo, treat as unsupported
	if (coinConfig.features && coinConfig.features.getIndexInfo === false) {
		return unsupportedPromise(minRpcVersions.getindexinfo);
	}

	if (semver.gte(global.btcNodeSemver, minRpcVersions.getindexinfo)) {
		return getRpcData("getindexinfo");
	} else {
		// unsupported by node version
		return unsupportedPromise(minRpcVersions.getindexinfo);
	}
}


function getDeploymentInfo() {
	if (semver.gte(global.btcNodeSemver, minRpcVersions.getdeploymentinfo)) {
		return getRpcData("getdeploymentinfo");

	} else {
		// unsupported
		return unsupportedPromise(minRpcVersions.getdeploymentinfo);
	}
}

function getUptimeSeconds() {
	return getRpcData("uptime");
}

function getPeerInfo() {
	return getRpcData("getpeerinfo");
}

function getBlockTemplate() {
	return getRpcDataWithParams({method:"getblocktemplate", parameters:[{"rules": ["segwit"]}]});
}

function getAllMempoolTxids() {
	return getRpcDataWithParams({method:"getrawmempool", parameters:[false]});
}

function getSmartFeeEstimate(confTargetBlockCount) {
	// Dogecoin Core expects numeric confirmation target, not "ECONOMICAL"/"CONSERVATIVE"
	if (typeof confTargetBlockCount !== "number") {
		confTargetBlockCount = 6; // default 6-block target
	}
	return getRpcDataWithParams({
		method: "estimatesmartfee",
		parameters: [confTargetBlockCount],
	});
}

function getNetworkHashrate(blockCount=144) {
	return getRpcDataWithParams({method:"getnetworkhashps", parameters:[blockCount]});
}

function getBlockStats(hash) {
	// Respect coin config: if coin explicitly disables getBlockStats, treat as unsupported
	if (coinConfig.features && coinConfig.features.getBlockStats === false) {
		return unsupportedPromise(minRpcVersions.getblockstats);
	}

	if (semver.gte(global.btcNodeSemver, minRpcVersions.getblockstats)) {
		if (hash == coinConfig.genesisBlockHashesByNetwork[global.activeBlockchain] && coinConfig.genesisBlockStatsByNetwork[global.activeBlockchain]) {
			return new Promise(function(resolve, reject) {
				resolve(coinConfig.genesisBlockStatsByNetwork[global.activeBlockchain]);
			});
		} else {
			return getRpcDataWithParams({method:"getblockstats", parameters:[hash]});
		}
	} else {
		// unsupported
		return unsupportedPromise(minRpcVersions.getblockstats);
	}
}


async function getBlockStatsByHeight(height) {
    if (coinConfig.features && coinConfig.features.getBlockStats === false) {
        return unsupportedPromise(minRpcVersions.getblockstats);
    }

    if (!semver.gte(global.btcNodeSemver, minRpcVersions.getblockstats)) {
        return unsupportedPromise(minRpcVersions.getblockstats);
    }

    // Genesis block fallback
    if (height === 0 && coinConfig.genesisBlockStatsByNetwork[global.activeBlockchain]) {
        return coinConfig.genesisBlockStatsByNetwork[global.activeBlockchain];
    }

    try {
        let stats = await getRpcDataWithParams({ method: "getblockstats", parameters: [height] });

        // Ensure numeric fields
        stats.total_out = stats.total_out || 0;
        stats.subsidy = stats.subsidy || 0;
        stats.totalfee = stats.totalfee || 0;

        // Compute Volume (total_out + subsidy + totalfee)
        stats.volume = stats.total_out + stats.subsidy + stats.totalfee;

        // Provide fee rates (optional)
        stats.minFeeRate = stats.minfeerate || 0;
        stats.avgFeeRate = stats.avgfeerate || 0;
        stats.maxFeeRate = stats.maxfeerate || 0;

        return stats;

    } catch (err) {
        debugLog("getBlockStatsByHeight failed for height " + height, err);
        return {
            total_out: 0,
            subsidy: 0,
            totalfee: 0,
            volume: 0,
            minFeeRate: 0,
            avgFeeRate: 0,
            maxFeeRate: 0
        };
    }
}


function getUtxoSetSummary(useCoinStatsIndexIfAvailable=true) {
	if (useCoinStatsIndexIfAvailable && global.getindexinfo && global.getindexinfo.coinstatsindex) {
		return getRpcDataWithParams({method:"gettxoutsetinfo", parameters:["muhash"]});

	} else {
		return getRpcData("gettxoutsetinfo");
	}
}

function getRawMempool() {
	return new Promise(function(resolve, reject) {
		getRpcDataWithParams({method:"getrawmempool", parameters:[false]}).then(function(txids) {
			let promises = [];

			for (let i = 0; i < txids.length; i++) {
				let txid = txids[i];

				promises.push(getRawMempoolEntry(txid));
			}

			Promise.all(promises).then(function(results) {
				let finalResult = {};

				for (let i = 0; i < results.length; i++) {
					if (results[i] != null) {
						finalResult[results[i].txid] = results[i];
					}
				}

				resolve(finalResult);

			}).catch(function(err) {
				reject(err);
			});

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getRawMempoolEntry(txid) {
    return new Promise(async function(resolve) {
        if (!txid || !isValidTxid(txid)) {
            return resolve(null); // invalid txid, skip gracefully
        }

        try {
            const result = await getRpcDataWithParams({ method: "getmempoolentry", parameters: [txid] });

            if (!result || result.code < 0) {
                return resolve(null); // skip failed entry
            }

            result.txid = txid;
            resolve(result);

        } catch (err) {
            // Graceful fallback: return null instead of throwing
            resolve(null);
        }
    });
}


function getChainTxStats(blockCount, blockhashEnd=null) {
	let params = [blockCount];
	if (blockhashEnd) {
		params.push(blockhashEnd);
	}

	return getRpcDataWithParams({method:"getchaintxstats", parameters:params});
}

function getBlockByHeight(blockHeight) {
    return new Promise(async function(resolve, reject) {
        if (typeof blockHeight !== "number" || blockHeight < 0) {
            return reject(new Error(`Invalid blockHeight: ${blockHeight}`));
        }

        try {
            const blockhash = await getRpcDataWithParams({ method: "getblockhash", parameters: [blockHeight] });
            
            if (!blockhash || typeof blockhash !== "string") {
                return reject(new Error(`Failed to fetch blockhash for height: ${blockHeight}`));
            }

            const block = await getBlockByHash(blockhash);
            resolve(block);

        } catch (err) {
            reject(err);
        }
    });
}


function getBlockHeaderByHash(blockhash) {
	return getRpcDataWithParams({method:"getblockheader", parameters:[blockhash]});
}

function getBlockHeaderByHeight(blockHeight) {
	return new Promise(function(resolve, reject) {
		getRpcDataWithParams({method:"getblockhash", parameters:[blockHeight]}).then(function(blockhash) {
			getBlockHeaderByHash(blockhash).then(function(blockHeader) {
				resolve(blockHeader);

			}).catch(function(err) {
				reject(err);
			});
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getBlockHashByHeight(blockHeight) {
	return getRpcDataWithParams({method:"getblockhash", parameters:[blockHeight]});
}

async function getRawTransaction(txid, blockhash) {
    if (!txid || typeof txid !== "string") {
        throw new Error(`Invalid txid: ${txid}`);
    }

    // Handle genesis coinbase transaction
    if (coins[config.coin].genesisCoinbaseTransactionIdsByNetwork[global.activeBlockchain] &&
        txid === coins[config.coin].genesisCoinbaseTransactionIdsByNetwork[global.activeBlockchain]) {

        try {
            const blockchainInfo = await getBlockchainInfo();
            let result = coins[config.coin].genesisCoinbaseTransactionsByNetwork[global.activeBlockchain];
            result.confirmations = blockchainInfo.blocks;

            if (global.activeBlockchain === "regtest" && result.confirmations === 0) {
                result.confirmations = 1;
            }

            return result;

        } catch (err) {
            throw err;
        }
    }

    // Normal RPC lookup with safe fallback
    try {
        const result = await getRpcDataWithParams({ method: "getrawtransaction", parameters: [txid, true] });
        return result || null; // return null if tx not found
    } catch (err) {
        // If txindex not available, attempt wallet/recent block search
        if (!global.txindexAvailable) {
            try {
                const fallbackTx = await noTxIndexTransactionLookup(txid, !!blockhash);
                return fallbackTx || null; // return null if not found
            } catch (_) {
                return null; // fail silently for missing tx
            }
        }
        // If txindex is enabled but tx is missing, just return null
        return null;
    }
}

async function getBlockByHash(blockHash) {
    if (!blockHash || typeof blockHash !== "string" || blockHash.length !== 64) {
        throw new Error(`Invalid block hash: ${blockHash}`);
    }

    let block;
    try {
        block = await getRpcDataWithParams({ method: "getblock", parameters: [blockHash, true] });
    } catch (err) {
        if (err.error && err.error.code === -5) {
            // Block not found
            return null; 
        }
        throw err;
    }

    // Fetch full transaction objects
    if (block.tx && block.tx.length > 0) {
        const txPromises = block.tx.map(txid => getRawTransaction(txid, blockHash));
        block.transactions = (await Promise.all(txPromises)).filter(tx => tx != null); // remove nulls
    } else {
        block.transactions = [];
    }

    // Track missing transactions
    block.missingTxs = block.tx.length - block.transactions.length;

    // Original processing
    block.coinbaseTx = block.transactions[0] || null;
    block.totalFees = utils.getBlockTotalFeesFromCoinbaseTxAndBlockHeight(block.coinbaseTx, block.height);
    block.miner = utils.identifyMiner(block.coinbaseTx, block.height);
    block.subsidy = coinConfig.blockRewardFunction(block.height, global.activeBlockchain);

    // Compute stats safely
    let totalOut = 0, totalIn = 0;
    block.transactions.forEach(tx => {
        if (!tx) return; // skip null transactions
        totalIn += tx.vin?.length || 0;
        totalOut += tx.vout?.reduce((sum, v) => sum + (v.value || 0), 0);
    });

    block.blockstats = block.blockstats || {};
    block.blockstats.ins = totalIn;
    block.blockstats.outs = totalOut;

    block.volume = totalOut + (block.totalFees || 0) + (block.subsidy || 0);

    block.minFeeRate = block.blockstats.minfeerate || 0;
    block.avgFeeRate = block.blockstats.avgfeerate || 0;
    block.maxFeeRate = block.blockstats.maxfeerate || 0;

    // Ensure nTx is available
    if (Array.isArray(block.transactions)) {
        block.nTx = block.transactions.length || 1;
    } else if (Array.isArray(block.tx)) {
        block.nTx = block.tx.length || 1;
    } else {
        block.nTx = 1;
    }

    return block;
}



function getAddress(address) {
	return getRpcDataWithParams({method:"validateaddress", parameters:[address]});
}

function getAddressBalance(address) {
  return getRpcDataWithParams({
    method: "getaddressbalance",
    parameters: [address]
  });
}

async function noTxIndexTransactionLookup(txid, walletOnly) {
	// Try looking up with an external Electrum server, using 'get_confirmed_blockhash'.
	// This is only available in Electrs and requires enabling BTCEXP_ELECTRUM_TXINDEX.
	if (!walletOnly && (config.addressApi == "electrum" || config.addressApi == "electrumx") && config.electrumTxIndex) {
		try {
			let blockhash = await electrumAddressApi.lookupTxBlockHash(txid);

			return await getRawTransaction(txid, blockhash);

		} catch (err) {
			debugLog(`Electrs blockhash lookup failed for ${txid}:`, err);
		}
	}

	// Try looking up in wallet transactions
	for (let wallet of await listWallets()) {
		try { return await getWalletTransaction(wallet, txid); }
		catch (_) {}
	}

	// Try looking up in recent blocks
	if (!walletOnly) {
		let tip_height = await getRpcDataWithParams({method:"getblockcount", parameters:[]});
		for (let height=tip_height; height>Math.max(tip_height - config.noTxIndexSearchDepth, 0); height--) {
			let blockhash = await getRpcDataWithParams({method:"getblockhash", parameters:[height]});
			try { return await getRawTransaction(txid, blockhash); }
			catch (_) {}
		}
	}

	throw new Error(`The requested tx ${txid} cannot be found in wallet transactions, mempool transactions, or recently confirmed transactions`)
}

function listWallets() {
	if (coinConfig && coinConfig.name === "mydogecoin") {
		// Dogecoin Core has no listwallets RPC, so just return an empty array
		return Promise.resolve([]);
	}

	return getRpcDataWithParams({method:"listwallets", parameters:[]});
}


async function getWalletTransaction(wallet, txid) {
	global.rpcClient.wallet = wallet;
	try {
		return await getRpcDataWithParams({method:"gettransaction", parameters:[ txid, true, true ]})
			.then(wtx => ({ ...wtx, ...wtx.decoded, decoded: null }))
	} finally {
		global.rpcClient.wallet = null;
	}
}

function getUtxo(txid, outputIndex) {
	return new Promise(function(resolve, reject) {
		getRpcDataWithParams({method:"gettxout", parameters:[txid, outputIndex]}).then(function(result) {
			if (result == null) {
				resolve("0");

				return;
			}

			if (result.code && result.code < 0) {
				reject(result);

				return;
			}

			resolve(result);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getMempoolTxDetails(txid, includeAncDec=true) {
	let promises = [];

	let mempoolDetails = {};

	promises.push(new Promise(function(resolve, reject) {
		getRpcDataWithParams({method:"getmempoolentry", parameters:[txid]}).then(function(result) {
			mempoolDetails.entry = result;

			resolve();

		}).catch(function(err) {
			reject(err);
		});
	}));

	if (includeAncDec) {
		promises.push(new Promise(function(resolve, reject) {
			getRpcDataWithParams({method:"getmempoolancestors", parameters:[txid]}).then(function(result) {
				mempoolDetails.ancestors = result;

				resolve();

			}).catch(function(err) {
				reject(err);
			});
		}));

		promises.push(new Promise(function(resolve, reject) {
			getRpcDataWithParams({method:"getmempooldescendants", parameters:[txid]}).then(function(result) {
				mempoolDetails.descendants = result;

				resolve();

			}).catch(function(err) {
				reject(err);
			});
		}));
	}

	return new Promise(function(resolve, reject) {
		Promise.all(promises).then(function() {
			resolve(mempoolDetails);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getTxOut(txid, vout) {
	return getRpcDataWithParams({method:"gettxout", parameters:[txid, vout]});
}

function getHelp() {
	return getRpcData("help");
}

function getRpcMethodHelp(methodName) {
	return getRpcDataWithParams({method:"help", parameters:[methodName]});
}



function getRpcData(cmd, verifyingConnection=false) {
	let startTime = new Date().getTime();

	if (!verifyingConnection && !global.rpcConnected) {
		return Promise.reject(new Error("No RPC connection available. Check your connection/authentication parameters."));
	}

	return new Promise(function(resolve, reject) {
		debugLog(`RPC: ${cmd}`);

		let rpcCall = async function(callback) {
			let client = (cmd == "gettxoutsetinfo" ? global.rpcClientNoTimeout : global.rpcClient);

			try {
				const rpcResult = await client.request(cmd, []);
				const result = rpcResult.result;

				//console.log(`RPC: request=${cmd}, result=${JSON.stringify(result)}`);

				if (Array.isArray(result) && result.length == 1) {
					let result0 = result[0];
					
					if (result0 && result0.name && result0.name == "RpcError") {
						logStats(cmd, false, new Date().getTime() - startTime, false);

						debugLog("RpcErrorResult-01: " + JSON.stringify(result0));

						throw new Error(`RpcError: type=errorResponse-01`);
					}
				}

				if (result && result.name && result.name == "RpcError") {
					logStats(cmd, false, new Date().getTime() - startTime, false);

					debugLog("RpcErrorResult-02: " + JSON.stringify(result));

					throw new Error(`RpcError: type=errorResponse-02`);
				}

				resolve(result);

				logStats(cmd, false, new Date().getTime() - startTime, true);

				callback();

			} catch (err) {
				err.userData = {request:cmd};

				utils.logError("RpcError-001", err, {request:cmd});

				logStats(cmd, false, new Date().getTime() - startTime, false);

				reject(err);

				callback();
			}
		};
		
		rpcQueue.push({rpcCall:rpcCall});
	});
}

function getRpcDataWithParams(request, verifyingConnection=false) {
	let startTime = new Date().getTime();

	if (!verifyingConnection && !global.rpcConnected) {
		return Promise.reject(new Error("No RPC connection available. Check your connection/authentication parameters."));
	}

	return new Promise(function(resolve, reject) {
		debugLog(`RPC: ${JSON.stringify(request)}`);

		let rpcCall = async function(callback) {
			let client = (request.method == "gettxoutsetinfo" ? global.rpcClientNoTimeout : global.rpcClient);
			
			try {
				const rpcResult = await client.request(request.method, request.parameters);
				const result = rpcResult.result;

				//console.log(`RPC: request=${request}, result=${JSON.stringify(result)}`);

				if (Array.isArray(result) && result.length == 1) {
					let result0 = result[0];

					if (result0 && result0.name && result0.name == "RpcError") {
						logStats(request.method, true, new Date().getTime() - startTime, false);

						debugLog("RpcErrorResult-03: request=" + JSON.stringify(request) + ", result=" + JSON.stringify(result0));

						throw new Error(`RpcError: type=errorResponse-03`);
					}
				}

				if (result && result.name && result.name == "RpcError") {
					logStats(request.method, true, new Date().getTime() - startTime, false);

					debugLog("RpcErrorResult-04: " + JSON.stringify(result));

					throw new Error(`RpcError: type=errorResponse-04`);
				}

				resolve(result);

				logStats(request.method, true, new Date().getTime() - startTime, true);

				callback();

			} catch (err) {
				err.userData = {request:request};

				utils.logError("RpcError-002", err, {request:`${request.method}${request.parameters ? ("(" + JSON.stringify(request.parameters) + ")") : ""}`});

				logStats(request.method, true, new Date().getTime() - startTime, false);

				reject(err);

				callback();
			}
		};
		
		rpcQueue.push({rpcCall:rpcCall});
	});
}

function unsupportedPromise(minRpcVersionNeeded) {
	return new Promise(function(resolve, reject) {
		resolve({success:false, error:"Unsupported", minRpcVersionNeeded:minRpcVersionNeeded});
	});
}

function logStats(cmd, hasParams, dt, success) {
	if (!global.rpcStats[cmd]) {
		global.rpcStats[cmd] = {count:0, withParams:0, time:0, successes:0, failures:0};
	}

	global.rpcStats[cmd].count++;
	global.rpcStats[cmd].time += dt;

	statTracker.trackPerformance(`rpc.${cmd}`, dt);
	statTracker.trackPerformance(`rpc.*`, dt);

	if (hasParams) {
		global.rpcStats[cmd].withParams++;
	}

	if (success) {
		global.rpcStats[cmd].successes++;
		statTracker.trackEvent(`rpc-result.${cmd}.success`);
		statTracker.trackEvent(`rpc-result.*.success`);

	} else {
		global.rpcStats[cmd].failures++;
		statTracker.trackEvent(`rpc-result.${cmd}.failure`);
		statTracker.trackEvent(`rpc-result.*.failure`);
	}
}

async function getBlock(hash) {
    // 'getblock' RPC call, verbose = true
    return await getRpcDataWithParams({ method: "getblock", parameters: [hash, true] });
}

//--Add new------
function getTotalTxVolume(txs) {
    let totalVolume = new Decimal(0);

    for (const tx of txs) {
        for (const vout of tx.vout) {
            totalVolume = totalVolume.plus(new Decimal(vout.value));
        }
    }

    return totalVolume;
}

function getBlockVolume(block) {
    let txVolume = getTotalTxVolume(block.tx || []);
    let fees = getBlockTotalFeesFromCoinbaseTxAndBlockHeight(block.coinbaseTx, block.height);

    return txVolume.minus(new Decimal(fees));
}

function getCirculatingSupply(height) {
    return estimatedSupply(height);
}

function formatVolume(volume, coinUnit = coinConfig.baseCurrencyUnit.name) {
    return `${formatCurrencyAmount(volume, coinUnit).val} ${coinUnit}`;
}

// utils/block.js or wherever you define helpers
function getBlockTotalVolume(block) {
    let totalVolume = 0;

    if (!block) return totalVolume;

    // Include mining reward (coinbase)
    if (block.miningReward) {
        totalVolume += parseFloat(block.miningReward);
    }

    // Include all transaction outputs
    if (block.tx) {
        block.tx.forEach(tx => {
            if (tx.vout) {
                tx.vout.forEach(vout => {
                    if (vout.value) {
                        totalVolume += parseFloat(vout.value);
                    }
                });
            }
        });
    }

    return totalVolume;
}

// Optionally, calculate total fees per block
function getBlockTotalFees(block) {
    let totalFees = 0;

    if (!block || !block.tx) return totalFees;

    block.tx.forEach(tx => {
        if (tx.fee) {
            totalFees += parseFloat(tx.fee);
        }
    });

    return totalFees;
}

function isValidTxid(txid) {
    return typeof txid === "string" && /^[a-fA-F0-9]{64}$/.test(txid);
}

function isValidBlockHash(hash) {
    return typeof hash === "string" && /^[a-fA-F0-9]{64}$/.test(hash);
}

module.exports = {
	isValidBlockHash:isValidBlockHash,
	isValidTxid:isValidTxid,
	getBlockTotalFees:getBlockTotalFees,
	getBlockTotalVolume:getBlockTotalVolume,
	formatVolume:formatVolume,
	getCirculatingSupply:getCirculatingSupply,
	getBlockVolume:getBlockVolume,
	getTotalTxVolume:getTotalTxVolume,
	getBlock:getBlock,
	getAddressBalance: getAddressBalance,
	getRpcData: getRpcData,
	getRpcDataWithParams: getRpcDataWithParams,

	getBlockchainInfo: getBlockchainInfo,
	getDeploymentInfo: getDeploymentInfo,
	getBlockCount: getBlockCount,
	getNetworkInfo: getNetworkInfo,
	getNetTotals: getNetTotals,
	getMempoolInfo: getMempoolInfo,
	getAllMempoolTxids: getAllMempoolTxids,
	getMiningInfo: getMiningInfo,
	getIndexInfo: getIndexInfo,
	getBlockByHeight: getBlockByHeight,
	getBlockByHash: getBlockByHash,
	getRawTransaction: getRawTransaction,
	getUtxo: getUtxo,
	getMempoolTxDetails: getMempoolTxDetails,
	getRawMempool: getRawMempool,
	getUptimeSeconds: getUptimeSeconds,
	getHelp: getHelp,
	getRpcMethodHelp: getRpcMethodHelp,
	getAddress: getAddress,
	getPeerInfo: getPeerInfo,
	getChainTxStats: getChainTxStats,
	getSmartFeeEstimate: getSmartFeeEstimate,
	getUtxoSetSummary: getUtxoSetSummary,
	getNetworkHashrate: getNetworkHashrate,
	getBlockStats: getBlockStats,
	getBlockStatsByHeight: getBlockStatsByHeight,
	getBlockHeaderByHash: getBlockHeaderByHash,
	getBlockHeaderByHeight: getBlockHeaderByHeight,
	getBlockHashByHeight: getBlockHashByHeight,
	getTxOut: getTxOut,
	getBlockTemplate: getBlockTemplate,

	minRpcVersions: minRpcVersions
};