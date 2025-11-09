const axios = require("axios");
const redis = require("../wssrv/redis");
const socket = require("../wssrv/socket");

class Config {
    constructor() {
        console.log("creating config");
        this.events = {};
        this.config = {
            sports: ["soccer"],
            leagues: [""],
            marketGroups: [6, 10561, 10161, 1777, 10001, 11, 1778],
            maxPerBrowser: 50,
            timeRanges: [[30, 45], [70, 89]],
            minOdd: 25,
            stakeRules: [[29, 1], [34, 2], [41, 3], [999, 4]],
            redCardRules: [[999, 0], [0, 1], [1, 2], [2, 4]],
            telegramChat: -321567507,
            telegramToken: '1393820621:AAGnns90SlebOv_fUMUSTH26zJF6xqokQZg',
            checkCriteria: this.checkCriteria,
            timeoutEvent: this.timeoutEvent,
            deleteEvent: this.deleteEvent
        }

        this.getRedisSavedConfig();
    }

    async getRedisSavedConfig() {
        let config = await redis.getAsync("config");
        if (config) {
            this.config = JSON.parse(config);
        }
    }

    setConfig(config) {
        this.config = config;
        redis.setAsync("config", JSON.stringify(config));
    }

    async checkCriteria(changes) {
        let {
            eventId,
            group,
            participantId,
            odd,
            suspended,
        } = changes;

        let redisResults = await getRedisInfo(eventId);
        if (!redisResults) {
            return;
        }
        changes = { ...changes, ...redisResults };

        let event = this.events[eventId] || new Event(eventId);
        this.events[eventId] = event;
        if (!event.isEmptyRecord()) {
            let lastRecord = event.getLastRecord();
            // if same id
            if (lastRecord.participantId === participantId) {
                // if suspended. cancel emittion 
                if (suspended) {
                    clearTimeout(event.sendAfterTimeout);
                    return false;
                }
                // if odd has dropped.  cancel emittion
                if (lastRecord.odd > odd) {
                    clearTimeout(event.sendAfterTimeout)
                }
            }

            // if dummy insert, return 
            if (lastRecord.odd === 999) {
                return false;
            }

            // if new odd not higher
            if (lastRecord.odd >= odd) {
                // if (lastRecord.odd == odd && (group === "10001" || group === "11" || group === "6")) {
                //     // new odd === lastOdd AND its now a handicap ... keep going bcs handicap is priority
                // } else {
                return false;
                //}

            }

            // if score has changed, cancel emittion and clear records
            if (lastRecord.score !== changes.score) {
                // lastRecord.score = changes.score;
                // timeoutEvent(eventId, 'score', changes.score);
                return false;
            }

            // penalty occured, timeout for 3 minutes (insert dummy record with high odd)
            if (lastRecord.penalties !== changes.penalties) {
                // lastRecord.penalties = changes.penalties;
                // timeoutEvent(eventId, 'penalty', changes.penalties);
                return false;
            }

        }

        if (!suspended && this.redCardsCriteria(changes.redCards)) {
            let meetsCriteria;
            switch (group) {
                case "1778":
                    meetsCriteria = this.nextGoalCriteria(changes);
                    break;
                case "10161":
                    meetsCriteria = this.halftimeResult(changes);
                    break;
                case "1777":
                    meetsCriteria = this.fulltimeResult(changes);
                    break;
                case "10001":
                    meetsCriteria = this.fulltimeCorrectScore(changes);
                    break;
                case "10561":
                    meetsCriteria = this.halftimeCorrectScore(changes);
                    break;
                case "10001":
                    meetsCriteria = this.fulltimeHandicap(changes);
                    break;
                case "11":
                    meetsCriteria = this.fulltimeHandicap(changes);
                    break;
                case "6":
                    meetsCriteria = this.halftimeHandicap(changes);
                    break;
            }

            if (meetsCriteria) {
                event.record.push(changes);
                clearTimeout(event.sendAfterTimeout);
                event.sendAfterTimeout = setTimeout(() => {
                    let scorePromise = getScore(eventId);
                    let penaltiesPromise = getStatSum(eventId, 'IPenalty');
                    scorePromise.then((score) => {
                        if (score === changes.score) {
                            return true;
                        } else {
                            throw Error(eventId, 'EMITTION-SCORE-CHANGED');
                        }
                    })

                    penaltiesPromise.then((penalties) => {
                        if (penalties === changes.penalties) {
                            return true;
                        } else {
                            throw Error(eventId, 'EMITTION-PENALTIES-CHANGED');
                        }
                    })

                    Promise.all([scorePromise, penaltiesPromise]).then(() => {
                        this.sendTelegram(changes);
                        let stake = this.getStake(odd, changes.redCards);
                        changes.stake = stake;
                        changes.resolved = makeBetItem(changes);
                        console.log(eventId, changes);
                        if (changes.stake) {
                            socket.socket && socket.socket.emit("scanner", changes);
                        }



                    }).catch((err) => {
                        console.log(err);
                    })

                }, 4000);
            }
        }
    }

    redCardsCriteria(redCards) {
        return redCards < this.config.redCardRules[0][0];
    }


    getStake(odd, redCards) {
        let stake;
        let stakeDiv;

        for (const stakeRule of this.config.stakeRules) {
            let [oddRule, value] = stakeRule;
            if (odd <= oddRule) {
                stake = value;
                break;
            }
        }

        for (const redCardRule of this.config.redCardRules) {
            let [difRule, value] = redCardRule;
            if (redCards <= difRule && value !== 0) {
                stakeDiv = value;
                break;
            }
        }

        return parseFloat((stake / stakeDiv).toFixed(2));

    }

    timeoutEvent(id, reason, timeoutMills) {
        if (this.events[id]) {
            let event = this.events[id];
            console.log(id, reason);
            event.insertDummy(timeoutMills);
            clearTimeout(event.sendAfterTimeout);
        }
    }

    deleteEvent(id) {
        if (this.events[id]) {
            clearTimeout(this.events[id].sendAfterTimeout);
            clearTimeout(this.events[id].resetTimeout);
            delete this.events[id];
        }
    }

    // 10001
    fulltimeCorrectScore({ score, odd, fieldLabel, header, gametimer }) {
        if (header.includes("2")) {
            fieldLabel = fieldLabel.split("-").reverse().join("-");
        }
        let [hScore, aScore] = score.split("-").map(s => parseInt(s));
        let minutes = parseInt(gametimer.split(":")[0]);
        if (odd >= this.config.minOdd && minutes > this.config.timeRanges[0][1]) {
            let homeToScore = `${hScore + 1}-${aScore}`
            let awayToScore = `${hScore}-${aScore + 1}`
            return fieldLabel === homeToScore || fieldLabel === awayToScore;
        }
    }

    // 6
    halftimeHandicap({ score, participants, odd, handicap, header, gametimer }) {
        if (header.includes("Draw")) {
            return false;
        }
        let [hScore, aScore] = score.split("-").map(s => parseInt(s));
        let [home, away] = participants.split(" v ");
        let minutes = parseInt(gametimer.split(":")[0]);
        if (odd >= this.config.minOdd && minutes <= this.config.timeRanges[0][1]) {
            let scoreDif = hScore - aScore;
            if (scoreDif > 0) {
                return header.includes(home) && handicap === ("-" + scoreDif.toString()) ||
                    header.includes(away) && handicap === ("+" + scoreDif.toString());
            } else if (scoreDif < 0) {
                scoreDif = scoreDif * -1;
                return header.includes(away) && handicap === ("-" + scoreDif.toString()) ||
                    header.includes(home) && handicap === ("+" + scoreDif.toString());
            }
        }
    }

    // 10001
    fulltimeHandicap({ score, participants, odd, handicap, header, gametimer }) {
        if (header.includes("Draw")) {
            return false;
        }
        let [hScore, aScore] = score.split("-").map(s => parseInt(s));
        let [home, away] = participants.split(" v ");
        let minutes = parseInt(gametimer.split(":")[0]);
        if (odd >= this.config.minOdd && minutes > this.config.timeRanges[0][1]) {
            let scoreDif = hScore - aScore;
            if (scoreDif > 0) {
                return header.includes(home) && handicap === ("-" + scoreDif.toString()) ||
                    header.includes(away) && handicap === ("+" + scoreDif.toString());
            } else if (scoreDif < 0) {
                scoreDif = scoreDif * -1;
                return header.includes(away) && handicap === ("-" + scoreDif.toString()) ||
                    header.includes(home) && handicap === ("+" + scoreDif.toString());
            }
        }
    }

    sendTelegram({ participants, participantId, fixtureId, score, odd, gametimer, title, header, handicap, fieldLabel }) {
        let label = fieldLabel.length > 0 ? fieldLabel : handicap.length > 0 ? handicap : "";
        if (title.includes("Final Score") || title.includes("Correct Score")) {
            header = "";
            label = label.split("-").reverse().join("-");
        }

        let outcome_link_com = `https://www.bet365.com/dl/sportsbookredirect?bs=${fixtureId}-${participantId}~${odd}&bet=1`
        let message = `${gametimer} ${participants}\n` +
            `Score: ${score}\n` +
            `${title} ${header} ${label} ${odd}\n` +
            `${outcome_link_com}`;

        let payload = {
            chat_id: this.config.telegramChat,
            text: message
        }

        axios.post(`https://api.telegram.org/bot${this.config.telegramToken}/sendMessage`, payload);
    }



    // 1778
    nextGoalCriteria({ participants, odd, header }) {
        return odd >= this.config.minOdd && participants.includes(header)
    }

    // 10161
    halftimeResult({ score, odd, header, gametimer }) {
        let [hScore, aScore] = score.split("-").map(s => parseInt(s));
        let minutes = parseInt(gametimer.split(":")[0]);
        if (odd >= this.config.minOdd && minutes <= this.config.timeRanges[0][1]) {
            let scoreDif = hScore - aScore;
            if (scoreDif === -1 || scoreDif === 1) { // if home, away loses by 1 goal
                return header.includes('Draw')
            } else if (scoreDif === 0) {
                return !header.includes('Draw');
            }
        }

        return false;
    }

    // 1777
    fulltimeResult({ score, odd, header, gametimer }) {
        let [hScore, aScore] = score.split("-").map(s => parseInt(s));
        let minutes = parseInt(gametimer.split(":")[0]);
        if (odd >= this.config.minOdd && minutes > this.config.timeRanges[0][1]) {
            let scoreDif = hScore - aScore;
            if (scoreDif === -1 || scoreDif === 1) { // if home, away loses by 1 goal
                return header.includes('Draw')
            } else if (scoreDif === 0) {
                return !header.includes('Draw');
            }
        }
        return false;
    }

    // 10561
    halftimeCorrectScore({ score, odd, fieldLabel, header, gametimer }) {
        if (header.includes("2")) {
            fieldLabel = fieldLabel.split("-").reverse().join("-");
        }
        let [hScore, aScore] = score.split("-").map(s => parseInt(s));
        let minutes = parseInt(gametimer.split(":")[0]);
        if (odd >= this.config.minOdd && minutes <= this.config.timeRanges[0][1]) {
            let homeToScore = `${hScore + 1}-${aScore}`
            let awayToScore = `${hScore}-${aScore + 1}`
            return fieldLabel === homeToScore || fieldLabel === awayToScore;
        }
    }

}



function makeBetItem(data) {
    let constructString = `pt=N#o=${data.fractionOdd}#f=${data.fixtureId}#fp=${data.participantId}` +
        (data.handicap.length > 0 ? `#ln=${data.handicap}` : "") +
        `#id=${data.fixtureId}-${data.participantId}#|TP=BS${data.fixtureId}-${data.participantId}`;
    return {
        betsource: "1",
        classificationId: "1",
        constructString: constructString,
        decimalPlaces: 2,
        fixtureId: data.fixtureId,
        handicap: data.handicap,
        marketId: data.group,
        odds: data.odd,
        oddsTypeOverride: 0,
        partType: "N",
        participantId: data.participantId,
        pom: "0",
        subscribe: true,
        uid: `${data.fixtureId}-${data.participantId}`
    }
}

async function getScore(eventId) {
    let res = await redis.hgetAsync(eventId, `score`);
    if (!res) {
        throw Error(`${eventId} score: NOT FOUND`);
    }
    return res;
}

async function getParticipants(eventId) {
    let res = await redis.hgetAsync(eventId, `participants`);
    if (!res) {
        throw Error(`${eventId} participants: NOT FOUND`);
    }
    return res;
}

async function getGametimer(eventId) {
    let res = await redis.hgetAsync(eventId, `gametimer`);
    if (!res) {
        throw Error(`${eventId} gametimer: NOT FOUND`);
    }
    return res;
}

async function getStatSum(eventId, stat) {
    let h = await redis.hgetAsync(eventId, `stats:${stat}:0`) || 0;
    let a = await redis.hgetAsync(eventId, `stats:${stat}:1`) || 0;

    return parseInt(h) + parseInt(a);
}

async function getStatDif(eventId, stat) {
    let h = await redis.hgetAsync(eventId, `stats:${stat}:0`) || 0;
    let a = await redis.hgetAsync(eventId, `stats:${stat}:1`) || 0;

    return Math.abs(parseInt(h) - parseInt(a));
}

async function getRedisInfo(eventId) {
    try {
        let score = getScore(eventId);
        let participants = getParticipants(eventId);
        let gametimer = getGametimer(eventId);
        let penalties = getStatSum(eventId, 'IPenalty');
        let redCards = getStatDif(eventId, 'IRedCard');
        let results = await Promise.all([score, participants, gametimer, penalties, redCards]);
        return {
            score: results[0],
            participants: results[1],
            gametimer: results[2],
            penalties: results[3],
            redCards: results[4]
        }
    } catch (ex) {
        // console.log(ex);
        return null;
    }


}


class Event {
    constructor(id) {
        this.id = id;
        this.record = [];
        this.ttl = 3 * 60 * 1000;
        this.resetTimeout = setTimeout(() => { }, 0);
        this.sendAfterTimeout = setTimeout(() => { }, 0);
    }

    reset(timeoutMills) {
        clearTimeout(this.resetTimeout);
        this.resetTimeout = setTimeout(() => {
            console.log(this.id, "reset")
            this.record = []
        }, timeoutMills)
    }

    isEmptyRecord() {
        return this.record.length === 0;
    }

    getLastRecord() {
        return this.record[this.record.length - 1];
    }

    insertDummy(timeoutMills) {
        this.record = [];
        this.record.push({ odd: 999 });
        this.reset(timeoutMills);
    }

}


module.exports = new Config();
