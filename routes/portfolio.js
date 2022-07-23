var express = require("express");
var router = express.Router();
var monk = require('monk');
const Alpaca = require('@alpacahq/alpaca-trade-api');
const alpaca = new Alpaca({
    keyId: 'PKVSY8HW2NWNLFTCQS71',
    secretKey: '6wxuANIzODXQBdU1zE27QOf6U7eETMeftWF6KBAa',
    paper: true
});
const User = require('../models/user');
const axios = require('axios');

// async function used in the /getstocks API
// loops through stocks to get the current price, computes the current allocation and sends 
//      the correct data to the client
const sendStocks = async function(stocks, stockList, totalAlloc, res) {
    for (var i = 0; i < stocks.length; i++) {
        var stockData = await alpaca.getLatestTrade(stocks[i].ticker);
        var latestPrice = stockData.Price;
        var currAlloc = stocks[i].amount * latestPrice;
        var stockObj = {
            name: stocks[i].name, ticker: stocks[i].ticker, amount: stocks[i].amount, 
            avgPrice: stocks[i].avgPrice, currAlloc: currAlloc
        };

        totalAlloc += currAlloc;
        stockList.push(stockObj);
    }

    res.json({statusString: "OK", totalStockValue: totalAlloc, stocks: stockList});
}

// async function used in the /getindexes API
// loops through the indexes and their respective stock allocations, returns the necessary data and computes 
//      the current allocation
const sendIndexes = async function (indexes, returnedIndexList, res) {
    for (var i = 0; i < indexes.length; i++) {
        var stocks = indexes[i].index;
        var stockList = new Array();
        var totalAlloc = 0;
        for (var j = 0; j < stocks.length; j++) {
            if (stocks[j].amount === 0) {   // ignores non-invested indices
                continue;
            }

            var stockData = await alpaca.getLatestTrade(stocks[j].ticker);
            var latestPrice = stockData.Price;
            var currAlloc = stocks[j].amount * latestPrice;
            var stockObj = {
                name: stocks[j].name, ticker: stocks[j].ticker, amount: stocks[j].amount, 
                avgPrice: stocks[j].avgPrice, currAlloc: currAlloc
            };

            totalAlloc += currAlloc;
            stockList.push(stockObj);
        }

        // we are only adding actively invested indexes to the returned array
        if (totalAlloc === 0) {
            continue;
        }

        var outputObj = {
            name: indexes[i].nameOfIndex, totalIndexValue: totalAlloc, stocks: stockList
        };

        returnedIndexList.push(outputObj);
    }
    res.json({statusString: "OK", indexes: returnedIndexList});
}

// DONE, CHECKED
// sends information of all of the investor's stocks
router.get('/getstocks', (req, res, next) => {

    if (req.cookies.userId) {   // cookies set
        User.find({_id: req.cookies.userId}).then((data) => {   // ok
            var totalAlloc = 0;
            var stockList = new Array();

            if (data.length !== 0) {
                var stocks = data[0].stocks;
                
                sendStocks(stocks, stockList, totalAlloc, res); // async function
            }
        }).catch((err) => {
            res.json({statusString: err.message, totalStockValue: -1, stocks: []});
        })
    } else {
        res.json({statusString: "Not logged in", totalStockValue: -1, stocks: []});
    }
})

// DONE, CHECKED
// sends information on a user's invested indexes (where amount is > 0)
router.get('/getindexes', (req, res, next) => {

    if (req.cookies.userId) {
        User.find({_id: req.cookies.userId}).then((data) => {
            if (data.length !== 0) {
                var indexes = data[0].indexes;
                var returnedIndexList = new Array();
                sendIndexes(indexes, returnedIndexList, res);
            }
        }).catch((err) => {
            res.json({statusString: err.message, indexes: []});
        })
    } else {
        res.json({statusString: "Not logged in", indexes: []});
    }
})

// DONE, NOT CHECKED
// gets the user's cash balance
router.get('/getcashbalance', (req, res, next) => {

    if (req.cookies.userId) {
        User.find({_id: req.cookies.userId}).then((data) => {
            if (data.length !== 0) {
                res.json({statusString: "OK", cashBalance: data[0].cashAvailable});
            }
        }).catch((err) => {
            res.json({statusString: err, cashBalance: 0});
        })
    } else {
        res.json({statusString: "Not logged in", cashBalance: 0});
    }
})

module.exports = router;