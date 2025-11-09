const config = require("../config")[process.env.config];
const redis = require("../wssrv/redis");

module.exports = class Mutator {
    constructor(page) {
        this._page = page;
    }

    async exposeFunctions() {
        try {
            await this._page.exposeFunction("setScore", this.setScore);
            await this._page.exposeFunction("setInfo", this.setInfo);
            await this._page.exposeFunction("setMarket", this.setMarket);
            await this._page.exposeFunction("setGametimer", this.setGametimer);
            await this._page.exposeFunction("setAdditionalInfo", this.setAdditionalInfo);
        } catch (ex) {
            // console.log(ex);
        }
    }

    async mutateEventInfo(eventId) {
        await this.exposeFunctions();
        return this._page.evaluate((eventId, config) => {
            function getGametimer(data) {
                let { TU, TM, TS, TT, TD } = data;
                TM = parseInt(TM);
                TS = parseInt(TS);
                TT = TT === "0" ? false : true;
                TD = TD === "0" ? false : true;
                let gametimer = new window.ns_gametimerlib.GameTimer();
                gametimer.updateTimerValues(TU, TM, TS, TT, TD);
                return gametimer.generateTimerString();
            }

            let referenceId = eventId.substring(0, eventId.length - 1) + "1";
            let eventObject = Locator.treeLookup._table[referenceId];
            if (!eventObject)
                return;

            if (!eventObject.evaled) {
                if (!Locator.subscriptionManager.attachedEvents) {
                    Locator.subscriptionManager.attachedEvents = [];
                }

                if (!Locator.subscriptionManager.attachedEvents.includes(referenceId)) {
                    Locator.subscriptionManager.attachedEvents.push(referenceId);
                }

                eventObject.evaled = true;
                let oldUpdate = eventObject.update;
                let oldInsert = eventObject.insert;

                eventObject.update = function () {
                    if (arguments[0].SS) {
                        setScore(eventId, arguments[0].SS);
                        setGametimer(eventId, getGametimer(this.data));
                    }
                    return oldUpdate.apply(this, arguments);
                }
                oldInsert.insert = function () {
                    if (arguments[0].SS) {
                        setScore(eventId, arguments[0].SS);
                        setGametimer(eventId, getGametimer(this.data));
                    }
                    return oldInsert.apply(this, arguments);
                }

                setScore(eventId, eventObject.data.SS);
                setGametimer(eventId, getGametimer(eventObject.data))
                setInfo(eventId, eventObject.data.CL, eventObject.data.CT, eventObject.data.NA);
            }


            let additionalData = eventObject.additionalScores[0]._actualChildren.filter(f => f.data.NA.length);
            for (const additionalField of additionalData) {
                let values = additionalField._actualChildren;
                for (const value of values) {
                    if (!value.evaled) {
                        value.evaled = true;
                        let oldInsert = value.insert;
                        let oldUpdate = value.update;

                        value.insert = function () {
                            if (arguments[0].D1) {
                                setAdditionalInfo(eventId, this.parent.data.NA, this.data.ID, arguments[0].D1)
                            }
                            return oldInsert.apply(this, arguments);
                        }

                        value.update = function () {
                            if (arguments[0].D1) {
                                setAdditionalInfo(eventId, this.parent.data.NA, this.data.ID, arguments[0].D1)
                            }
                            return oldUpdate.apply(this, arguments);
                        }

                        setAdditionalInfo(eventId, value.parent.data.NA, value.data.ID, value.data.D1)

                    }

                }
            }

            let markets = eventObject._actualChildren;
            if (config.marketGroups.length > 0) {
                markets = eventObject._actualChildren.filter((market) =>
                    config.marketGroups.includes(parseInt(market.data.ID)));
            }

            for (const market of markets) {
                let marketGroup = market.data.ID;
                let title = market.data.NA;
                let columns = [...market._actualChildren];
                let labels = undefined;
                if (columns[0].data.NA && columns[0].data.NA.trim().length === 0) {
                    labels = columns.splice(0, 1)[0]._actualChildren;
                }
                for (const column of columns) {
                    const fields = column._actualChildren;
                    for (const field of fields) {
                        if (!field.evaled) {
                            field.evaled = true;
                            let oldInsert = field.insert;
                            let oldUpdate = field.update;
                            let oldRemove = field.remove;
                            let label = "";
                            if (labels) {
                                label = labels[parseInt(field.data.OR)].data.NA;
                            }

                            let header = "";
                            if (field.parent) {
                                header = field.parent.data.NA || field.data.NA;
                            }

                            let fixedData = {
                                group: marketGroup,
                                title: title.trim(),
                                label: label.trim(),
                                header: header.trim()
                            }

                            // change insert function
                            field.insert = function () {
                                setMarket(eventId, fixedData, arguments[0], this.data);
                                setGametimer(eventId, getGametimer(eventObject.data))
                                return oldInsert.apply(this, arguments);
                            }

                            // change update function
                            field.update = function () {
                                setMarket(eventId, fixedData, arguments[0], this.data);
                                setGametimer(eventId, getGametimer(eventObject.data))
                                return oldUpdate.apply(this, arguments);
                            }

                            field.remove = function () {
                                fixedData.remove = true;
                                setMarket(eventId, fixedData, arguments[0], this.data);
                                setGametimer(eventId, getGametimer(eventObject.data))
                                return oldRemove.apply(this, arguments);
                            }

                            setMarket(eventId, fixedData, {}, field.data);
                            setGametimer(eventId, getGametimer(eventObject.data))
                        }
                    }
                }
            }


        }, eventId, config.config)
    }

    async setScore(eventId, score) {
        if (config.timeoutEvent) {
            let scoreExists = await redis.hgetAsync(eventId, `score`);
            if (scoreExists && scoreExists !== score) {
                let timeoutMills = 1000;
                config.timeoutEvent(eventId, "Score", timeoutMills);
            }
        }
        redis.hsetAsync(eventId, 'score', score)
        redis.expire(eventId);
    }

    setInfo(eventId, sportId, league, participants) {
        redis.hsetAsync(eventId, 'participants', participants)
        redis.hsetAsync(eventId, 'sport', sportId)
        redis.hsetAsync(eventId, 'league', league)

        redis.expire(eventId);
    }

    async setAdditionalInfo(eventId, title, side, value) {
        if (config.timeoutEvent) {
            if (title.includes("Penalty")) {
                let penaltyExists = await redis.hgetAsync(eventId, `stats:${title}:${side}`);
                if (penaltyExists && penaltyExists !== value) {
                    let timeoutMills = 2 * 60 * 1000;
                    config.timeoutEvent(eventId, "Penalty", timeoutMills);
                }
            }

        }

        redis.hsetAsync(eventId, `stats:${title}:${side}`, value);
        redis.expire(eventId);
    }

    async setMarket(eventId, marketData, args, field) {
        if (field.OD || args.OD) {
            let betSlipId = args.ZW || field.ZW;
            let [fixtureId, participantId] = betSlipId.split("-");
            let handicap = field.HD ? args.HD || field.HD : "";
            let suspended = Boolean(parseInt(args.SU || field.SU))
            let fractionOdd = args.OD || field.OD;
            let fieldLabel = field.NA || "";
            let odd = 0;
            if (fractionOdd) {
                odd = parseFloat(eval(`${fractionOdd} + 1`).toFixed(2));
            } else if (!fractionOdd || fractionOdd === "SP") {
                suspended = true;
            }
            marketData = {
                ...marketData,
                fixtureId,
                participantId,
                handicap: handicap.trim(),
                odd,
                fieldLabel: fieldLabel.trim(),
                fractionOdd,
                suspended,
                timestamp: Date.now()
            }

            let redisMarket = await redis.hgetAsync(eventId, `market:${marketData.group}:${participantId}`);
            if (redisMarket) {
                redisMarket = JSON.parse(redisMarket);
                marketData.prevOdd = redisMarket.odd;
            }

            await redis.hsetAsync(eventId, `market:${marketData.group}:${participantId}`, JSON.stringify(marketData))
            redis.expire(eventId);
            config.checkCriteria({ eventId, ...marketData });

        } else {
            // let label = parent.NA;
            // marketData = {
            //     ...marketData,
            //     label,
            // }
        }
    }

    setGametimer(eventId, gametimer) {
        redis.hsetAsync(eventId, 'gametimer', gametimer)
        redis.expire(eventId);
    }
}
