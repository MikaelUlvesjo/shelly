let CONFIG = {
    priceApiEndpoint: "https://www.elprisetjustnu.se/api/v1/prices/",   // see https://www.elprisetjustnu.se/elpris-api
    timeApiEndpoint: "http://worldtimeapi.org/api/timezone/Europe/Stockholm",     // See https://worldtimeapi.org/
    zone: "SE4", // SE1,SE2,SE3 or SE4
    inUseLimit: 5.0, // nr of wats required to consider the controlled unit to be running and to not swith it of 
    updateTime: 300000, // 5 minutes. Price update interval in milliseconds
    switchId: 0, // the id of the switch starts at 0
    allwaysOnMaxprice: 1.0, // SEK/kWh if the price is below or equal this value the switch should be on no matter if checkNextXHours would turn it off (price without tax or other fees)
    onOffLimit: 1.0, // is used to set the price limit where to turn on and of switch
    //so if current price > (avg price * onOffLimit)  then turn off
    //and if current price <= (avg price * onOffLimit) then turn on
    checkNextXHours: 1, // check that the price do not go over the limit the next x hours if it is then switch off now,
    // will check until a to price that will switch off or all hour have low price.
    stopAtMidnight: false,
    // if stopAtMidnight is false will only check current days values and if it passes midnight it will use the prices from current days morning,
    // if stopAtMidnight is true will only check current days values and if it passes midnight it will stop checking more values,
    debugMode: true, // Set to false to enable switching of power.
};

let prices = [];
let avg = null;
let min = null;
let max = null;
let state = null;
let year = null;
let mounth = null;
let day = null;
let date = null;
let lastHour = null;
let hour = null;
let minute = null;
let currentSwitchState = null;
let debugSwitchState = null;
let powerUsage = null;


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
    print();
    currentSwitchState = response.output;
    powerUsage = response.apower;
    if (CONFIG.debugMode) {
        debugSwitchState = debugSwitchState === null ? currentSwitchState : debugSwitchState;
        if (currentSwitchState !== debugSwitchState) {
            print("Overiding currentSwitchState (" + (currentSwitchState ? "on" : "off") + ") with debugSwitchState: " + (debugSwitchState ? "on" : "off"));
        }
        currentSwitchState = debugSwitchState;
    }
    if (currentSwitchState === true) {
        if (powerUsage > CONFIG.inUseLimit) {
            print("Switch is on and used, not checking price. Current usage: " + JSON.stringify(powerUsage) + "w");
        } else {
            print("Switch is on and not used. Current usage: " + JSON.stringify(powerUsage) + "w");
            getCurrentDateAndTime();
        }
    } else {
        print("Switch is off");
        getCurrentDateAndTime();
    }
}

function getCurrentDateAndTime() {
    Shelly.call(
        "http.get",
        {
            url: CONFIG.timeApiEndpoint,
        }, processCurrentDateAndTimeResponse);
}

function processCurrentDateAndTimeResponse(response, errorCode, errorMessage) {
    if (errorCode !== 0) {
        print(errorMessage);
        return;
    }
    let data = JSON.parse(response.body);
    let dt = data.datetime;
    year = dt.slice(0, 4);
    mounth = dt.slice(5, 7);
    day = dt.slice(8, 10);
    hour = dt.slice(11, 13);
    minute = dt.slice(14, 16);
    date = year + "-" + mounth + "-" + day + " " + hour + ":" + minute;
    getCurrentPrice();
}

function getCurrentPrice() {
    if (lastHour === null || JSON.parse(lastHour) > JSON.parse(hour) || prices.length === 0) {
        Shelly.call(
            "http.get",
            {
                url: CONFIG.priceApiEndpoint + year + "/" + mounth + "-" + day + "_" + CONFIG.zone + ".json",
            }, processCurrentPriceResponse);
    } else {
        switchOnOrOff();
    }
    lastHour = hour;
}

function processCurrentPriceResponse(response, errorCode, errorMessage) {
    if (errorCode !== 0) {
        print(errorMessage);
        return;
    }
    let data = JSON.parse(response.body);
    let sum = 0.0;
    min = null;
    max = null;
    prices = [];
    for (let i in data) {
        let o = data[i];
        let h = o.time_start.slice(11, 13);
        prices[h] = o.SEK_per_kWh;
        sum += o.SEK_per_kWh;
        min = min === null || o.SEK_per_kWh < min ? o.SEK_per_kWh : min;
        max = max === null || o.SEK_per_kWh > max ? o.SEK_per_kWh : max;
    }
    avg = sum / data.length;
    switchOnOrOff();
}

function switchOnOrOff() {
    let limit = avg * CONFIG.onOffLimit;
    let newSwitchState = true;
    for (let i = 0; i <= CONFIG.checkNextXHours && newSwitchState; i++) {
        let hint = (JSON.parse(hour) + i) % prices.length;
        let h = (hint < 10 ? "0" : "") + JSON.stringify(hint);
        let price = prices[h];
        if (price <= CONFIG.allwaysOnMaxprice || price <= limit) {
            newSwitchState = newSwitchState && true;
        } else if (price > limit) {
            newSwitchState = false;
        }
        print(date + ": Hour: " + h + " price: " + JSON.stringify(price) + " SEK/kWh, avg price today: " + JSON.stringify(avg) + " SEK/kWh, cut of limit: " + JSON.stringify(limit) + " SEK/kWh, always on limit: " + JSON.stringify(CONFIG.allwaysOnMaxprice) + " SEK/kWh, setting switch: " + (newSwitchState ? "on" : "off"));
        if (hint >= 23 && CONFIG.stopAtMidnight) {
            print("Stopping check at midnight");
            i = 99999;//a heigh value to stop the loop
        }
    }
    if (!newSwitchState && prices[hour] <= CONFIG.allwaysOnMaxprice) {
        print("Overriding switch to true as current price is below allways on price");
        newSwitchState = true;
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
        print("Debug mode on, simulating changing switch to: " + (newSwitchState ? "on" : "off"));
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

getCurrentUsage();
Timer.set(CONFIG.updateTime, true, function (userdata) {
    getCurrentUsage();
});
