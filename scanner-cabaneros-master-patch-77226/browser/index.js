const path = require("path");
const puppeteer = require("puppeteer");

exports.createBrowser = async () => {
    let browser = await puppeteer.launch({
        devtools: false,
        headless: true,
        defaultViewport: {
            width: 1024,
            height: 768,
        },
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--disable-gpu"
        ],
    });

    let page = await browser.newPage();
    page = await preparePageForEvaluation(page);

    return { browser, page };
}

async function preparePageForEvaluation(page) {
    try {
        // Pass the User-Agent Test.
        const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.39 Safari/537.36'
        await page.setUserAgent(userAgent)

        // Pass the Webdriver Test.
        await page.evaluateOnNewDocument(() => {
            // eslint-disable-next-line no-undef
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            })
        })

        await page.evaluateOnNewDocument(async () => {
            const doc = document;

            defaultFunctions = {
                'querySelector': doc.querySelector,
                'querySelectorAll': doc.querySelectorAll,
                'getElementsByClassName': doc.getElementsByClassName,
                'getElementsByName': doc.getElementsByName,
                'getElementsByTagNameNS': doc.getElementsByTagNameNS,
                'getElementsByTagName': doc.getElementsByTagName
            }

            await new Promise((resolve) => {
                setTimeout(() => {
                    let doc = document
                    for (const key in defaultFunctions) {
                        const defaultFunction = defaultFunctions[key];
                        doc[key] = defaultFunction
                    }
                    resolve();
                }, 1000)
            })
        })


        // Pass the Chrome Test.
        await page.evaluateOnNewDocument(() => {
            // eslint-disable-next-line no-undef
            window.navigator.chrome.runtime = {}
        })

        // Pass the Permissions Test.
        await page.evaluateOnNewDocument(() => {
            const originalQuery = window.navigator.permissions.query
            return window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({
                        state: Notification.permission
                    }) :
                    originalQuery(parameters)
            )
        })

        // Pass the Plugins Length Test.
        await page.evaluateOnNewDocument(() => {
            // Overwrite the `plugins` property to use a custom getter.
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5],
            })
        })

        // Pass the Languages Test.
        await page.evaluateOnNewDocument(() => {
            // Overwrite the `plugins` property to use a custom getter.
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en'],
            })
        })

        page.on("console", (consoleObj) => {
            if (consoleObj.text().indexOf("BLOB") === -1) {
                console.log(consoleObj.text());
            }
        });

    } catch (error) {
        console.log(error);
    }
    return page
}

// async function preparePageForEvaluation(page) {
//     try {
        // page.on("console", (consoleObj) => {
        //     if (consoleObj.text().indexOf("BLOB") === -1) {
        //         console.log(consoleObj.text());
        //     }
        // });
//         // Pass the Webdriver Test.
//         await page.evaluateOnNewDocument(() => {
//             // eslint-disable-next-line no-undef
//             Object.defineProperty(navigator, "webdriver", {
//                 get: () => undefined
//             });
//         });

//         // Pass the Permissions Test.
//         await page.evaluateOnNewDocument(() => {
//             const originalQuery = window.navigator.permissions.query;
//             return (window.navigator.permissions.query = (parameters) =>
//                 parameters.name === "notifications"
//                     ? Promise.resolve({
//                         state: Notification.permission,
//                     })
//                     : originalQuery(parameters));
//         });        

//     } catch (error) {
//         //
//     }
//     return page;
// };


