setTimeout(() => {
    process.exit(0);
}, 3 * 60 * 60 * 1000)
const config = require("./config")[process.env.config];
const io = require("./wssrv/socket");
const Scanner = require("./scanner");
const scanner = new Scanner();
