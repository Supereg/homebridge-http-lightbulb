"use strict";

let Service, Characteristic, api;

const _http_base = require("homebridge-http-base");
const http = _http_base.http;
const configParser = _http_base.configParser;
const PullTimer = _http_base.PullTimer;
const notifications = _http_base.notifications;
const MQTTClient = _http_base.MQTTClient;

const packageJSON = require("./package.json");

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    api = homebridge;

    homebridge.registerAccessory("homebridge-http-lightbulb", "HTTP-LIGHTBULB", HTTP_LIGHTBULB);
};

const BrightnessUnit = Object.freeze({
    PERCENT: "percent",
    RGB: "rgb",
});

const TemperatureUnit = Object.freeze({
    MICRORECIPROCAL_DEGREE: "mired",
    KELVIN: "kelvin",
});

function HTTP_LIGHTBULB(log, config) {
    this.log = log;
    this.name = config.name;
    this.debug = config.debug || false;

    const success = this.parseCharacteristics(config);
    if (!success) {
        this.log.warn("Aborting...");
        return;
    }

    if (config.auth) {
        if (!(config.auth.username && config.auth.password))
            this.log("'auth.username' and/or 'auth.password' was not set!");
        else {
            const urlObjects = [this.power.onUrl, this.power.offUrl, this.power.statusUrl];
            if (this.brightness)
                urlObjects.push(this.brightness.setUrl, this.brightness.statusUrl);
            if (this.hue)
                urlObjects.push(this.hue.setUrl, this.hue.statusUrl);
            if (this.saturation)
                urlObjects.push(this.saturation.setUrl, this.saturation.statusUrl);
            if (this.colorTemperature)
                urlObjects.push(this.colorTemperature.setUrl, this.colorTemperature.statusUrl);

            urlObjects.forEach(value => {
                value.auth.username = config.auth.username;
                value.auth.password = config.auth.password;

                if (typeof config.auth.sendImmediately === "boolean")
                    value.auth.sendImmediately = config.auth.sendImmediately;
            })
        }
    }

    this.homebridgeService = new Service.Lightbulb(this.name);
    this.homebridgeService.getCharacteristic(Characteristic.On)
        .on("get", this.getPowerState.bind(this))
        .on("set", this.setPowerState.bind(this));
    if (this.brightness)
        this.homebridgeService.addCharacteristic(Characteristic.Brightness)
            .on("get", this.getBrightness.bind(this))
            .on("set", this.setBrightness.bind(this));
    if (this.hue)
        this.homebridgeService.addCharacteristic(Characteristic.Hue)
            .on("get", this.getHue.bind(this))
            .on("set", this.setHue.bind(this));
    if (this.saturation)
        this.homebridgeService.addCharacteristic(Characteristic.Saturation)
            .on("get", this.getSaturation.bind(this))
            .on("set", this.setSaturation.bind(this));
    if (this.colorTemperature)
        this.homebridgeService.addCharacteristic(Characteristic.ColorTemperature)
            .on("get", this.getColorTemperature.bind(this))
            .on("set", this.setColorTemperature.bind(this))
            .setProps({
               minValue: this.colorTemperature.minValue,
               maxValue: this.colorTemperature.maxValue
            });

    /** @namespace config.pullInterval */
    if (config.pullInterval) {
        // TODO what is with updating other characteristics. 'On' should be enough for now, since this is probably the characteristic
        //  that matters the most and also get's changed the most.
        this.pullTimer = new PullTimer(this.log, config.pullInterval, this.getPowerState.bind(this), value => {
            this.homebridgeService.getCharacteristic(Characteristic.On).updateValue(value);
        });
        this.pullTimer.start();
    }

    /** @namespace config.notificationID */
    /** @namespace config.notificationPassword */
    if (config.notificationID)
        notifications.enqueueNotificationRegistrationIfDefined(api, log, config.notificationID, config.notificationPassword, this.handleNotification.bind(this));

    /** @namespace config.mqtt */
    if (config.mqtt) {
        let options;
        try {
            options = configParser.parseMQTTOptions(config.mqtt);
        } catch (error) {
            this.log.error("Error occurred while parsing MQTT property: " + error.message);
            this.log.error("MQTT will not be enabled!");
        }

        if (options) {
            try {
                this.mqttClient = new MQTTClient(this.homebridgeService, options, this.log);
                this.mqttClient.connect();
            } catch (error) {
                this.log.error("Error occurred creating mqtt client: " + error.message);
            }
        }
    }

    this.log("Lightbulb successfully configured...");
    if (this.debug) {
        this.log("Lightbulb started with the following options: ");
        this.log("  - power: " + JSON.stringify(this.power));
        if (this.brightness)
            this.log("  - brightness: " + JSON.stringify(this.brightness));
        if (this.hue)
            this.log("  - hue: " + JSON.stringify(this.hue));
        if (this.saturation)
            this.log("  - saturation: " + JSON.stringify(this.saturation));
        if (this.colorTemperature)
            this.log("  - colorTemperature: " + JSON.stringify(this.colorTemperature));

        if (this.auth)
            this.log("  - auth options: " + JSON.stringify(this.auth));

        if (this.pullTimer)
            this.log("  - pullTimer started with interval " + config.pullInterval);

        if (config.notificationID)
            this.log("  - notificationID specified: " + config.notificationID);

        if (this.mqttClient) {
            const options = this.mqttClient.mqttOptions;
            this.log(`  - mqtt client instantiated: ${options.protocol}://${options.host}:${options.port}`);
            this.log("     -> subscribing to topics:");

            for (const topic in this.mqttClient.subscriptions) {
                if (!this.mqttClient.subscriptions.hasOwnProperty(topic))
                    continue;

                this.log(`         - ${topic}`);
            }
        }
    }
}

HTTP_LIGHTBULB.prototype = {

    parseCharacteristics: function (config) {
        this.power = {};

        let url;
        try {
            url = "onUrl";
            this.power.onUrl = this.parsePropertyWithLegacyLocation(config, config.power, url);
            url = "offUrl";
            this.power.offUrl = this.parsePropertyWithLegacyLocation(config, config.power, url);
            url = "statusUrl";
            this.power.statusUrl = this.parsePropertyWithLegacyLocation(config, config.power, url);
        } catch (error) {
            this.log.warn(`Error occurred while parsing '${url}': ${error.message}`);
            return false;
        }

        this.power.statusPattern = /1/; // default pattern
        try {
            // statusPattern didn't exist in v0.1.1, no need for backwards compatibility lol
            this.power.statusPattern = this.parsePattern(config.statusPattern);
        } catch (error) {
            this.log.warn("Property 'power.statusPattern' was given in an unsupported type. Using the default one!");
        }

        if (config.brightness) {
            if (typeof config.brightness === "object") {
                if (!config.brightness.setUrl || !config.brightness.statusUrl) {
                    this.log.warn("Property 'brightness' was defined, however some urls are missing!");
                    return false;
                }

                this.brightness = {};
                let url;
                try {
                    // noinspection JSUnusedAssignment
                    url = "setUrl";
                    this.brightness.setUrl = configParser.parseUrlProperty(config.brightness.setUrl);
                    url = "statusUrl";
                    this.brightness.statusUrl = configParser.parseUrlProperty(config.brightness.statusUrl);
                } catch (error) {
                    this.log.warn(`Error occurred while parsing 'brightness.${url}': ${error.message}`);
                    return false;
                }

                this.brightness.unit = this.valueOf(BrightnessUnit, config.brightness.unit, BrightnessUnit.PERCENT);
                if (!this.brightness.unit) {
                    this.log.warn(`${config.brightness.unit} is a unsupported brightness unit!`);
                    return false;
                }

                this.brightness.statusPattern = /([0-9]{1,3})/; // default pattern
                try {
                    this.brightness.statusPattern = this.parsePattern(config.brightness.statusPattern);
                } catch (error) {
                    this.log.warn("Property 'brightness.statusPattern' was given in an unsupported type. Using the default one!");
                }


                this.brightness.withholdPowerUpdate = config.brightness.withholdPowerUpdate || false;
                this.withholdPowerCall = false;
            }
            else {
                this.log.warn("Property 'brightness' needs to be an object!");
                return false;
            }
        }

        if (config.hue) {
            if (typeof config.hue === "object") {
                if (!config.hue.setUrl || !config.hue.statusUrl) {
                    this.log.warn("Property 'hue' was defined, however some urls are missing!");
                    return false;
                }

                this.hue = {};
                let url;
                try {
                    // noinspection JSUnusedAssignment
                    url = "setUrl";
                    this.hue.setUrl = configParser.parseUrlProperty(config.hue.setUrl);
                    url = "statusUrl";
                    this.hue.statusUrl = configParser.parseUrlProperty(config.hue.statusUrl);
                } catch (error) {
                    this.log.warn(`Error occurred while parsing 'hue.${url}': ${error.message}`);
                    return false;
                }

                this.hue.statusPattern = /([0-9]{1,3})/; // default pattern
                try {
                    this.hue.statusPattern = this.parsePattern(config.hue.statusPattern);
                } catch (error) {
                    this.log.warn("Property 'hue.statusPattern' was given in an unsupported type. Using the default one!");
                }
            }
            else {
                this.log.warn("Property 'hue' needs to be an object!");
                return false;
            }
        }
        if (config.saturation) {
            if (typeof config.saturation === "object") {
                if (!config.saturation.setUrl || !config.saturation.statusUrl) {
                    this.log.warn("Property 'saturation' was defined, however some urls are missing!");
                    return false;
                }

                this.saturation = {};
                let url;
                try {
                    // noinspection JSUnusedAssignment
                    url = "setUrl";
                    this.saturation.setUrl = configParser.parseUrlProperty(config.saturation.setUrl);
                    url = "statusUrl";
                    this.saturation.statusUrl = configParser.parseUrlProperty(config.saturation.statusUrl);
                } catch (error) {
                    this.log.warn(`Error occurred while parsing 'saturation.${url}': ${error.message}`);
                    return false;
                }

                this.saturation.statusPattern = /([0-9]{1,3})/; // default pattern
                try {
                    this.saturation.statusPattern = this.parsePattern(config.saturation.statusPattern);
                } catch (error) {
                    this.log.warn("Property 'saturation.statusPattern' was given in an unsupported type. Using the default one!");
                }
            }
            else {
                this.log.warn("Property 'saturation' needs to be an object!");
                return false;
            }
        }

        if (config.colorTemperature) {
            if (typeof config.colorTemperature === "object") {
                if (this.hue || this.saturation) {
                    this.log.warn("When specifying 'colorTemperature' 'hue' and 'saturation' must not be specified!");
                    return false;
                }

                if (!config.colorTemperature.setUrl || !config.colorTemperature.statusUrl) {
                    this.log.warn("Property 'colorTemperature' was defined, however some urls are missing!");
                    return false;
                }

                this.colorTemperature = {};
                let url;
                try {
                    // noinspection JSUnusedAssignment
                    url = "setUrl";
                    this.colorTemperature.setUrl = configParser.parseUrlProperty(config.colorTemperature.setUrl);
                    url = "statusUrl";
                    this.colorTemperature.statusUrl = configParser.parseUrlProperty(config.colorTemperature.statusUrl);
                } catch (error) {
                    this.log.warn(`Error occurred while parsing 'colorTemperature.${url}': ${error.message}`);
                    return false;
                }

                this.colorTemperature.unit = this.valueOf(TemperatureUnit, config.colorTemperature.unit, TemperatureUnit.MICRORECIPROCAL_DEGREE);
                if (!this.colorTemperature.unit) {
                    this.log.warn(`${config.colorTemperature.unit} is a unsupported temperature unit!`);
                    return false;
                }

                this.colorTemperature.statusPattern = this.colorTemperature.unit === TemperatureUnit.MICRORECIPROCAL_DEGREE? /([0-9]{2,3})/: /([0-9]{4,5})/; // default pattern
                try {
                    this.colorTemperature.statusPattern = this.parsePattern(config.colorTemperature.statusPattern);
                } catch (error) {
                    this.log.warn("Property 'colorTemperature.statusPattern' was given in an unsupported type. Using the default one!");
                }

                this.colorTemperature.minValue = 50; // HAP default values
                this.colorTemperature.maxValue = 400;

                if (config.colorTemperature.minValue) {
                    if (typeof config.colorTemperature.minValue === "number") {
                        let minValue = config.colorTemperature.minValue;

                        if (this.colorTemperature.unit === TemperatureUnit.KELVIN)
                            minValue = Math.floor(1000000 / minValue);
                        this.colorTemperature.minValue = minValue;
                    }
                    else
                        this.log.warn("'colorTemperature.minValue' needs to be a number. Ignoring it and using default!");
                }
                if (config.colorTemperature.maxValue) {
                    if (typeof config.colorTemperature.maxValue === "number") {
                        let maxValue = config.colorTemperature.maxValue;

                        if (this.colorTemperature.unit === TemperatureUnit.KELVIN)
                            maxValue = Math.floor(1000000 / maxValue);
                        this.colorTemperature.maxValue = maxValue;
                    }
                    else
                        this.log.warn("'colorTemperature.maxValue' needs to be a number. Ignoring it and using default!");
                }
            }
            else {
                this.log.warn("Property 'colorTemperature' needs to be an object!");
                return false;
            }
        }

        return true;
    },

    parsePropertyWithLegacyLocation: function (location, legacyLocation, name, parserFunction) {
        if (!parserFunction)
            parserFunction = configParser.parseUrlProperty.bind(configParser);

        if (location[name])
            return parserFunction(location[name]);
        else if (legacyLocation && typeof legacyLocation === "object" && legacyLocation[name])
            return parserFunction(legacyLocation[name]); // backwards compatibility with v0.1.1

        throw new Error("property is required!");
    },

    parsePattern: function (property) {
        if (typeof property === "string")
            return  new RegExp(property);
        else
            throw new Error("Unsupported type for pattern");
    },

    extractNumberFromPattern: function (pattern, string) {
        const matchArray = string.match(pattern);

        if (matchArray === null) // pattern didn't match at all
            throw new Error("Pattern didn't match (or body didn't contain the necessary information)! string: " + string);
        else if (matchArray.length < 2)
            throw new Error("Couldn't find any group which can be extracted. Did you make sure to put your number pattern into the first group?");
        else {
            const value = parseInt(matchArray[1]);
            if (isNaN(value))
                throw new Error("Extracted group is not a number!");

            return value;
        }
    },

    valueOf: function (enumObject, property, defaultValue) {
        let value = property || defaultValue;
        value = value.toLowerCase();

        let valid = false;
        Object.keys(enumObject).forEach(key => {
            const objectElement = enumObject[key];

            if (value === objectElement)
                valid = true;
        });

        return valid? value: null;
    },

    identify: function (callback) {
        this.log("Identify requested!");
        callback();
    },

    getServices: function () {
        if (!this.homebridgeService)
            return [];

        const informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, "Andreas Bauer")
            .setCharacteristic(Characteristic.Model, "HTTP Lightbulb")
            .setCharacteristic(Characteristic.SerialNumber, "LB01")
            .setCharacteristic(Characteristic.FirmwareRevision, packageJSON.version);

        return [informationService, this.homebridgeService];
    },

    handleNotification: function (body) {
        if (!this.homebridgeService.testCharacteristic(body.characteristic)) {
            this.log("Encountered unknown characteristic when handling notification (or characteristic which wasn't added to the service): " + body.characteristic);
            return;
        }

        let value = body.value;

        if (body.characteristic === "On" && this.pullTimer)
            this.pullTimer.resetTimer();

        if (body.characteristic === "ColorTemperature" && this.colorTemperature.unit === TemperatureUnit.KELVIN)
            value = Math.floor(1000000 / value);
        if (body.characteristic === "Brightness" && this.brightness.unit === BrightnessUnit.RGB)
            value = Math.floor((value / 255) * 100);

        this.log("Updating '" + body.characteristic + "' to new value: " + body.value);
        this.homebridgeService.getCharacteristic(body.characteristic).updateValue(value);
    },

    getPowerState: function (callback) {
        if (this.pullTimer)
            this.pullTimer.resetTimer();

        http.httpRequest(this.power.statusUrl, (error, response, body) => {
           if (error) {
               this.log("getPowerState() failed: %s", error.message);
               callback(error);
           }
           else if (!http.isHttpSuccessCode(response.statusCode)) {
               this.log(`getPowerState() http request returned http error code ${response.statusCode}: ${body}`);
               callback(new Error("Got html error code " + response.statusCode));
           }
           else {
               if (this.debug)
                   this.log(`getPowerState() request returned successfully (${response.statusCode}). Body: '${body}'`);

               const switchedOn = this.power.statusPattern.test(body);
               if (this.debug)
                   this.log("getPowerState() power is currently %s", switchedOn? "ON": "OFF");

               callback(null, switchedOn);
           }
        });
    },

    setPowerState: function (on, callback) {
        // only withhold power request if on === true and light is currently on
        if (on && this.withholdPowerCall && this.homebridgeService.getCharacteristic(Characteristic.On).value) {
            this.withholdPowerCall = false;
            callback();
            return;
        }

        if (this.pullTimer)
            this.pullTimer.resetTimer();

        const urlObject = on ? this.power.onUrl : this.power.offUrl;
        http.httpRequest(urlObject, (error, response, body) => {
            if (error) {
                this.log("setPowerState() failed: %s", error.message);
                callback(error);
            }
            else if (!http.isHttpSuccessCode(response.statusCode)) {
                this.log(`setPowerState() http request returned http error code ${response.statusCode}: ${body}`);
                callback(new Error("Got html error code " + response.statusCode));
            }
            else {
                if (this.debug)
                    this.log(`setPowerState() Successfully set power to ${on? "ON": "OFF"}. Body: '${body}'`);

                callback();
            }
        });
    },

    getBrightness: function (callback) {
        http.httpRequest(this.brightness.statusUrl, (error, response, body) => {
            if (error) {
                this.log("getBrightness() failed: %s", error.message);
                callback(error);
            }
            else if (!http.isHttpSuccessCode(response.statusCode)) {
                this.log(`getBrightness() http request returned http error code ${response.statusCode}: ${body}`);
                callback(new Error("Got html error code " + response.statusCode));
            }
            else {
                if (this.debug)
                    this.log(`getBrightness() request returned successfully (${response.statusCode}). Body: '${body}'`);

                let brightness;
                try {
                    brightness = this.extractNumberFromPattern(this.brightness.statusPattern, body);
                } catch (error) {
                    this.log("getBrightness() error occurred while extracting brightness from body: " + error.message);
                    callback(new Error("pattern error"));
                    return;
                }

                if (this.brightness.unit === BrightnessUnit.RGB)
                    brightness = Math.floor((brightness / 255) * 100);

                if (brightness >= 0 && brightness <= 100) {
                    if (this.debug)
                        this.log(`getBrightness() brightness is currently at ${brightness}%`);
                    callback(null, brightness);
                }
                else {
                    this.log("getBrightness() brightness is not in range of 0-100 % (actual: %s)", brightness);
                    callback(new Error("invalid range"));
                }
            }
        });
    },

    setBrightness: function (brightness, callback) {
        const brightnessPercentage = brightness;
        if (this.brightness.unit === BrightnessUnit.RGB)
            brightness = Math.floor((brightness * 255) / 100);

        if (this.brightness.withholdPowerUpdate)
            this.withholdPowerCall = true;

        // setting a timeout will make sure that possible ON requests receive first. For some devices this is important
        setTimeout(() => {
            http.httpRequest(this.brightness.setUrl, (error, response, body) => {
                    if (error) {
                        this.log("setBrightness() failed: %s", error.message);
                        callback(error);
                    }
                    else if (!http.isHttpSuccessCode(response.statusCode)) {
                        this.log(`setBrightness() http request returned http error code ${response.statusCode}: ${body}`);
                        callback(new Error("Got html error code " + response.statusCode));
                    }
                    else {
                        if (this.debug)
                            this.log(`setBrightness() Successfully set brightness to ${brightnessPercentage}%. Body: '${body}'`);

                        callback();
                    }
                }, {searchValue: "%s", replacer: `${brightness}`}, this._collectCurrentValuesForReplacer(Characteristic.Brightness));
        }, 0);
    },

    getHue: function (callback) {
        http.httpRequest(this.hue.statusUrl, (error, response, body) => {
           if (error) {
               this.log("getHue() failed: %s", error.message);
               callback(error);
           }
           else if (!http.isHttpSuccessCode(response.statusCode)) {
               this.log(`getHue() http request returned http error code ${response.statusCode}: ${body}`);
               callback(new Error("Got html error code " + response.statusCode));
           }
           else {
               if (this.debug)
                   this.log(`getHue() request returned successfully (${response.statusCode}). Body '${body}'`);

               let hue;
               try {
                   hue = this.extractNumberFromPattern(this.hue.statusPattern, body);
               } catch (error) {
                   this.log("getHue() error occurred while extracting hue from body: " + error.message);
                   callback(new Error("pattern error"));
                   return;
               }

               if (hue >= 0 && hue <= 360) {
                   if (this.debug)
                       this.log("getHue() hue is currently at %s", hue);
                   callback(null, hue);
               }
               else {
                   this.log("getHue() hue is not in range of 0-360 (actual: %s)", hue);
                   callback(new Error("invalid range"));
               }
           }
        });
    },

    setHue: function (hue, callback) {
        http.httpRequest(this.hue.setUrl, (error, response, body) => {
            if (error) {
                this.log("setHue() failed: %s", error.message);
                callback(error);
            }
            else if (!http.isHttpSuccessCode(response.statusCode)) {
                this.log(`setHue() http request returned http error code ${response.statusCode}: ${body}`);
                callback(new Error("Got html error code " + response.statusCode));
            }
            else {
                if (this.debug)
                    this.log(`setHue() Successfully set hue to ${hue}. Body: '${body}'`);

                callback();
            }
        }, {searchValue: "%s", replacer: `${hue}`}, this._collectCurrentValuesForReplacer(Characteristic.Hue));
    },

    getSaturation: function (callback) {
        http.httpRequest(this.saturation.statusUrl, (error, response, body) => {
            if (error) {
                this.log("getSaturation() failed: %s", error.message);
                callback(error);
            }
            else if (!http.isHttpSuccessCode(response.statusCode)) {
                this.log(`getSaturation() http request returned http error code ${response.statusCode}: ${body}`);
                callback(new Error("Got html error code " + response.statusCode));
            }
            else {
                if (this.debug)
                    this.log(`getSaturation() request returned successfully (${response.statusCode}). Body '${body}'`);

                let saturation;
                try {
                    saturation = this.extractNumberFromPattern(this.saturation.statusPattern, body);
                } catch (error) {
                    this.log("getSaturation() error occurred while extracting saturation from body: " + error.message);
                    callback(new Error("pattern error"));
                    return;
                }

                if (saturation >= 0 && saturation <= 100) {
                    if (this.debug)
                        this.log("getSaturation() saturation is currently at %s", saturation);
                    callback(null, saturation);
                }
                else {
                    this.log("getSaturation() saturation is not in range of 0-100 (actual: %s)", saturation);
                    callback(new Error("invalid range"));
                }
            }
        });
    },

    setSaturation: function (saturation, callback) {
        http.httpRequest(this.saturation.setUrl, (error, response, body) => {
            if (error) {
                this.log("setSaturation() failed: %s", error.message);
                callback(error);
            }
            else if (!http.isHttpSuccessCode(response.statusCode)) {
                this.log(`setSaturation() http request returned http error code ${response.statusCode}: ${body}`);
                callback(new Error("Got html error code " + response.statusCode));
            }
            else {
                if (this.debug)
                    this.log(`setSaturation() Successfully set saturation to ${saturation}. Body: '${body}'`);

                callback();
            }
        }, {searchValue: "%s", replacer: `${saturation}`}, this._collectCurrentValuesForReplacer());
    },

    getColorTemperature: function (callback) {
        http.httpRequest(this.colorTemperature.statusUrl, (error, response, body) => {
            if (error) {
                this.log("getColorTemperature() failed: %s", error.message);
                callback(error);
            }
            else if (!http.isHttpSuccessCode(response.statusCode)) {
                this.log(`getColorTemperature() http request returned http error code ${response.statusCode}: ${body}`);
                callback(new Error("Got html error code " + response.statusCode));
            }
            else {
                if (this.debug)
                    this.log(`getColorTemperature() request returned successfully (${response.statusCode}). Body '${body}'`);

                let colorTemperature;
                try {
                    colorTemperature = this.extractNumberFromPattern(this.colorTemperature.statusPattern, body);
                } catch (error) {
                    this.log("getColorTemperature() error occurred while extracting colorTemperature from body: " + error.message);
                    callback(new Error("pattern error"));
                    return;
                }

                if (this.colorTemperature.unit === TemperatureUnit.KELVIN)
                    colorTemperature = Math.floor(1000000 / colorTemperature); // converting Kelvin to mired

                if (colorTemperature >= this.colorTemperature.minValue && colorTemperature <= this.colorTemperature.maxValue) {
                    if (this.debug)
                        this.log(`getColorTemperature() colorTemperature is currently at ${colorTemperature} Mired`);
                    callback(null, colorTemperature);
                }
                else {
                    this.log("getColorTemperature() colorTemperature is not in range of 0-100 (actual: %s)", colorTemperature);
                    callback(new Error("invalid range"));
                }
            }
        });
    },

    setColorTemperature: function (colorTemperature, callback) {
        const colorTemperatureMired = colorTemperature;
        if (this.colorTemperature.unit === TemperatureUnit.KELVIN)
            colorTemperature = Math.floor(1000000 / colorTemperature); // converting mired to Kelvin

        http.httpRequest(this.colorTemperature.setUrl, (error, response, body) => {
            if (error) {
                this.log("setColorTemperature() failed: %s", error.message);
                callback(error);
            }
            else if (!http.isHttpSuccessCode(response.statusCode)) {
                this.log(`setColorTemperature() http request returned http error code ${response.statusCode}: ${body}`);
                callback(new Error("Got html error code " + response.statusCode));
            }
            else {
                if (this.debug)
                    this.log(`setColorTemperature() Successfully set colorTemperature to ${colorTemperatureMired} Mired. Body: '${body}'`);

                callback();
            }
        }, {searchValue: "%s", replacer: `${colorTemperature}`}, this._collectCurrentValuesForReplacer());
    },

    _collectCurrentValuesForReplacer: function() {
        const args = [];

        if (this.brightness) {
            const brightness = this.homebridgeService.getCharacteristic(Characteristic.Brightness).value;
            args.push({searchValue: "%brightness", replacer: `${brightness}`});
        }
        if (this.hue) {
            const hue = this.homebridgeService.getCharacteristic(Characteristic.Hue).value;
            args.push({searchValue: "%hue", replacer: `${hue}`});
        }
        if (this.saturation) {
            const saturation = this.homebridgeService.getCharacteristic(Characteristic.Saturation).value;
            args.push({searchValue: "%saturation", replacer: `${saturation}`});
        }
        /** @namespace Characteristic.ColorTemperature */
        if (this.colorTemperature) {
            const colorTemperature = this.homebridgeService.getCharacteristic(Characteristic.ColorTemperature).value;
            args.push({searchValue: "%colorTemperature", replacer: `${colorTemperature}`});
        }

        return args;
    },

};