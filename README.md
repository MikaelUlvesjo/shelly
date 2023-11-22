# shelly
Shelly scripts
## epochToDate.js: 
Parse epoch timestamp to a date object.
With support for: 
* leap year
* daylight saving time
* timezone

## priceBasedOnOff.js / priceBasedOnOff_for_1.0.xV.js

If you use a 1.0.x firmware use: priceBasedOnOff_for_1.0.xV.js

If you are using a 0.x.x firmware use priceBasedOnOff.js

Uses the api from https://www.elprisetjustnu.se/elpris-api 
Coinfig:
-    priceApiEndpoint: "https://www.elprisetjustnu.se/api/v1/prices/",   // see https://www.elprisetjustnu.se/elpris-api
-    tomorowsPricesAfter: 14, //it will get tomorrows prices and if the time is after 14 for 14:00
-    timezone: 1, //in positive or negative value e.g: 1 for CET or -6 for CST
-    daylightSaving: true,//boolean, if true and date is after last Sunday in March and Before last Sunday in October 1 hour weill be added to timezone.
    zone: "SE4", // SE1,SE2,SE3 or SE4
-   inUseLimit: 5.0, // nr of wats required to consider the controlled unit to be running and to not swith it of for non pm units set this to -1.0 
-   updateTime: 300000, // 5 minutes. Price update interval in milliseconds
-   switchId: 0, // the id of the switch starts at 0
-   allwaysOnMaxPrice: 1.3, // SEK/kWh if the price is below or equal this value the switch should be on no matter if checkNextXHours would turn it off (price without tax or other fees)
-   allwaysOffMminPrice: 3.0, // SEK/kWh if the price is above or equal this value the switch should be off no matter if checkNextXHours would turn it on (price without tax or other fees)
-   allwaysOnHours: [{ from: 21, to: 23 }], //Time spans when allways on format [{from: 10, to:12},{from: 20, to:23}]
-   onOffLimit: 1.1, // is used to set the price limit where to turn on and of switch
    //so if current price > (avg price * onOffLimit)  then turn off
    //and if current price <= (avg price * onOffLimit) then turn on
-   checkNextXHours: 1, // check that the price do not go over the limit the next x hours if it is then switch off now,
    // will check until a to price that will switch off or all hour have low price.
-   stopAtDataEnd: true,
    // if stopAtDataEnd is false will only check values that exists in the data and if it passes the end of the data it will start from the first value,
    // if stopAtDataEnd is true will only check current days values and if it passes the end of the data it will stop checking more values,
-   invertSwitch: false, // invert the switch action.
-   debugMode: true, // Set to false to enable switching of power.
-   switchMode: true, // Set to true to swith power on and of based on price
-   colorMode: true, // Set to true to change color on shelly plus plug s led from green to red based on price. Lowest price of the day will be green and highest price of the day will be red.
    // "Settings" -> "Led indicator color mode" have to be set to "switch"  
-   colors: ["0,100,0", "50,100,0", "100,50,0", "100,0,0"], //Colors used for shelly plus plug s led

