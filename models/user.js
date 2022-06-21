const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// the schema we're using on MongoDB atlas
const userSchema = new Schema({
    userName: String,
    email: String,
    password: String,
    country: String,
    cashAvailable: Number,
    stocks: [{
        name: String,
        ticker: String,
        amount: Number,
        avgPrice: Number
    }],
    indexes: [{
        nameOfIndex: String,
        index: [{
            ticker: String,
            proportion: Number,
            amount: Number,
            avgPrice: Number
        }]
    }],
    watchList: [String]
});

module.exports = mongoose.model('User', userSchema);