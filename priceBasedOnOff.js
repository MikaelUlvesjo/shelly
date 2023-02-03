let CONFIG = {
    priceApiEndpoint: "https://www.elprisetjustnu.se/api/v1/prices/",   // see https://www.elprisetjustnu.se/elpris-api
    timeApiEndpoint: "http://worldtimeapi.org/api/timezone/Europe/Stockholm",     // See https://worldtimeapi.org/
    zone: "SE4", // SE1,SE2,SE3 or SE4
    inUseLimit: 5.0, // nr of wats required to consider the controlled unit to be running and to not swith it of 
    updateTime: 300000, // 5 minutes. Price update interval in milliseconds
    switchId: 0, // the id of the switch starts at 0
    allwaysOnMaxprice: 1.0, // SEK/kWh if the price is below this value the switch should be on (price without tax or other fees)
    onOffLimit: 1.0, // is used to set the price limit where to turn on and of switch
    //so if current price > (avg price * onOffLimit)  then turn off
    //and if current price <= (avg price * onOffLimit) then turn on
    checkNextXHours: 1, // check that the price do not go over the limit the next x hours is it does then switch of now (will only check current day and not after midnight)
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
let currentState = null;
let debugState = null;


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
    print("Current usage: " + JSON.stringify(response.apower) + "w");
    currentState = response.output;
    if (CONFIG.debugMode) {
        debugState = debugState === null ? currentState : debugState;
        if (currentState !== debugState) {
            print("Overiding currentState (" + (currentState ? "on" : "off") + ") with debugState: " + (debugState ? "on" : "off"));
        }
        currentState = debugState;
    }
    if (response.output === true) {
        if (response.apower > CONFIG.inUseLimit) {
            print("Switch is on and used");
        } else {
            print("Switch is on and not used");
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
    let switchState = true;
    for (let i = 0; i <= CONFIG.checkNextXHours; i++) {
        let price = prices[JSON.stringify(JSON.parse(hour) + i)];
        if (price <= CONFIG.allwaysOnMaxprice) {
            switchState = switchState && true;
        } else if (price <= limit) {
            switchState = switchState && true;
        } else if (price > limit) {
            switchState = false;
        }
        print(date + ": Hour+" + JSON.stringify(i) + " price: " + JSON.stringify(price) + " SEK/kWh, avg price today: " + JSON.stringify(avg) + " SEK/kWh, cut of limit: " + JSON.stringify(limit) + " SEK/kWh, always on limit: " + JSON.stringify(CONFIG.allwaysOnMaxprice) + " SEK/kWh, setting switch: " + (switchState ? "on" : "off"));
    }
    if (!switchState && prices[hour] <= CONFIG.allwaysOnMaxprice) {
        print("Overriding switch to true as current price is below allways on price");
        switchState = true;
    }
    changeSwitchState(switchState);
}

function changeSwitchState(state) {
    if (currentState === state) {
        print("No state change... ( current state: " + (state ? "on" : "off") + ")");
        return;
    } else if (state === false) {
        print("Switching off!");
    } else if (state === true) {
        print("Switching on!");
    } else {
        print("Unknown state");
        return;
    }
    if (CONFIG.debugMode) {
        print("Debug mode on, not changing switch to: " + (state ? "on" : "off"));
        debugState = state;
    } else {
        Shelly.call(
            "Switch.Set",
            {
                id: CONFIG.switchId,
                on: state,
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