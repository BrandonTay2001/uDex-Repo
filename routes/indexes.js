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
        for (var j = 0; j < indexesCreated[i].index.length; j++) {
            totalInvested += indexesCreated[i].index[j].amount * indexesCreated[i].index[j].avgPrice;
            tickerArr.push(indexesCreated[i].index[j].ticker);
            
            try {
                var stockData = await alpaca.getLatestTrade(indexesCreated[i].index[j].ticker);
            } catch(err) {
                console.log(err);
                res.json({statusString: "3rd party API failure", indexes: []});
            }
    
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
router.put('/create', (req, res, next) => {
    console.log('running');
    console.log(req.body);
    if (req.cookies.userId) {
        User.find({_id: req.cookies.userId}).then(data => {
            var indexes = data[0].indexes;
            indexes = [...indexes];
            var stockArr = new Array();
            for (var i = 0; i < req.body.index.length; i++) {
                stockArr.push({
                    ticker: req.body.index[i].ticker,
                    proportion: req.body.index[i].proportion,
                    amount: 0,
                    avgPrice: 0
                });
            }

            indexes.push({
                nameOfIndex: req.body.nameOfIndex,
                index: stockArr
            });

            User.findOneAndUpdate({_id: req.cookies.userId}, {indexes: indexes}).then(() => {
                res.json({statusString: "OK"});
            });
        })
    } else {
        res.json({statusString: "Not logged in"});
    }
})

// OK
var getCurrentAllocs = async function(index, res) {
    var currAllocArr = new Array();
    var totalValNow = 0;

    for (var i = 0; i < index.length; i++) {
        var stockData = await alpaca.getLatestTrade(index[i].ticker);
        currAllocArr.push(index[i].amount * stockData.Price);   // current price * amount
        totalValNow += index[i].amount * stockData.Price;

        console.log(index[i].ticker);
        console.log(stockData.Price);
    }
    
    console.log([currAllocArr, totalValNow]);

    return [currAllocArr, totalValNow]; // return the current allocations and the total value at the moment
}

var buyAsync = async function(req, res) {

    var data = await User.find({_id: req.cookies.userId});
    var dollarsLeft = req.body.amount;

    if (dollarsLeft > data[0].cashAvailable) {  // assuming the money used to buy the index is from cash in account
        res.json({statusString: "Not enough cash availabke"});
    }

    var indexesUpdated = new Array();   // stores the updated indexes to update the db
    
    // stores objects consisting of 2 key-value pairs: ticker, difference
    var differencesObjects = new Array();

    for (var j = 0; j < data[0].indexes.length; j++) {

        if (data[0].indexes[j].nameOfIndex === req.body.nameOfIndex) {
            var returnedName = data[0].indexes[j].nameOfIndex;
            
            var returnArr = new Array();

            var index = data[0].indexes[j].index;
            var [currAllocArr, currIndexVal] = await getCurrentAllocs(index, res);  // OK till here

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

            // console.log(differencesObjects);    // oK

            // buying in the right amounts
            // errors here + updating db [OK]
            for (var p = 0; p < differencesObjects.length; p++) {
                // console.log('for loop');

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
                    // console.log(toAllocate);
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
            var [currAllocArr, currIndexVal] = await getCurrentAllocs(index, res);  // OK till here
            
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

            // console.log(differencesObjects);    // oK

            // selling in the right amounts
            // errors here + updating db [OK]
            for (var p = 0; p < differencesObjects.length; p++) {
                // console.log('for loop');

                if (differencesObjects[p].diff >= 0) {   // no need to sell
                    returnArr.push({
                        ticker: differencesObjects[p].ticker, 
                        proportion: differencesObjects[p].proportion,
                        amount: differencesObjects[p].amount,
                        avgPrice: differencesObjects[p].avgPrice
                    })
                    continue;
                }
                
                // till here

                // we can only reduce by the min of the dollars to go and the difference
                // adding to the highest difference first and ignoring those tickers with positive differences
                var toReduce = Math.min(dollarsToGo, -differencesObjects[p].diff);
                dollarsToGo -= toReduce;

                try {
                    console.log("to reduce: ");
                    console.log(toReduce);

                    console.log(differencesObjects[p].ticker);
                    var test = await alpaca.createOrder({  // error here, 422 exit
                        symbol: differencesObjects[p].ticker,
                        notional: toReduce,
                        side: 'sell',
                        type: 'market',
                        time_in_force: 'day'
                    });
                    console.log(test);
                } catch(err) {
                    console.log(err.message);
                    res.json({statusString: "3rd party API failure"});
                }

                // adding updated information to the index (to be sent over to db)
                try {
                    var stockData = await alpaca.getLatestTrade(differencesObjects[p].ticker);
                    var latestPrice = stockData.Price;
                    
                    console.log(latestPrice);

                    var amountDeducted = toReduce / latestPrice;
                    var newAvgPrice = ((differencesObjects[p].avgPrice * differencesObjects[p].amount) 
                        - (amountDeducted * latestPrice)) 
                        / (differencesObjects[p].amount - amountDeducted);
                    
                    console.log(newAvgPrice);

                    returnArr.push({
                        ticker: differencesObjects[p].ticker,
                        proportion: differencesObjects[p].proportion,
                        amount: differencesObjects[p].amount - amountDeducted,
                        avgPrice: newAvgPrice
                    })
                } catch(e) {
                    console.log(e.message);
                    res.json({statusString: "3rd party API failure"});
                }
            }

            console.log(returnArr);
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
        cashAvailable: data[0].cashAvailable + Number(req.body.amount), indexes: indexesUpdated
    });

    res.json({statusString: "OK"});

}

router.post('/sell', (req, res, next) => {
    if (req.cookies.userId) {
        sellAsync(req, res);
    } else {
        res.json({statusString: "Not logged in"});
    }
})

module.exports = router;