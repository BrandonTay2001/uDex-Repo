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

// DONE, CHECKED
// adds the ticker to the watchlist
router.put('/addtowatchlist/:ticker', (req, res, next) => {
    if (req.cookies.userId) {
        User.find({_id: req.cookies.userId}).then(data => {
            var obj = data[0];
            var originalWatchlist = obj.watchList;
            var inArr = false;
            for (var i = 0; i < originalWatchlist.length; i++) {    // checks if ticker is already in watchlist
                if (originalWatchlist[i] === req.params.ticker) {
                    inArr = true;
                    break;
                }
            }
            if (inArr) {    // returns if already in watchlist
                res.json({statusString: "Already in watchlist"});
            } else {
                // else updates the watchlist in the db
                var newWatchlist = [...originalWatchlist];  // shallow copy
                newWatchlist.push(req.params.ticker);
                User.findOneAndUpdate({_id: req.cookies.userId}, {watchList: newWatchlist}).then(() => {
                    res.json({statusString: "OK"});
                });
            }
        }).catch((err) => {
            console.log(err.message);
            res.json({statusString: "Failure"});
        })
    } else {
        res.json({statusString: "Not logged in"});
    }
})

// async function used in /buy API
// updates the DB to reflect the new amount and average price
var findAndUpdateBuy = async function(userId, tickerAdded, dollarAmount, res) {
    var data = await User.find({_id: userId});
    if (data[0].cashAvailable < dollarAmount) {
        res.json({statusString: "Not enough cash available"});
    }

    var stockObjects = data[0].stocks;
    var stockArr = new Array();
    var inDB = false;
    for (var i = 0; i < stockObjects.length; i++) {
        if (stockObjects[i].ticker === tickerAdded) {

            // get stock info for updating price and amount
            try {
                var stockInfoGeneral = await axios.get(
                    'https://financialmodelingprep.com/api/v3/profile/' 
                    + tickerAdded + '?apikey=a4dcae0154dfb93f8af1090561d80cef'
                );
            } catch {
                res.json({statusString: "3rd party API failure"});
            }
            var stockInfo = stockInfoGeneral.data[0];
            var priceNow = stockInfo.price;
            var amount = dollarAmount / priceNow;

            // computes the new average price
            var newAvgPrice = ((stockObjects[i].avgPrice * stockObjects[i].amount) + (amount * priceNow)) 
                / (stockObjects[i].amount + amount);
            
            stockArr.push({
                name: stockInfo.companyName, amount: amount + stockObjects[i].amount, 
                ticker: tickerAdded, avgPrice: newAvgPrice
            });
            inDB = true;    // user already has the stock as an asset
        } else {
            stockArr.push(stockObjects[i]);
        }
    }
    if (inDB) {
        await User.findOneAndUpdate({_id: userId}, {
            cashAvailable: data[0].cashAvailable - dollarAmount, stocks: stockArr
        });
    }
    else {  // stock not in user's asset list
        try {
            var stockInfoGeneral = await axios.get(
                'https://financialmodelingprep.com/api/v3/profile/' 
                + tickerAdded + '?apikey=a4dcae0154dfb93f8af1090561d80cef'
            );
        } catch {
            res.json({statusString: "3rd party API failure"});
        }
        var stockInfo = stockInfoGeneral.data[0];
        var amount = dollarAmount / stockInfo.price;
        stockArr.push({
            name: stockInfo.companyName, amount: amount, ticker: tickerAdded, avgPrice: stockInfo.price
        });
        await User.findOneAndUpdate({_id: userId}, {
            cashAvailable: data[0].cashAvailable - dollarAmount, stocks: stockArr
        });
    }
    res.json({statusString: "OK"});
}

// DONE, CHECKED
// buys the stock in a specific dollar amount
router.post('/buy', (req, res, next) => {
    if (req.cookies.userId) {
        var dollarAmount = req.body.dollarAmount;
        var ticker = req.body.ticker;

        // create the market order (execute at current price)
        alpaca.createOrder({
            symbol: ticker,
            notional: Number(dollarAmount),
            side: 'buy',
            type: 'market',
            time_in_force: 'day'
        }).then((result) => {
            findAndUpdateBuy(req.cookies.userId, ticker, dollarAmount, res);
        }).catch((err) => {
            console.log(err.message);
            res.json({statusString: "Failure"});
        })
    } else {
        res.json({statusString: "Not logged in"})
    }
})

// async function used in /sell API
// updates the database based on the sale
// tickerAdded here represents the ticker sold
var findAndUpdateSell = async function(userId, tickerAdded, dollarAmount, res) {
    var data = await User.find({_id: userId});
    var stockObjects = data[0].stocks;
    var stockArr = new Array();

    for (var i = 0; i < stockObjects.length; i++) {
        if (stockObjects[i].ticker === tickerAdded) {
            try {
                var stockInfoGeneral = await axios.get(
                    'https://financialmodelingprep.com/api/v3/profile/' 
                    + tickerAdded + '?apikey=a4dcae0154dfb93f8af1090561d80cef'
                );
            } catch {
                res.json({statusString: "3rd party API failure"});
            }

            var stockInfo = stockInfoGeneral.data[0];
            var priceNow = stockInfo.price;
            var amount = dollarAmount / priceNow;

            if (amount === stockObjects[i].amount) {    // if everything is sold
                continue;
            }

            // computes the new average price
            var newAvgPrice = ((stockObjects[i].avgPrice * stockObjects[i].amount) - (amount * priceNow)) 
                / (stockObjects[i].amount - amount);
            stockArr.push({
                name: stockInfo.companyName, amount: stockObjects[i].amount - amount, 
                ticker: tickerAdded, avgPrice: newAvgPrice
            });
        } else {
            stockArr.push(stockObjects[i]);
        }
    }

    // update db
    await User.findOneAndUpdate({_id: userId}, {
        cashAvailable: Number(data[0].cashAvailable) + Number(dollarAmount), stocks: stockArr
    });
    res.json({statusString: "OK"});
}

// DONE, CHECKED
// sells the stock in a specific dollar amount
router.post('/sell', (req, res, next) => {
    if (req.cookies.userId) {
        var dollarAmount = req.body.dollarAmount;
        var ticker = req.body.ticker;

        // create the market order (execute at current price)
        alpaca.createOrder({
            symbol: ticker,
            notional: Number(dollarAmount),
            side: 'sell',
            type: 'market',
            time_in_force: 'day'
        }).then((result) => {
            findAndUpdateSell(req.cookies.userId, ticker, dollarAmount, res);
        }).catch((err) => {
            console.log(err.message);
            res.json({statusString: "Failure - Asset was not previously bought or does not exist"});
        })
    } else {
        res.json({statusString: "Not logged in"})
    }
})

// async function used in /:ticker API
// gets the 1-year historical prices of the stock
var getHistoricalPrices = async function(ticker, res) {
    try {
        var info = await axios.get('https://financialmodelingprep.com/api/v3/historical-price-full/' + ticker +
        '?timeseries=365&apikey=a4dcae0154dfb93f8af1090561d80cef');
        var priceObjects = info.data.historical;
        var returnArr = new Array();

        for (var i = 0; i < priceObjects.length; i++) {
            returnArr.push({date: priceObjects[i].date, price: priceObjects[i].close});
        }
    } catch(e) {
        console.log(e.message);
        res.json({statusString: "3rd party API failure"});
    }
    return returnArr;
}

// async function used in /:ticker API
// gets various financial info of the stock, not complete but should be enough for a prototype
var getFinancialInfo = async function(ticker, res) {
    try {
        var info = await axios.get('https://financialmodelingprep.com/api/v3/ratios-ttm/' + ticker
        + '?apikey=a4dcae0154dfb93f8af1090561d80cef');
        var financialInfoObj = info.data[0];
        var returnObj = {
            divYield: financialInfoObj.dividendYielPercentageTTM,
            peRatio: financialInfoObj.peRatioTTM,
            grossProfitMargin: financialInfoObj.grossProfitMarginTTM,
            netProfitMargin: financialInfoObj.netProfitMarginTTM,
            pbRatio: financialInfoObj.priceBookValueRatioTTM
        };
        return returnObj;
    } catch(e) {
        console.log(e.message);
        res.json({statusString: "3rd party API failure"});
    }
}

// async function used in /:ticker API
// gets the name and price of the stock
var getStockGeneralInfo = async function(ticker, res) {
    try {
        var stockInfo = await axios.get(
            'https://financialmodelingprep.com/api/v3/profile/' + ticker + '?apikey=a4dcae0154dfb93f8af1090561d80cef'
        );
        var currPrice = stockInfo.data[0].price;
        var name = stockInfo.data[0].companyName;
        var returnObj = {name: name, currPrice: currPrice};
        return returnObj;
    } catch(e) {
        console.log(e.message);
        res.json({statusString: "3rd party API failure"});
    }
}

// async function used in /:ticker API
// executes all the other informational async functions and returns an organized result to the client
var executeFunctions = async function(ticker, res) {
    var historicalPriceArr = await getHistoricalPrices(ticker, res);
    var financialInfo = await getFinancialInfo(ticker, res);
    var generalInfo = await getStockGeneralInfo(ticker, res);
    res.json({
        statusString: "OK", generalInfo: generalInfo, financialInfo: financialInfo,
        historicalPrices: historicalPriceArr
    });
}

// DONE, CHECKED
// returns general information about the stock and its 1-year historical prices
router.get('/:ticker', (req, res, next) => {
    if (req.cookies.userId) {
        var ticker = req.params.ticker;
        executeFunctions(ticker, res);
    } else {
        res.json({statusString: "Not logged in"});
    }
})

module.exports = router;
