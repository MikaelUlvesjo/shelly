let CONFIG = {
    priceApiEndpoint: "https://www.elprisetjustnu.se/api/v1/prices/",   // see https://www.elprisetjustnu.se/elpris-api
    tomorowsPricesAfter: 14, //it will get tomorrows prices and if the time is after 14 for 14:00
    timezone: 1, //in positive or negative value e.g: 1 for CET or -6 for CST
    daylightSaving: true,//boolean, if true and date is after last Sunday in March and Before last Sunday in October 1 hour weill be added to timezone.
    zone: "SE4", // SE1,SE2,SE3 or SE4
    inUseLimit: 5.0, // nr of wats required to consider the controlled unit to be running and to not swith it of for non pm units set this to -1.0 
    updateTime: 300000, // 5 minutes. Price update interval in milliseconds
    switchId: 0, // the id of the switch starts at 0
    allwaysOnMaxPrice: 1.3, // SEK/kWh if the price is below or equal this value the switch should be on no matter if checkNextXHours would turn it off (price without tax or other fees)
    allwaysOffMinPrice: 3.0, // SEK/kWh if the price is above or equal this value the switch should be off no matter if checkNextXHours would turn it on (price without tax or other fees)
    allwaysOnHours: [{ from: 21, to: 23 }], //Time spans when allways on format [{from: 8, to:8},{from: 20, to:23}]
    onOffLimit: 1.1, // is used to set the price limit where to turn on and of switch
    //so if current price > (avg price * onOffLimit)  then turn off
    //and if current price <= (avg price * onOffLimit) then turn on
    checkNextXHours: 1, // check that the price do not go over the limit the next x hours if it is then switch off now,
    // will check until a to price that will switch off or all hour have low price.
    stopAtDataEnd: true,
    // if stopAtDataEnd is false will only check values that exists in the data and if it passes the end of the data it will start from the first value,
    // if stopAtDataEnd is true will only check current days values and if it passes the end of the data it will stop checking more values,
    invertSwitch: false, // invert the switch action. Set inUseLimit: -1.0 to use this.
    debugMode: true, // Set to false to enable switching of power.
};
let prices = [];
let avg = null;
let min = null;
let max = null;
let state = null;
let date = null;
let lastDate = null;
let currentSwitchState = null;
let debugSwitchState = null;
let powerUsage = null;

function start() {
    if (CONFIG.inUseLimit < 0.0) {
        getCurrentDate();
    } else {
        getCurrentUsage();
    }
}

function getCurrentDate() {
    Shelly.call("Sys.GetStatus",
        {
            id: CONFIG.switchId,
        }, processCurrentDate);
}

function processCurrentDate(response, errorCode, errorMessage) {
    if (errorCode !== 0) {
        print(errorMessage);
        return;
    }
    date = epochToDate(response.unixtime, CONFIG.timezone, CONFIG.daylightSaving);
    getCurrentUsage();
}

function getCurrentUsage() {
    Shelly.call("switch.getstatus",
        {
            id: CONFIG.switchId,
        }, processCurrentUsageResponse);
}

function processCurrentUsageResponse(response, errorCode, errorMessage) {
    if (errorCode !== 0) {
        print(errorMessage);
        return;
    }
    currentSwitchState = response.output;
    if (CONFIG.inUseLimit >= 0) {
        powerUsage = response.apower;
        date = epochToDate(response.aenergy.minute_ts, CONFIG.timezone, CONFIG.daylightSaving);
    } else {
        powerUsage = 0.0;
    }
    if (CONFIG.debugMode) {
        debugSwitchState = debugSwitchState === null ? currentSwitchState : debugSwitchState;
        if (currentSwitchState !== debugSwitchState) {
            print("Overiding currentSwitchState (" + (currentSwitchState ? "on" : "off") + ") with debugSwitchState: " + (debugSwitchState ? "on" : "off"));
        }
        currentSwitchState = debugSwitchState;
    }
    if (currentSwitchState === true) {
        if (CONFIG.inUseLimit < 0.0) {
            print("Switch is on");
            getCurrentPrice(0);
        } else if (powerUsage > CONFIG.inUseLimit) {
            print("Switch is on and used, not checking price. Current usage: " + JSON.stringify(powerUsage) + "w");
        } else {
            print("Switch is on and not used. Current usage: " + JSON.stringify(powerUsage) + "w");
            getCurrentPrice(0);
        }
    } else {
        print("Switch is off");
        getCurrentPrice(0);
    }
}

function getCurrentPrice(offset) {
    if (lastDate === null || lastDate.hour > date.hour || prices.length === 0) {
        Shelly.call(
            "http.get",
            {
                url: CONFIG.priceApiEndpoint + date.yearStr + "/" + date.monthStr + "-" + date.dayStr + "_" + CONFIG.zone + ".json",
            }, processCurrentPriceResponse, { offset: offset });
    } else if (offset > 0) {
        let offsetDate = epochToDate(date.epoch + (60 * 60 * offset), CONFIG.timezone, CONFIG.daylightSaving);
        Shelly.call(
            "http.get",
            {
                url: CONFIG.priceApiEndpoint + offsetDate.yearStr + "/" + offsetDate.monthStr + "-" + offsetDate.dayStr + "_" + CONFIG.zone + ".json",
            }, processCurrentPriceResponse, { offset: offset });
    } else {
        switchOnOrOff();
    }
    lastDate = date;
}

function processCurrentPriceResponse(response, errorCode, errorMessage, userdata) {
    if (errorCode !== 0) {
        print(errorMessage);
        return;
    }
    let data = JSON.parse(response.body);
    let sum = 0.0;
    min = null;
    max = null;
    if (userdata.offset === 0) {
        prices = [];
    }
    for (let i in data) {
        let o = data[i];
        let h = JSON.parse(o.time_start.slice(11, 13)) + userdata.offset;
        prices[h] = o.SEK_per_kWh;
        sum += o.SEK_per_kWh;
        min = min === null || o.SEK_per_kWh < min ? o.SEK_per_kWh : min;
        max = max === null || o.SEK_per_kWh > max ? o.SEK_per_kWh : max;
    }
    avg = userdata.offset === 0 ? sum / data.length : avg;
    switchOnOrOff();
}

function switchOnOrOff() {
    if (prices.length === 24 && date.hour >= CONFIG.tomorowsPricesAfter) {
        getCurrentPrice(24);
        return;
    }
    let limit = avg * CONFIG.onOffLimit;
    let newSwitchState = true;
    for (let i = 0; i <= CONFIG.checkNextXHours && newSwitchState; i++) {
        let h = (date.hour + i) % prices.length;
        let price = prices[h];
        if (price <= CONFIG.allwaysOnMaxPrice || price <= limit) {
            newSwitchState = newSwitchState && true;
        } else if (price > limit || price >= CONFIG.allwaysOffMinPrice) {
            newSwitchState = false;
        }
        print(date.date + ": Hour: " + JSON.stringify(h) + " price: " + JSON.stringify(price) + " SEK/kWh, avg price today: " + JSON.stringify(avg) + " SEK/kWh, cut of limit: " + JSON.stringify(limit) + " SEK/kWh, always on limit: " + JSON.stringify(CONFIG.allwaysOnMaxPrice) + " SEK/kWh, setting switch: " + (newSwitchState ? "on" : "off"));
        if (h >= prices.length && CONFIG.stopAtDataEnd) {
            print("Stopping check at data end");
            i = 99999; //a heigh value to stop the loop
        }
    }
    if (!newSwitchState && prices[date.hour] <= CONFIG.allwaysOnMaxPrice) {
        print("Overriding switch to on as current price is below allways on price");
        newSwitchState = true;
    }

    for (let i = 0; i < CONFIG.allwaysOnHours.length && !newSwitchState; i++) {
        if (date.hour >= CONFIG.allwaysOnHours[i].from && date.hour <= CONFIG.allwaysOnHours[i].to) {
            print("Overriding switch to on as current hour is within allwaysOnHours");
            newSwitchState = true;
        }
    }
    if (CONFIG.invertSwitch) {
        newSwitchState = !newSwitchState;
        print("Inverting wanted switch state to: " + (newSwitchState ? "on" : "off"));
    }
    if (currentSwitchState === newSwitchState) {
        print("No state change... ( current state: " + (newSwitchState ? "on" : "off") + ")");
        return;
    } else if (newSwitchState === false) {
        print("Switching off!");
    } else if (newSwitchState === true) {
        print("Switching on!");
    } else {
        print("Unknown state");
        return;
    }
    if (CONFIG.debugMode) {
        print("Debug mode on, simulating changing switch to: " + (newSwitchState ? "on" : "off") + ")");
        debugSwitchState = newSwitchState;
    } else {
        Shelly.call(
            "Switch.Set",
            {
                id: CONFIG.switchId,
                on: newSwitchState,
            },
            function (response, errorCode, errorMessage) {
                if (errorCode !== 0) {
                    print(errorMessage);
                    return;
                }
            }
        );
    }
}

function epochToDate(epochTimeIn, timezone, daylightSavingTime) {
    let secondsInMinute = 60;
    let secondsInHour = secondsInMinute * 60;
    let secondsInDay = secondsInHour * 24;
    let secondsInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let secondsInYear = 0;
    let leepseconds = 0;
    let epochTime = epochTimeIn + (timezone * secondsInHour);
    let dayOfWeek = (Math.floor(epochTime / secondsInDay) + 4) % 7;
    let daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    for (let i = 0; i < 12; i++) {
        secondsInYear += secondsInMonth[i] * secondsInDay;
    }

    let years = Math.floor(epochTime / secondsInYear) + 1970;
    for (let i = 1970; i < years; i++) {
        leepseconds += i % 400 === 0 || (i % 100 !== 0 && i % 4 === 0) ? secondsInDay : 0;
    }

    let remainder = (epochTime % secondsInYear) - leepseconds;
    if (remainder < 0) {
        years--;
        remainder += secondsInYear;
    }

    let leep = years % 400 === 0 || (years % 100 !== 0 && years % 4 === 0);
    let months = 0;
    while (remainder >= (secondsInMonth[months] * secondsInDay) + (months === 1 && leep ? secondsInDay : 0)) {
        remainder = (remainder - secondsInMonth[months] * secondsInDay) - (months === 1 && leep ? secondsInDay : 0);
        months++;
    }

    let days = Math.floor(remainder / secondsInDay);
    remainder = remainder % secondsInDay;

    if (daylightSavingTime && months >= 2 && months <= 9 && !(months === 2 && (dayOfWeek + 31 - days) > 7) && !(months === 9 && (dayOfWeek + 31 - days) < 7)) {
        return epochToDate(epochTimeIn, timezone + 1, false);
    }

    let hours = Math.floor(remainder / secondsInHour);
    remainder = remainder % secondsInHour;

    let minutes = Math.floor(remainder / secondsInMinute);
    let seconds = remainder % secondsInMinute;
    let tz = timezone === 0 ? "Z" : timezone > 9 ? ("+" + JSON.stringify(timezone) + "00") : timezone > 0 ? ("+0" + JSON.stringify(timezone) + "00") : timezone < -9 ? (JSON.stringify(timezone) + "00") : ("-0" + JSON.stringify(Math.abs(timezone)) + "00");
    return {
        epoch: epochTimeIn,
        year: years,
        yearStr: JSON.stringify(years),
        month: months + 1,
        monthStr: (months + 1 < 10 ? "0" : "") + JSON.stringify(months + 1),
        day: days + 1,
        dayStr: (days + 1 < 10 ? "0" : "") + JSON.stringify(days + 1),
        hour: hours,
        hourStr: (hours + 1 < 10 ? "0" : "") + JSON.stringify(hours),
        minute: minutes,
        minuteStr: (minutes + 1 < 10 ? "0" : "") + JSON.stringify(minutes),
        second: seconds,
        secondStr: (seconds + 1 < 10 ? "0" : "") + JSON.stringify(seconds),
        dayOfWeek: dayOfWeek,
        dayOfWeekName: daysOfWeek[dayOfWeek],
        date: JSON.stringify(years) + "-" + (months + 1 < 10 ? "0" : "") + JSON.stringify(months + 1) + "-" + (days + 1 < 10 ? "0" : "") + JSON.stringify(days + 1) + "T" + (hours + 1 < 10 ? "0" : "") + JSON.stringify(hours) + ":" + (minutes + 1 < 10 ? "0" : "") + JSON.stringify(minutes) + ":" + (seconds + 1 < 10 ? "0" : "") + JSON.stringify(seconds) + tz,
    };
}

start();
Timer.set(CONFIG.updateTime, true, function (userdata) {
    start();
});
