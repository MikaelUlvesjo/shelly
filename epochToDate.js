/**
 * 
 * @param epochTimeIn seconds since 1/1 1970.
 * @param timezone in positive or negative value e.g: 1 for CET or -6 for CST
 * @param daylightSavingTime boolean, if true and date is after last Sunday in March and Before last Sunday in October 1 hour weill be added to timezone.
 * @returns json object {
 *      epoc: the original epoch timestamp
        year: int value, 1970-2038
        yearStr: string value of year
        month: int value, 1-12
        monthStr: 0 padded string value of month
        day: int value, 1-31
        dayStr: 0 padded string value of day
        hour: int value, 0-23
        hourStr: 0 padded string value of hour
        minute: int value, 0-59
        minuteStr: 0 padded string value of minute
        second: int value, 0-59
        secondStr: 0 padded string value of second
        dayOfWeek: int value, 0-6 where 0=Sunday, 1=Monday and so on.
        dayOfWeekName: the name of the day Sunday-Saturday
        date: string representation of the date in ISO 8601 YYYY-MM-DDTHH:MM:SSZ format.
    }
 */
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

/**
 * EXAMPLES
 */
Shelly.call("switch.getstatus",
    {
        id: 0,
    }, function (response, errorCode, errorMessage) {
        if (errorCode !== 0) {
            print(errorMessage);
            return;
        }
        print(JSON.stringify(epochToDate(response.aenergy.minute_ts, 1, true)));
    });

Shelly.call("Sys.GetStatus",
    {
        id: 0,
    }, function (response, errorCode, errorMessage) {
        if (errorCode !== 0) {
            print(errorMessage);
            return;
        }
        print(JSON.stringify(epochToDate(response.unixtime, 1, true)));
    });


