var express = require("express");
var router = express.Router();
var monk = require('monk');
const User = require('../models/user');
const axios = require('axios');
const Alpaca = require('@alpacahq/alpaca-trade-api');
const alpaca = new Alpaca({
    keyId: 'PKVSY8HW2NWNLFTCQS71',
    secretKey: '6wxuANIzODXQBdU1zE27QOf6U7eETMeftWF6KBAa',
    paper: true
});

// DONE, CHECKED
// facilitates signing in
router.post('/signin', (req, res, next) => {
    
    // standard stuff
    // var db = req.db;
    var username = req.body.username;
    var password = req.body.password;
    console.log(username);
    // var col = db.get("users");

    // find in database according to username and password
    User.find({userName: username, password: password}).then((data) => {
        if (data.length !== 0) {
            
            // setting the cookie to be the ID found 
            var currUserId = data[0]._id;
            res.cookie("userId", currUserId);
            res.send("OK"); // sending a status message
        } else {
            res.send("Sign In Failure");    // cookie not set, failure messaage sent
        }
    }).catch((err) => {
        console.log(err);
        res.send("Error");
    })
});

// DONE, CHECKED
// signs the user out
router.get('/signout', (req, res, next) => {
    
    // clearing the ID cookie and sending back a status message
    res.clearCookie("userId");
    res.send("OK")
})

// TEST ENDPOINT
router.get('/test-endpoint', (req, res, next) => {
    var tickerArr = ['VOO', 'AAPL'];
    alpaca.getLatestTrades(tickerArr).then(data => {
        for (var [key, objVal] of data.entries()) {
            console.log(objVal);
        }
    });
})

module.exports = router;