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

module.exports = router;