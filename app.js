var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
var cors = require("cors");
const bodyParser = require("body-parser");

// using mongoose instead of monk as monk has trouble interacting with cloud databases and can't do db credential caching
const mongoose = require('mongoose');

// endpoint routing
var exploreRouter = require('./routes/explore');
var stocksRouter = require('./routes/stocks');
var indexesRouter = require('./routes/indexes');
var portfolioRouter = require('./routes/portfolio');
var othersRouter = require('./routes/others');

var app = express();

// connect to cloud db
var url = 'mongodb+srv://general-user:thisisaprototype@testcluster.rc6pk.mongodb.net/startupDB?retryWrites=true&w=majority';
mongoose.connect(url, {useNewUrlParser: true, useUnifiedTopology: true}).then((res) => {
  var server = app.listen(3001, function () {
    var host = server.address().address;
    var port = server.address().port;
    console.log("Server listening at http://%s:%s", host, port);
  });
}).catch((err) => {
  console.log(err.message);
})

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(cors());  // not using credentials, so no need to specify that in the client requests
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static('public'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// routing destinations, as specified in the Google Docs
app.use('/', othersRouter);
app.use('/explore', exploreRouter);
app.use('/portfolio', portfolioRouter);
app.use('/stocks', stocksRouter);
app.use('/indexes', indexesRouter);

app.use(function (req, res, next) {
  req.db = db;
  next();
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page 
  res.status(err.status || 500);
  res.render('error');
});
