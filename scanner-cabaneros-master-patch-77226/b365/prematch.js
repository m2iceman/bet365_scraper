function decodeOdd(t, e) {
    let C = {};
    e = String.fromCharCode(e.charCodeAt(0) ^ e.charCodeAt(1))
    var n, r, s, a, i;
    if (!t || !e)
        return t;
    if (n = t + "%" + e,
        C[n])
        return C[n];
    for (e != i && (C = {},
        i = e),
        r = e.charCodeAt(0),
        s = "",
        a = 0; a < t.length; a++)
        s += String.fromCharCode(t.charCodeAt(a) ^ r);
    return C[n] = s,
        s
}


Locator.subscriptionManager.unsubscribeDeferralPeriodMS = 15000;
let attachedEvents = [];
temp1 = window.location.href.match(/#(\/.+)$/)[1].replaceAll("/", "#");
attachedEvents.push(temp1);

let oldUnsub = Locator.subscriptionManager.unsubscribe;
Locator.subscriptionManager.unsubscribe = function () {
    if (attachedEvents.includes(arguments[0])) {
        console.log(arguments[0], 'where r u going????')
        return;
    }
    console.log(arguments[0], 'go away!!!!')
    return oldUnsub.apply(this, arguments);
}

let ref = Locator.treeLookup.getReference(temp1);

let eventId = 11234;
let markets = ref._actualChildren[0]._actualChildren.slice(1);

for (const market of markets) {
    let marketGroup = market.data.ID;
    let title = market.data.NA;
    let columns = [...market._actualChildren];
    let labels = undefined;
    console.log(market);
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
                    console.log(eventId, fixedData, arguments[0], this.data);
                    return oldInsert.apply(this, arguments);
                }

                // change update function
                field.update = function () {
                    console.log(eventId, fixedData, arguments[0], this.data);
                    return oldUpdate.apply(this, arguments);
                }

                field.remove = function () {
                    fixedData.remove = true;
                    console.log(eventId, fixedData, arguments[0], this.data);
                    return oldRemove.apply(this, arguments);
                }

                console.log(eventId, fixedData, {}, field.data);
            }
        }
    }
}  