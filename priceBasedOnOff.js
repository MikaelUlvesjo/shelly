let CONFIG = {
    priceApiEndpoint: "https://www.elprisetjustnu.se/api/v1/prices/",   // see https://www.elprisetjustnu.se/elpris-api
    tomorowsPricesAfter: 15, //it will get tomorrows prices and if the time is after 14 for 14:00
    timezone: 1, //in positive or negative value e.g: 1 for CET or -6 for CST
    daylightSaving: true,//boolean, if true and date is after last Sunday in March and Before last Sunday in October 1 hour weill be added to timezone.
    zone: "SE4", // SE1,SE2,SE3 or SE4
    inUseLimit: 5.0, // nr of wats required to consider the controlled unit to be running and to not swith it of for non pm units set this to -1.0 
    updateTime: 900, // 15 minutes. Price update interval in seconds
    switchId: 0, // the id of the switch starts at 0
    allwaysOnMaxPrice: 0.5, // SEK/kWh if the price is below or equal this value the switch should be on no matter if checkNextXHours would turn it off (price without tax or other fees) 
    // and in color mode the first color will be used
    allwaysOffMinPrice: 2.0, // SEK/kWh if the price is above or equal this value the switch should be off no matter if allwaysOnHours would turn it on (price without tax or other fees)
    // and in color mode the last color will be used
    allwaysOnHours: [{ from: 21, to: 23 }], //Time spans when allways on format [{from: 8, to:8},{from: 20, to:23}] to have it on from 8:00-8:59 and 20:00 to 23:59
    onOffLimit: 1.0, // is used to set the price limit where to turn on and of switch
    //so if current price > (avg price * onOffLimit)  then turn off
    //and if current price <= (avg price * onOffLimit) then turn on
    checkNextXHours: 1, // check that the price do not go over the limit the next x hours if it is then switch off now,
    // will check until a to price that will switch off or all hour have low price.
    stopAtDataEnd: true,
    // if stopAtDataEnd is false will only check values that exists in the data and if it passes the end of the data it will start from the first value,
    // if stopAtDataEnd is true will only check current days values and if it passes the end of the data it will stop checking more values,
    invertSwitch: false, // invert the switch action. Set inUseLimit: -1.0 to use this.
    debugMode: true, // Set to false to enable switching of power.
    switchMode: false, // Set to true to switch power on and of based on price
    colorMode: true, // Set to true to change color on shelly plus plug s led from green to red based on price. Lowest price of the day will be green and heighest price of the day will be red
    // "Settings" -> "Led indicator color mode" have to be set to "switch"  
    colors: [[0, 100, 0], [100, 100, 0], [100, 0, 100], [100, 0, 0]], // (red, green ,blue from 0 to 100) Colors used for shelly plus plug s led
    //Can be any number of colors where the first one is for the lowest price and the last for the max price.
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
let powerUsage = 0.0;
let nextAtemptToGetData = 0;
let colorConfig = {
    "config": {
        "leds": {
            "night_mode": { "active_between": ["21:00", "07:00"], "brightness": 5, "enable": true },
            "colors": {
                "power": { "brightness": 25 },
                "switch:0": {
                    "off": {
                        "brightness": 20,
                        "rgb": [100, 100, 100]
                    },
                    "on": {
                        "brightness": 30,
                        "rgb": [100, 100, 100]
                    }
                }
            }, "mode": "switch"
        }
    }
};

function sendRequest(api, data, callback, userData) {
    Shelly.call(api, data, callback, userData);
}

function scheduleNextRun() {
    print("current date: " + date.date);
    let nextTimeToNextRun = (CONFIG.updateTime) - (((date.minute * 60) + date.second) % (CONFIG.updateTime));
    let nextDate = epochToDate(date.epoch + nextTimeToNextRun, CONFIG.timezone, CONFIG.daylightSaving);
    if (nextTimeToNextRun < (CONFIG.updateTime / 3) && date.hour === nextDate.hour) {
        print("To close to next run will skipp that run");
        nextTimeToNextRun = nextTimeToNextRun + CONFIG.updateTime;
        nextDate = epochToDate(date.epoch + nextTimeToNextRun, CONFIG.timezone, CONFIG.daylightSaving);
    }
    print("Next run: " + nextDate.date);
    Timer.set(nextTimeToNextRun * 1000, false, start);
}

function start() {
    if (CONFIG.inUseLimit < 0.0) {
        getCurrentDate();
    } else {
        getCurrentUsage();
    }
}

function getCurrentDate() {
    sendRequest("Sys.GetStatus",
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
    scheduleNextRun();
    getCurrentUsage();
}

function getCurrentUsage() {
    sendRequest("switch.getstatus",
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
        date = epochToDate(response.aenergy.minute_ts, CONFIG.timezone, CONFIG.daylightSaving);
        scheduleNextRun();
        powerUsage = response.apower;
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
    getCurrentPrice(0);
}

function getCurrentPrice(offset) {
    if (nextAtemptToGetData < date.epoch && offset === 0 && (lastDate === null || lastDate.day !== date.day || prices.length === 0)) {
        let apiUrl = CONFIG.priceApiEndpoint + date.yearStr + "/" + date.monthStr + "-" + date.dayStr + "_" + CONFIG.zone + ".json";
        print("Get prises from: " + apiUrl);
        sendRequest(
            "http.get",
            {
                url: apiUrl,
            }, processCurrentPriceResponse, { offset: offset });
    } else if (nextAtemptToGetData < date.epoch && offset > 0) {
        let offsetDate = epochToDate(date.epoch + (60 * 60 * offset), CONFIG.timezone, CONFIG.daylightSaving);
        let apiUrl = CONFIG.priceApiEndpoint + offsetDate.yearStr + "/" + offsetDate.monthStr + "-" + offsetDate.dayStr + "_" + CONFIG.zone + ".json";
        print("Get tomorrows prises from: " + apiUrl);
        sendRequest(
            "http.get",
            {
                url: apiUrl,
            }, processCurrentPriceResponse, { offset: offset });
    } else if (prices.length !== 0) {
        setColor();
        switchOnOrOff();
    }
}

function processCurrentPriceResponse(response, errorCode, errorMessage, userdata) {
    if (errorCode !== 0) {
        print(errorMessage);
        return;
    }
    if (userdata.offset === 0) {
        prices = [];
    }
    if (response.code !== 200) {
        nextAtemptToGetData = date.epoch + 1800; //Wait 30 minutes before trying again
        print("Error getting price with offset " + JSON.stringify(userdata.offset) + " got error: " + JSON.stringify(response.code) + " " + response.message);
        if (prices.length === 0) {
            print("No prise information availible, will retry after 30 minutes");
            lastDate = null;
            return;
        } else {
            print("Todays prise is availible will use that information, will retry to get tommorows prices in 30 minutes");
            setColor();
            switchOnOrOff();
            return;
        }
    }

    let data = JSON.parse(response.body);
    let sum = 0.0;
    min = null;
    max = null;

    for (let i in data) {
        let o = data[i];
        let h = JSON.parse(o.time_start.slice(11, 13)) + userdata.offset;
        prices[h] = o.SEK_per_kWh;
        sum += o.SEK_per_kWh;
        min = min === null || o.SEK_per_kWh < min ? o.SEK_per_kWh : min;
        max = max === null || o.SEK_per_kWh > max ? o.SEK_per_kWh : max;
    }
    avg = userdata.offset === 0 ? sum / data.length : avg;
    if (userdata.offset === 0) {
        lastDate = date;
    }
    if (prices.length === 24 && date.hour >= CONFIG.tomorowsPricesAfter) {
        getCurrentPrice(24);
        return;
    }
    print(date.date + ": Hour: " + JSON.stringify(date.hour) + ", current price: " + JSON.stringify(prices[date.hour]) + " SEK/kWh, min price today: " + JSON.stringify(min) + " SEK/kWh, max price today: " + JSON.stringify(max) + " SEK/kWh, avg price today: " + JSON.stringify(avg) + " SEK/kWh, always on limit: " + JSON.stringify(CONFIG.allwaysOnMaxPrice) + " SEK/kWh, always of limit: " + JSON.stringify(CONFIG.allwaysOffMinPrice) + " SEK/kWh");
    setColor();
    switchOnOrOff();
}

function switchOnOrOff() {
    if (!CONFIG.switchMode) {
        return;
    }
    let limit = avg * CONFIG.onOffLimit;
    let newSwitchState = true;
    for (let i = 0; i <= CONFIG.checkNextXHours && newSwitchState; i++) {
        let h = (date.hour + i) % prices.length;
        let price = prices[h];
        newSwitchState = newSwitchState && (price <= CONFIG.allwaysOnMaxPrice || price <= limit);
        print(date.date + ": Hour: " + JSON.stringify(h) + " price: " + JSON.stringify(price) + " SEK/kWh, avg price today: " + JSON.stringify(avg) + " SEK/kWh, cut of limit: " + JSON.stringify(limit) + " SEK/kWh, always on limit: " + JSON.stringify(CONFIG.allwaysOnMaxPrice) + " SEK/kWh, setting switch: " + (newSwitchState ? "on" : "off"));
        if (h >= prices.length && CONFIG.stopAtDataEnd) {
            print("Stopping check at data end");
            i = 99999; //a heigh value to stop the loop
        }
    }
    for (let i = 0; i < CONFIG.allwaysOnHours.length && !newSwitchState; i++) {
        if (date.hour >= CONFIG.allwaysOnHours[i].from && date.hour <= CONFIG.allwaysOnHours[i].to) {
            print("Overriding switch to on as current hour is within allwaysOnHours");
            newSwitchState = true;
        }
    }
    if (!newSwitchState && prices[date.hour] <= CONFIG.allwaysOnMaxPrice) {
        print("Overriding switch to on as current price is below allways on price");
        newSwitchState = true;
    }
    if (newSwitchState && prices[date.hour] >= CONFIG.allwaysOffMinPrice) {
        print("Overriding switch to off as current price is above allways off price");
        newSwitchState = false;
    }
    if (powerUsage >= CONFIG.inUseLimit && CONFIG.inUseLimit >= 0.0) {
        print("Power usage is over inUseLimit: " + JSON.stringify(powerUsage) + " >= " + JSON.stringify(CONFIG.inUseLimit));
        newSwitchState = true;
    }

    if (CONFIG.invertSwitch) {
        newSwitchState = !newSwitchState;
        print("Inverting wanted switch state to: " + (newSwitchState ? "on" : "off"));
    }
    if (currentSwitchState === newSwitchState) {
        print("No state change... ( current state: " + (newSwitchState ? "on" : "off") + ")");
        return;
    }

    if (CONFIG.debugMode) {
        print("Debug mode on, simulating changing switch to: " + (newSwitchState ? "on" : "off"));
        debugSwitchState = newSwitchState;
    } else {
        print("Changing switch to: " + (newSwitchState ? "on" : "off"));
        sendRequest(
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

function setColor() {
    if (CONFIG.colorMode) {
        let percent = Math.round(100 * (prices[date.hour] - min) / (max - min));
        let interval = 100 / CONFIG.colors.length;
        let color = [0, 0, 100];
        for (let i = 0; i < CONFIG.colors.length; i++) {
            if (percent >= (i * interval)) {
                color = CONFIG.colors[i];
            }
        }
        if (prices[date.hour] <= CONFIG.allwaysOnMaxPrice) {
            color = CONFIG.colors[0];
            print("Price below allwaysOnMaxPrice, Setting color to rgb: " + JSON.stringify(color));
        } else if (prices[date.hour] >= CONFIG.allwaysOffMinPrice) {
            color = CONFIG.colors[CONFIG.colors.length - 1];
            print("Price above allwaysOffMinPrice, Setting color to rgb: " + JSON.stringify(color));
        } else {
            print("Setting color to rgb: " + JSON.stringify(color));
        }
        colorConfig.config.leds.colors["switch:" + JSON.stringify(CONFIG.switchId)].off.rgb = color;
        colorConfig.config.leds.colors["switch:" + JSON.stringify(CONFIG.switchId)].on.rgb = color;
        sendRequest(
            "PLUGS_UI.SetConfig",
            colorConfig,
            function (response, errorCode, errorMessage) {
                if (errorCode !== 0) {
                    print(errorMessage);
                    return;
                }
                print(JSON.stringify(response));
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
    let leapseconds = 0;
    let epochTime = epochTimeIn + (timezone * secondsInHour);
    let dayOfWeek = (Math.floor(epochTime / secondsInDay) + 4) % 7;
    let daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    for (let i = 0; i < 12; i++) {
        secondsInYear += secondsInMonth[i] * secondsInDay;
    }

    let years = Math.floor(epochTime / secondsInYear) + 1970;
    for (let i = 1970; i < years; i++) {
        leapseconds += i % 400 === 0 || (i % 100 !== 0 && i % 4 === 0) ? secondsInDay : 0;
    }

    let remainder = (epochTime % secondsInYear) - leapseconds;
    if (remainder < 0) {
        years--;
        remainder += secondsInYear;
        remainder += ((years % 400 === 0 || (years % 100 !== 0 && years % 4 === 0)) ? secondsInDay : 0);
    }

    let leap = years % 400 === 0 || (years % 100 !== 0 && years % 4 === 0);
    let months = 0;
    while (remainder >= (secondsInMonth[months] * secondsInDay) + (months === 1 && leap ? secondsInDay : 0)) {
        remainder = (remainder - secondsInMonth[months] * secondsInDay) - (months === 1 && leap ? secondsInDay : 0);
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
