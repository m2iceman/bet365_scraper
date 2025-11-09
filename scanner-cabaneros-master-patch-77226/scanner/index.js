const Browser = require("../browser");
const Bet365Page = require("../b365/page.js");
const config = require("../config")[process.env.config];

class Scanner {
    constructor() {
        this.pages = [];
        this.createBrowser();
        this.attachEvents();
    }

    async createBrowser(preAttachedEvents = []) {
        console.log(`Opening Browser (${this.pages.length + 1})`)
        const { browser, page } = await Browser.createBrowser();
        const b365Page = new Bet365Page(browser, page, preAttachedEvents);
        this.pages.push(b365Page);

        return b365Page;
    }

    getEvents() {
        // iterate to each page and get it's last stored events
        // this will give us most of the time ALL the matches
        let allEvents = [];
        for (const page of this.pages) {
            for (const event of page._events) {
                event !== undefined &&
                    !allEvents.includes(event) &&
                    allEvents.push(event)
            }
        }

        return allEvents;
    }

    getBusyBrowser() {
        let mostBusy = { attachedEvents: -1, page: null };
        for (const page of this.pages) {
            if (page._attachedEvents.length < config.config.maxPerBrowser &&
                page._attachedEvents.length > mostBusy.attachedEvents) {
                mostBusy = { attachedEvents: page._attachedEvents.length, page };
            }
        }

        return mostBusy;
    }

    closeEmptyBrowsers() {
        if (this.pages.length === 1) {
            return;
        }
        for (let i = 0; i < this.pages.length; i++) {
            let page = this.pages[i];
            if (page._attachedEvents.length === 0) {
                page.terminate();
                this.pages.splice(i, 1);
                console.log(`Terminated Browser (${this.pages.length + 1})`)
            }
        }

    }

    eventExists(event) {
        for (const page of this.pages) {
            if (page._attachedEvents.includes(event)) {
                return true;
            }
        }
        return false;
    }

    async attachEvents() {
        if (this.pages.length) {
            // loop each event and check if its attached to any page       
            for (const event of this.getEvents()) {
                // if its not attached
                if (!this.eventExists(event)) {
                    let busyBrowser = this.getBusyBrowser();
                    if (busyBrowser.page) {
                        busyBrowser.page._attachedEvents.push(event);
                        console.log("Event Pushed", event, this.pages.map(pg => pg._attachedEvents.length));
                    } else {
                        await this.createBrowser([event]);

                    }
                    break;
                }

                this.closeEmptyBrowsers();
            }
        }

        setTimeout(() => this.attachEvents(), 1000);

    }
}


module.exports = Scanner;