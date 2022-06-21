var express = require("express");
var router = express.Router();
var monk = require('monk');
const User = require('../models/user');
const Alpaca = require('@alpacahq/alpaca-trade-api');
const alpaca = new Alpaca({
    keyId: 'PKVSY8HW2NWNLFTCQS71',
    secretKey: '6wxuANIzODXQBdU1zE27QOf6U7eETMeftWF6KBAa',
    paper: true
});

router.put('/addtowatchlist/:ticker', (req, res, next) => {
    if (req.cookies.userId) {
        User.find({_id: req.cookies.userId}).then(data => {
            var obj = data[0];
            var originalWatchlist = obj.watchlist;
            if (req.params.ticker in originalWatchlist) {
                res.json({statusString: "Already in watchlist"});
            } else {
                var newWatchlist = originalWatchlist.push(ticker);
                User.findOneAndUpdate({_id: req.cookies.userId}, {watchList: newWatchlist}).then(() => {
                    res.json({statusString: "OK"});
                });
            }
        }).catch(() => {
            res.json({statusString: "Failure"});
        })
    } else {
        res.json({statusString: "Not logged in"});
    }
})

module.exports = router;