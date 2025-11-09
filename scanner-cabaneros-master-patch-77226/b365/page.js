const redis = require("../wssrv/redis.js");
const Mutator = require("./mutator");
const config = require("../config")[process.env.config];

class Page {
    constructor(browser, page, preattachedEvents = null) {
        this._events = [];
        this._attachedEvents = preattachedEvents || [];
        this._mutator = new Mutator(page);
        this._browser = browser;
        this._page = page;
        this.preparePage();
        this.terminated = false;
    }

    terminate() {
        this._browser.close();
        this.terminated = true;
    }

    async preparePage() {
        // block unsubscriptions
        await this._page.evaluateOnNewDocument(() => {
            setTimeout(() => {
                Locator.subscriptionManager.unsubscribeDeferralPeriodMS = 1000 * 9999;
                let oldUnsub = Locator.subscriptionManager.unsubscribe;
                Locator.subscriptionManager.unsubscribe = function () {
                    if (this.attachedEvents && this.attachedEvents.includes(arguments[0])) {
                        return;
                    }
                    return oldUnsub.apply(this, arguments);
                }
            }, 4000);
        });
        await this._page.goto("http://www.bet365.com");
        await this.changeToEnglish();
        await this._page.goto("http://www.bet365.com/#/IP/");
        setTimeout(() => this.iterateEvents(), 0);
    }

    async gotoInPlay() {
        return this._page.evaluate(() => {
            document.querySelector("div.ipe-EventHeader_Breadcrumb") &&
                document.querySelector("div.ipe-EventHeader_Breadcrumb").click();
        })
    }

    async changeToEnglish() {
        // change to english
        await this._page.waitFor(2000);
        await this._page.evaluate(() => {
            window.ns_gen5_util.CookieManager.SetCookieValue("aps03", "lng", "1");
            window.location.reload();
        })
        await this._page.waitFor(2000);
    }

    async getInPlayEvents() {
        return this._page.evaluate(async (config) => {
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
            function inTimeRange(timer) {
                if (!timer || timer.length === 0) {
                    return false;
                }
                minutes = timer.match(/([0-9]{1,3}):[0-9]{1,3}/)[1];
                if (minutes) {
                    minutes = parseInt(minutes);
                    halftimeRange = config.timeRanges[0];
                    fulltimeRange = config.timeRanges[1];
                    if (minutes >= fulltimeRange[0] && minutes <= fulltimeRange[1])
                        return true;

                    if (minutes >= halftimeRange[0] && minutes <= halftimeRange[1])
                        return true;
                }
                return false;
            }
            let events = [];
            let sports = [...document.querySelectorAll("div.ovm-ClassificationBar_Contents > div")];
            if (config.sports.length > 0) {
                sports = sports.filter((sp) => {
                    for (const sport of config.sports) {
                        if (sp.textContent.toLowerCase().includes(sport.toLowerCase()))
                            return true;
                    }
                    return false;
                });
            } else {
                sports = sports.splice(0, sports.length - 2)
            }

            for (const sport of sports) {
                sport.click();
                await new Promise((resolve) => setTimeout(() => resolve(), 2000));
                document.querySelector("div.ovm-OverviewScroller.ovm-OverviewScroller-enabled").scrollTo(0, 200)
                await new Promise((resolve) => setTimeout(() => resolve(), 1000));

                let sportEvents = [...document.querySelectorAll("div.ovm-OverviewView_Classification div.ovm-Fixture")]
                sportEvents = sportEvents.filter((ev) => {
                    for (const league of config.leagues) {
                        let timer = getGametimer(ev.wrapper.stem.data);
                        if (ev.wrapper.stem.data.CT.includes(league) && inTimeRange(timer)) {
                            return true;
                        }
                    }
                    return false;
                })
                events.push(...sportEvents.map(ev => "6V" + ev.wrapper.stem.data.ID));
            }

            return events;

        }, config.config);
    }

    async eventIsCached(eventId) {
        // if event is found in tree, it means its cached ....
        // eventId is slightly different on the tree, we add number '1' in the end 
        return this._page.evaluate((eventId) => {
            return Locator.treeLookup._table[eventId.substring(0, eventId.length - 1) + "1"] !== undefined;
        }, eventId)
    }

    // subscribeEvent to b365 websocket
    async subscribeEvent(eventId) {
        return this._page.evaluate((eventId) => {
            let eventElement = [...document.querySelectorAll(
                "div.ovm-OverviewView_Classification div.ovm-Fixture"
            )].filter(match => match.wrapper.stem.data.ID === eventId)[0]
            Locator.subscriptionManager.subscribe(eventId, eventElement);
            Locator.subscriptionManager.subscribe(eventId.substring(0, eventId.length - 1) + "1")
        }, eventId)
    }

    async mutateCachedEvent(eventId) {
        try {
            await this._mutator.mutateEventInfo(eventId);
        } catch (ex) {
            console.log("mutateCachedEvent:ERROR");
        }
    }

    async removeEvent(eventId) {
        let participants = await redis.hgetAsync(eventId, 'participants');
        this._attachedEvents.splice(this._attachedEvents.indexOf(eventId), 1);
        config.deleteEvent(eventId);
        redis.delAsync(eventId);
        console.log("Event Removed", eventId, participants);
        this._page.evaluate((eventId) => {
            let referenceId = eventId.substring(0, eventId.length - 1) + "1";
            if (Locator.subscriptionManager.attachedEvents) {
                let index = Locator.subscriptionManager.attachedEvents.indexOf(referenceId);
                if (index !== -1) {
                    Locator.subscriptionManager.attachedEvents.splice(index, 1);
                    Locator.treeLookup.removeReference(referenceId);
                }
            }

        }, eventId)
    }



    async iterateEvents() {
        try {
            await this._page.waitFor(2000);
            await this.gotoInPlay();
            await this._page.waitFor(500);
            this._events = await this.getInPlayEvents();

            for (const eventId of [...this._attachedEvents]) {
                if (!eventId)
                    continue;

                if (!this._events.includes(eventId)) {
                    this.removeEvent(eventId);
                    continue;
                }

                if (!await this.eventIsCached(eventId)) {
                    this.subscribeEvent(eventId);
                    await this._page.waitFor(1000);
                }

                this.mutateCachedEvent(eventId);
            }

        } catch (ex) {
            if (this.terminated) {
                console.log("browser:TERMINATED");
                return;
            } else {
                console.log("iterateEvents:ERROR");
            }
        }

        setTimeout(() => this.iterateEvents(), 0);

    }
}

module.exports = Page;
