var express = require('express');
var router = express.Router();
var monk = require('monk');
const User = require('../models/user');
const Alpaca = require('@alpacahq/alpaca-trade-api');
const { default: axios } = require('axios');
const alpaca = new Alpaca({
    keyId: 'PKVSY8HW2NWNLFTCQS71',
    secretKey: '6wxuANIzODXQBdU1zE27QOf6U7eETMeftWF6KBAa',
    paper: true
});

// OK
// async function to show the indexes of the user
var showIndexesAsync = async function(req, res) {
    try {
        var data = await User.find({_id: req.cookies.userId});
    } catch(err) {
        res.json({statusString: "Failed", indexes: []});
    }

    var indexesCreated = data[0].indexes;
    var returnArr = new Array();
    for (var i = 0; i < indexesCreated.length; i++) {
        var totalInvested = 0;
        var tickerArr = new Array();
        var currIndexValue = 0;
        var stockObjectArr = new Array();

        // get information from db and arrange into necessary return format
        for (var j = 0; j < indexesCreated[i].index.length; j++) {
            totalInvested += indexesCreated[i].index[j].amount * indexesCreated[i].index[j].avgPrice;
            tickerArr.push(indexesCreated[i].index[j].ticker);
            
            // get latest price for current allocation calculation
            try {
                var stockData = await alpaca.getLatestTrade(indexesCreated[i].index[j].ticker);
            } catch(err) {
                console.log(err);
                res.json({statusString: "3rd party API failure", indexes: []});
            }
            
            // current allocation calculation, add to current index value
            var latestPrice = stockData.Price;
            var currAlloc = indexesCreated[i].index[j].amount * latestPrice;
            currIndexValue += currAlloc;

            stockObjectArr.push({
                ticker: indexesCreated[i].index[j].ticker,
                proportion: indexesCreated[i].index[j].proportion,
                amount: indexesCreated[i].index[j].amount,
                currAlloc: currAlloc,
                avgPrice: indexesCreated[i].index[j].avgPrice
            })
        }

        returnArr.push({
            nameOfIndex: indexesCreated[i].nameOfIndex,
            totalInvested: totalInvested,
            currIndexValue: currIndexValue,
            index: stockObjectArr
        });
    }
    res.json({statusString: "OK", indexes: returnArr});
}

// OK
router.get('/showindexes', (req, res, next) => {
    if (req.cookies.userId) {
        showIndexesAsync(req, res);
    } else {
        res.json({statusString: "Not logged in", indexes: []});
    }
})

// OK
// creates a new index
router.put('/create', (req, res, next) => {
    if (req.cookies.userId) {
        User.find({_id: req.cookies.userId}).then(data => {
            var indexes = data[0].indexes;
            indexes = [...indexes]; // create a deep copy
            var stockArr = new Array();
            for (var i = 0; i < req.body.index.length; i++) {   // populate the array of stocks
                stockArr.push({
                    ticker: req.body.index[i].ticker,
                    proportion: req.body.index[i].proportion,
                    amount: 0,
                    avgPrice: 0
                });
            }

            indexes.push({  // push to our deep copy
                nameOfIndex: req.body.nameOfIndex,
                index: stockArr
            });

            // update the database
            User.findOneAndUpdate({_id: req.cookies.userId}, {indexes: indexes}).then(() => {
                res.json({statusString: "OK"});
            });
        })
    } else {
        res.json({statusString: "Not logged in"});
    }
})

// OK
// async function to get the current allocations of stocks
var getCurrentAllocs = async function(index, res) {
    var currAllocArr = new Array(); // array of current allocations
    var totalValNow = 0;

    for (var i = 0; i < index.length; i++) {
        var stockData = await alpaca.getLatestTrade(index[i].ticker);
        currAllocArr.push(index[i].amount * stockData.Price);   // current price * amount
        totalValNow += index[i].amount * stockData.Price;
    }
    
    console.log([currAllocArr, totalValNow]);

    return [currAllocArr, totalValNow]; // return the current allocations and the total value at the moment
}

// OK
// async function for buying an index
var buyAsync = async function(req, res) {

    var data = await User.find({_id: req.cookies.userId});
    var dollarsLeft = req.body.amount;

    if (dollarsLeft > data[0].cashAvailable) {  // assuming the money used to buy the index is from cash in account
        res.json({statusString: "Not enough cash availabke"});
    }

    var indexesUpdated = new Array();   // stores the updated indexes to update the db
    
    // stores objects consisting of these key-value pairs: 
    // ticker, difference to target allocation, current amount, current avg price, current proportion
    var differencesObjects = new Array();

    for (var j = 0; j < data[0].indexes.length; j++) {

        if (data[0].indexes[j].nameOfIndex === req.body.nameOfIndex) {
            var returnedName = data[0].indexes[j].nameOfIndex;
            
            var returnArr = new Array();

            var index = data[0].indexes[j].index;
            var [currAllocArr, currIndexVal] = await getCurrentAllocs(index, res);  // OK

            var newTotal = Number(req.body.amount) + currIndexVal;  // OK
            
            // calculating the differences
            for (var q = 0; q < index.length; q++) {
                // diff = target alloc = curr alloc
                
                var diff = (index[q].proportion * newTotal) - currAllocArr[q]; // difference
                // difference +ve if need to add, -ve if too much

                // needs to be added respectively
                differencesObjects.push({
                    ticker: index[q].ticker,
                    diff: diff,
                    amount: index[q].amount,
                    avgPrice: index[q].avgPrice,
                    proportion: index[q].proportion
                });
            }

            // sort based on differences (descending order)
            differencesObjects.sort((a, b) => {
                if (a.diff > b.diff) {
                    return -1;
                } else if (a.diff < b.diff) {
                    return 1;
                }
                return 0;
            });

            // buying in the right amounts
            for (var p = 0; p < differencesObjects.length; p++) {

                if (differencesObjects[p].diff < 0) {   // no need to buy
                    returnArr.push({
                        ticker: differencesObjects[p].ticker, 
                        proportion: differencesObjects[p].proportion,
                        amount: differencesObjects[p].amount,
                        avgPrice: differencesObjects[p].avgPrice
                    })
                    continue;
                }
                
                // we can only add to the min of the dollars left and the difference
                // adding to the highest difference first and ignoring those tickers with negative differences
                var toAllocate = Math.min(dollarsLeft, differencesObjects[p].diff);
                dollarsLeft -= toAllocate;

                try {
                    await alpaca.createOrder({  // ok
                        symbol: differencesObjects[p].ticker,
                        notional: toAllocate,
                        side: 'buy',
                        type: 'market',
                        time_in_force: 'day'
                    });
                } catch(err) {
                    console.log(err.message);
                    res.json({statusString: "3rd party API failure"});
                }

                // adding updated information to the index (to be sent over to db)
                try {
                    var stockData = await alpaca.getLatestTrade(differencesObjects[p].ticker);
                    var latestPrice = stockData.Price;
                    
                    console.log(latestPrice);

                    var amountAdded = toAllocate / latestPrice;
                    var newAvgPrice = ((differencesObjects[p].avgPrice * differencesObjects[p].amount) 
                        + (amountAdded * latestPrice)) 
                        / (differencesObjects[p].amount + amountAdded);
                    
                    console.log(newAvgPrice);

                    returnArr.push({
                        ticker: differencesObjects[p].ticker,
                        proportion: differencesObjects[p].proportion,
                        amount: differencesObjects[p].amount + amountAdded,
                        avgPrice: newAvgPrice
                    })
                } catch(e) {    // no chance of error on buy side
                    console.log(e.message);
                    res.json({statusString: "3rd party API failure"});
                }
            }

            // left: update database to reflect new amounts
            indexesUpdated.push({
                nameOfIndex: returnedName,
                index: returnArr
            });
        } else {
            indexesUpdated.push(data[0].indexes[j]);
        }
    }

    // update db
    console.log(indexesUpdated);
    await User.findOneAndUpdate({_id: req.cookies.userId}, {
        cashAvailable: data[0].cashAvailable - req.body.amount, indexes: indexesUpdated
    });

    res.json({statusString: "OK"});
}

// OK
router.post('/buy', (req, res, next) => {
    if (req.cookies.userId) {
        buyAsync(req, res);
    } else {
        res.json({statusString: "Not logged in"});
    }
})

// async function to handle selling
var sellAsync = async function(req, res) {
    var data = await User.find({_id: req.cookies.userId});
    var dollarsToGo = req.body.amount;

    var indexesUpdated = new Array();   // stores the updated indexes to update the db
    
    // stores objects consisting of 2 key-value pairs: ticker, difference
    var differencesObjects = new Array();

    console.log(data);

    for (var j = 0; j < data[0].indexes.length; j++) {

        if (data[0].indexes[j].nameOfIndex === req.body.nameOfIndex) {
            var returnedName = data[0].indexes[j].nameOfIndex;
            
            var returnArr = new Array();

            var index = data[0].indexes[j].index;
            var [currAllocArr, currIndexVal] = await getCurrentAllocs(index, res);  // OK
            
            if (currIndexVal < dollarsToGo) {
                res.json({statusString: "Current index value smaller than amount to sell"});
            }

            var newTotal = currIndexVal - Number(req.body.amount);  // OK
            
            // calculating the differences
            for (var q = 0; q < index.length; q++) {
                // diff = target alloc = curr alloc
                
                var diff = (index[q].proportion * newTotal) - currAllocArr[q]; // difference
                // difference +ve if need to add, -ve if too much

                // needs to be added respectively
                differencesObjects.push({
                    ticker: index[q].ticker,
                    diff: diff,
                    amount: index[q].amount,
                    avgPrice: index[q].avgPrice,
                    proportion: index[q].proportion
                });
            }

            // sort based on differences (ascending order)
            differencesObjects.sort((a, b) => {
                if (a.diff > b.diff) {
                    return 1;
                } else if (a.diff < b.diff) {
                    return -1;
                }
                return 0;
            });

            // selling in the right amounts
            for (var p = 0; p < differencesObjects.length; p++) {

                if (differencesObjects[p].diff >= 0) {   // no need to sell
                    returnArr.push({
                        ticker: differencesObjects[p].ticker, 
                        proportion: differencesObjects[p].proportion,
                        amount: differencesObjects[p].amount,
                        avgPrice: differencesObjects[p].avgPrice
                    })
                    continue;
                }

                // we can only reduce by the min of the dollars to go and the difference
                // adding to the highest difference first and ignoring those tickers with positive differences
                var toReduce = Math.min(dollarsToGo, -differencesObjects[p].diff);
                dollarsToGo -= toReduce;

                try {
                    console.log(differencesObjects[p].ticker);
                    var test = await alpaca.createOrder({
                        symbol: differencesObjects[p].ticker,
                        notional: toReduce,
                        side: 'sell',
                        type: 'market',
                        time_in_force: 'day'
                    });
                    console.log(test);
                } catch(err) {  // chance of a 422 error if user has not bought the stock before selling
                    // beware of this error during off-market hours

                    console.log(err.message);
                    res.json({statusString: "3rd party API failure"});
                }

                // adding updated information to the index (to be sent over to db)
                try {
                    var stockData = await alpaca.getLatestTrade(differencesObjects[p].ticker);
                    var latestPrice = stockData.Price;
                    
                    console.log(latestPrice);

                    var amountDeducted = toReduce / latestPrice;

                    if (differencesObjects[p].amount - amountDeducted !== 0) {
                        var newAvgPrice = ((differencesObjects[p].avgPrice * differencesObjects[p].amount) 
                            - (amountDeducted * latestPrice)) 
                            / (differencesObjects[p].amount - amountDeducted);
                    } else {    // deals with edge case of removing everything
                        var newAvgPrice = 0;
                    }

                    returnArr.push({
                        ticker: differencesObjects[p].ticker,
                        proportion: differencesObjects[p].proportion,
                        amount: differencesObjects[p].amount - amountDeducted,
                        avgPrice: newAvgPrice
                    });
                } catch(e) {
                    console.log(e.message);
                    res.json({statusString: "3rd party API failure"});
                }
            }

            console.log(returnArr);
            
            // preparing data to update database with
            indexesUpdated.push({
                nameOfIndex: returnedName,
                index: returnArr
            });
        } else {
            indexesUpdated.push(data[0].indexes[j]);
        }
    }

    // update db
    console.log(indexesUpdated);
    await User.findOneAndUpdate({_id: req.cookies.userId}, {
        cashAvailable: data[0].cashAvailable + Number(req.body.amount), indexes: indexesUpdated
    });

    res.json({statusString: "OK"});

}

// OK (more testing needed)
router.post('/sell', (req, res, next) => {
    if (req.cookies.userId) {
        sellAsync(req, res);
    } else {
        res.json({statusString: "Not logged in"});
    }
})

// async function to rebalance an index
var rebalanceAsync = async function(req, res) {
    var data = await User.find({_id: req.cookies.userId});
    var indexesUpdated = new Array();   // stores the updated indexes to update the db
    
    var differencesObjects = new Array();

    for (var j = 0; j < data[0].indexes.length; j++) {

        if (data[0].indexes[j].nameOfIndex === req.body.nameOfIndex) {  // the index we want to rebalance
            var returnedName = data[0].indexes[j].nameOfIndex;
            
            var returnArr = new Array();

            var index = data[0].indexes[j].index;
            var [currAllocArr, currIndexVal] = await getCurrentAllocs(index, res);  // OK

            var newTotal = currIndexVal;    // new total is the current index value
            
            // calculating the differences
            for (var q = 0; q < index.length; q++) {
                
                var diff = (index[q].proportion * newTotal) - currAllocArr[q]; // difference
                // difference +ve if need to add, -ve if too much

                // needs to be added respectively
                differencesObjects.push({
                    ticker: index[q].ticker,
                    diff: diff,
                    amount: index[q].amount,
                    avgPrice: index[q].avgPrice,
                    proportion: index[q].proportion
                });
            }

            // sort based on differences (ascending order)
            differencesObjects.sort((a, b) => {
                if (a.diff > b.diff) {
                    return 1;
                } else if (a.diff < b.diff) {
                    return -1;
                }
                return 0;
            });

            console.log("differences objects")
            console.log(differencesObjects);

            // buying in the right amounts
            for (var p = 0; p < differencesObjects.length; p++) {
                
                try {
                    if (differencesObjects[p].diff > 0) {
                        await alpaca.createOrder({  // OK
                            symbol: differencesObjects[p].ticker,
                            notional: differencesObjects[p].diff,
                            side: 'buy',
                            type: 'market',
                            time_in_force: 'day'
                        });
                    } else if (differencesObjects[p].diff < 0) {
                        await alpaca.createOrder({  // OK
                            symbol: differencesObjects[p].ticker,
                            notional: -differencesObjects[p].diff,
                            side: 'sell',
                            type: 'market',
                            time_in_force: 'day'
                        });
                    }
                } catch(err) {  // chance of error if stock not previously bought before selling
                    console.log(err.message);
                    res.json({statusString: "3rd party API failure"});
                }

                // adding updated information to the index (to be sent over to db)
                try {
                    console.log(differencesObjects[p].ticker);
                    var stockData = await alpaca.getLatestTrade(differencesObjects[p].ticker);
                    var latestPrice = stockData.Price;
                    
                    console.log(latestPrice);

                    if (differencesObjects[p].diff > 0) {
                        var amountAdded = differencesObjects[p].diff / latestPrice;
                        var newAvgPrice = ((differencesObjects[p].avgPrice * differencesObjects[p].amount) 
                            + (amountAdded * latestPrice)) 
                            / (differencesObjects[p].amount + amountAdded);
                        console.log("new avg price");
                        console.log(newAvgPrice);

                        returnArr.push({
                            ticker: differencesObjects[p].ticker,
                            proportion: differencesObjects[p].proportion,
                            amount: differencesObjects[p].amount + amountAdded,
                            avgPrice: newAvgPrice
                        });
                    } else {
                        var amountDeducted = -differencesObjects[p].diff / latestPrice;
                        if (differencesObjects[p].amount - amountDeducted !== 0) {
                            var newAvgPrice = ((differencesObjects[p].avgPrice * differencesObjects[p].amount) 
                                - (amountDeducted * latestPrice)) 
                                / (differencesObjects[p].amount - amountDeducted);
                        } else {    // deals with edge case of removing everything
                            var newAvgPrice = 0;
                        }
                        
                        console.log(newAvgPrice);

                        returnArr.push({
                            ticker: differencesObjects[p].ticker,
                            proportion: differencesObjects[p].proportion,
                            amount: differencesObjects[p].amount - amountDeducted,
                            avgPrice: newAvgPrice
                        });
                    }
                } catch(e) {
                    console.log(e.message);
                    res.json({statusString: "3rd party API failure"});
                }
            }

            // left: update database to reflect new amounts
            indexesUpdated.push({
                nameOfIndex: returnedName,
                index: returnArr
            });
        } else {
            indexesUpdated.push(data[0].indexes[j]);
        }
    }

    // update db
    console.log(indexesUpdated);
    await User.findOneAndUpdate({_id: req.cookies.userId}, {
        indexes: indexesUpdated
    });

    res.json({statusString: "OK"});
}

// OK
router.post('/rebalance', (req, res, next) => {
    if (req.cookies.userId) {
        rebalanceAsync(req, res);
    } else {
        res.json({statusString: "Not logged in"});
    }
})

var changeAsync = async function(req, res) {
    var data = await User.find({_id: req.cookies.userId});
    var indexesUpdated = new Array();
    var hashMap = new Map();    // key: ticker, value: proportion
    
    // hashset that consists of all the items in req.body which we have added so far (excl. removed stocks)
    var added = new Set();

    // populate the hashmap
    var inputIndex = req.body.index;
    for (var k = 0; k < inputIndex.length; k++) {
        hashMap.set(inputIndex[k].ticker, inputIndex[k].proportion);
    }

    console.log('hashmap:');
    console.log(hashMap);

    for (var i = 0; i < data[0].indexes.length; i++) {
        if (data[0].indexes[i].nameOfIndex === req.body.nameOfIndex) {  // index to edit
            var newIndexArr = new Array();

            for (var j = 0; j < data[0].indexes[i].index.length; j++) {
                var currStockObj = data[0].indexes[i].index[j];
                if (hashMap.has(currStockObj.ticker)) { // proportion needs to change
                    var objToAdd = {
                        ticker: currStockObj.ticker,
                        proportion: hashMap.get(currStockObj.ticker),
                        amount: currStockObj.amount,
                        avgPrice: currStockObj.avgPrice
                    };
                    newIndexArr.push(objToAdd);
                    added.add(currStockObj.ticker); // add to added hashset
                } else {    // stock needs to be removed
                    newIndexArr.push({
                        ticker: currStockObj.ticker,
                        proportion: 0,
                        amount: currStockObj.amount,
                        avgPrice: currStockObj.avgPrice
                    });
                }
            }

            // adding new stocks
            for (var [tickerKey, targetProp] of hashMap.entries()) {    // loop thru hashmap
                if (!added.has(tickerKey)) {    // stock yet to be added
                    newIndexArr.push({
                        ticker: tickerKey,
                        proprtion: targetProp,
                        amount: 0,
                        avgPrice: 0
                    });
                    added.add(tickerKey);
                }
            }

            indexesUpdated.push({
                nameOfIndex: req.body.nameOfIndex,
                index: newIndexArr
            });
        }
        else {
            indexesUpdated.push(data[0].indexes[i]);
        }
    }

    console.log(indexesUpdated);

    // update db
    await User.findOneAndUpdate({_id: req.cookies.userId}, {indexes: indexesUpdated});  

    // rebalance the newly edited index
    console.log("rebalance");
    await rebalanceAsync(req, res); // res to client sent from this async function
}

// OK
router.post('/change', (req, res, next) => {
    if (req.cookies.userId) {
        changeAsync(req, res);
    } else {
        res.json({statusString: "Not logged in"});
    }
})

module.exports = router;