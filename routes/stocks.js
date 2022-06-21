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

// DONE, CHECKED
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
                var newWatchlist = [...originalWatchlist];
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

router.post('/buy', (req, res, next) => {
    if (req.cookies.userId) {
        var dollarAmount = req.body.dollarAmount;
        var ticker = req.body.ticker;
        
    } else {
        res.json({statusString: "Not logged in"})
    }
})

module.exports = router;
