var express = require('express');
var router = express.Router();
var monk = require('monk');
const User = require('../models/user');
const Alpaca = require('@alpacahq/alpaca-trade-api');
const alpaca = new Alpaca({
    keyId: 'PKVSY8HW2NWNLFTCQS71',
    secretKey: '6wxuANIzODXQBdU1zE27QOf6U7eETMeftWF6KBAa',
    paper: true
});
const axios = require('axios');

// async function used in /getwatchlist API
// obtains the current price of and daily percentage change of each stock in the watchlist, returns correct data
var sendWatchlist = async function(watchlist, returnArr, res) {
    for (var i = 0; i < watchlist.length; i++) {
        // get the current price and calculate daily % change
        var stockData = await alpaca.getLatestTrade(watchlist[i]);
        var latestPrice = stockData.Price;
        var snapshotData = await alpaca.getSnapshot(watchlist[i]);
        var latestDailyOpen = snapshotData.DailyBar.OpenPrice;
        var dailyChange = ((latestPrice - latestDailyOpen) / latestDailyOpen) * 100;
        returnArr.push({
            ticker: watchlist[i], currPrice: latestPrice, dailyChange: dailyChange
        });
    }
    res.json({statusString: "OK", watchlist: returnArr});
}

// async function used in /searchstocks API
var sendSearchedStock = async function(ticker, res) {
    try {
        var snapshotData = await alpaca.getSnapshot(ticker);
    } catch (err) { // if the stock is not found
        res.json({statusString: "Stock not found", stockData: {}});
    }

    if (typeof snapshotData === 'undefined' || !snapshotData) { // if the stock is not found
        res.json({statusString: "Stock not found", stockData: {}});
    }
    else {
        // get the current price and calculate daily % change
        var latestPrice = snapshotData.LatestTrade.Price;
        var latestDailyOpen = snapshotData.DailyBar.OpenPrice;
        var dailyChange = ((latestPrice - latestDailyOpen) / latestDailyOpen) * 100;
        res.json({statusString: "OK", stockData: {
            ticker: ticker, currPrice: latestPrice, dailyChange: dailyChange
        }});
    }
} 

// DONE, CHECKED
// gets the current user's watchlist
router.get('/getwatchlist', (req, res, next) => {
    // var db = req.db;
    // var col = db.get("users");

    if (req.cookies.userId) {
        User.find({_id: req.cookies.userId}).then((data) => {
            var returnArr = new Array();
            var watchlist = data[0].watchList;

            sendWatchlist(watchlist, returnArr, res);
        }).catch((err) => {
            res.json({statusString: err, watchlist: []});
        })
    } else {
        res.json({statusString: "Not logged in", watchlist: []});
    }
})

// DONE, CHECKED
// this API searches for a stock and returns necessary data; to be used when a user might want to search for other stocks
router.post('/searchstocks', (req, res, next) => {
    if (req.cookies.userId) {
        var tickerToSearch = req.body.ticker;
        sendSearchedStock(tickerToSearch, res); // calls the async function to arrange data and send
    } else {
        res.json({statusString: "Not logged in", stockData: {}});
    }
})

// DONE, CHECKED
// this API shows stocks based on their 24 hour traded volume; to be used to show more stocks outside the watchlist
router.get('/showstocks', (req, res, next) => {
    if (req.cookies.userId) {

        // the current price and daily change may be different from other calls since a different 3rd party API is used
        // note: alpaca doesn't provide an API to filter based on traded volume; alpaca's free
        //      version only provides data in 15 minute intervals
        axios
            .get('https://financialmodelingprep.com/api/v3/stock_market/actives?apikey=a4dcae0154dfb93f8af1090561d80cef')
            .then(result => {
                var returnArr = new Array();
                for (var i = 0; i < result.data.length; i++) {
                    returnArr.push({
                        ticker: result.data[i].symbol, 
                        currPrice: result.data[i].price, 
                        dailyChange: result.data[i].changesPercentage
                    });
                }
                res.json({statusString: "OK", stockData: returnArr});
            })
            .catch(err => {
                res.json({statusString: "3rd party API failure", stockData: []});
            });
        
    } else {
        res.json({statusString: "Not logged in", stockData: []});
    }
})

module.exports = router;
