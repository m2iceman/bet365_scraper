const username = process.env.socketUsername;
const password = process.env.socketPassword;
const ip = process.env.socketIp;
const io = require("socket.io-client");
const cookie = require("cookie");
const axios = require("axios");
const { v4: uuidv4 } = require('uuid');

async function login() {
    const payload = { username, password };
    try {
        const res = await axios.post(ip + "/api/users/login", payload);
        return cookie.parse(res.headers["set-cookie"][0]).token;
    } catch (ex) {
        console.log(ex);
        process.exit(0);
    }
}

class SocketIo {
    constructor() {
        if (ip) {
            login().then((token) => {
                let id = uuidv4();
                this.socket = io.connect(ip,
                    {
                        transportOptions: {
                            polling: {
                                extraHeaders: {
                                    'token': token,
                                    'role': "scanner",
                                    'id': id
                                }
                            }
                        }
                    }
                );
                this.socket.on('connect', () => {
                    console.log("connected");
                    this.socketConnect()
                    this.config = require("../config")[process.env.config];
                })
            })
        }
    }

    closeListener() {
        this.socket.disconnect()
    }


    socketConnect() {
        this.socket.on('disconnect', function () {
            console.log('disconnected');
        })

        this.socket.on("set-scanner-config", (newConfig) => {
            this.config.setConfig(newConfig);
        })

        this.socket.on("scanner-config", () => {
            this.socket.emit("scanner-config", this.config.config);
        })


    }
}

socket = new SocketIo();

module.exports = socket;