"use strict";

let Service, Characteristic, api;

const _http_base = require("homebridge-http-base");
const http = _http_base.http;
const configParser = _http_base.configParser;
const PullTimer = _http_base.PullTimer;
const notifications = _http_base.notifications;
const MQTTClient = _http_base.MQTTClient;
const Cache = _http_base.Cache;
const utils = _http_base.utils;

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

const HueUnit = Object.freeze({
    HSV: "hsv",
    ZIGBEE: "zigbee"
});

const SaturationUnit = Object.freeze({
    PERCENT: "percent",
    RGB: "rgb",
});

const TemperatureUnit = Object.freeze({
    MICRORECIPROCAL_DEGREE: "mired",
    KELVIN: "kelvin",
});

/*
 * Describes the current color mode of the light.
 * This is only important when using Hue, Saturation and ColorTemperature characteristics together. If so the values
 * of the characteristics need to be synced up. When setting color temperature the Hue and Saturation characteristics
 * need to correctly represent the current color temperature via HSV otherwise the Home App gets a bit glitchy.
 */
const ColorMode = Object.freeze({
    UNDEFINED: "undefined",
    COLOR: "color",
    TEMPERATURE: "temperature",
});

function HTTP_LIGHTBULB(log, config) {
    this.log = log;
    this.name = config.name;
    this.debug = config.debug || false;

    this.colorMode = ColorMode.UNDEFINED;

    const success = this.parseCharacteristics(config);
    if (!success) {
        this.log.warn("Aborting...");
        return;
    }


    this.statusCache = new Cache(config.statusCache, 0);
    this.brightnessCache = new Cache(config.brightnessCache, 0);
    this.hueCache = new Cache(config.hueCache, 0);
    this.saturationCache = new Cache(config.saturationCache, 0);
    this.colorTemperatureCache = new Cache(config.colorTemperatureCache, 0);

    if (config.statusCache && typeof config.statusCache !== "number")
        this.log.warn("Property 'statusCache' was given in an unsupported type. Using default one!");
    if (config.brightnessCache && typeof config.brightnessCache !== "number")
        this.log.warn("Property 'brightnessCache' was given in an unsupported type. Using default one!");
    if (config.hueCache && typeof config.hueCache !== "number")
        this.log.warn("Property 'hueCache' was given in an unsupported type. Using default one!");
    if (config.saturationCache && typeof config.saturationCache !== "number")
        this.log.warn("Property 'saturationCache' was given in an unsupported type. Using default one!");
    if (config.colorTemperatureCache && typeof config.colorTemperatureCache !== "number")
        this.log.warn("Property 'colorTemperatureCache' was given in an unsupported type. Using default one!");


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

    const homebridgeService = new Service.Lightbulb(this.name);
    homebridgeService.getCharacteristic(Characteristic.On)
        .on("get", this.getPowerState.bind(this))
        .on("set", this.setPowerState.bind(this));
    if (this.brightness)
        homebridgeService.addCharacteristic(Characteristic.Brightness)
            .on("get", this.getBrightness.bind(this))
            .on("set", this.setBrightness.bind(this));
    if (this.hue)
        homebridgeService.addCharacteristic(Characteristic.Hue)
            .on("get", this.getHue.bind(this))
            .on("set", this.setHue.bind(this));
    if (this.saturation)
        homebridgeService.addCharacteristic(Characteristic.Saturation)
            .on("get", this.getSaturation.bind(this))
            .on("set", this.setSaturation.bind(this));
    if (this.colorTemperature)
        homebridgeService.addCharacteristic(Characteristic.ColorTemperature)
            .on("get", this.getColorTemperature.bind(this))
            .on("set", this.setColorTemperature.bind(this))
            .setProps({
                minValue: this.colorTemperature.minValue,
                maxValue: this.colorTemperature.maxValue
            });

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
                this.mqttClient = new MQTTClient(homebridgeService, options, this.log, this.debug);
                this.mqttClient.connect();
            } catch (error) {
                this.log.error("Error occurred creating mqtt client: " + error.message);
            }
        }
    }

    if (this.power.isMqtt) {
        if (!this.mqttClient) { // TODO maybe also somehow check if the client is connected
            this.log.warn("MQTT topics where specified however no mqtt client could be established. Is the 'mqtt' property specified?");
            return;
        }

        this.mqttClient.subscribe(this.power.getTopic, "On");
    }

    // config parse successfully and nothing can interrupt the startup anymore => so we assign the service to the global variable
    this.homebridgeService = homebridgeService;

    if (this.mqttClient) {
        this.mqttClient.on("message-On", this.handleMQTTMessage.bind(this));
        if (this.brightness)
            this.mqttClient.on("message-Brightness", this.handleMQTTMessage.bind(this));
        if (this.hue)
            this.mqttClient.on("message-Hue", this.handleMQTTMessage.bind(this));
        if (this.saturation)
            this.mqttClient.on("message-Saturation", this.handleMQTTMessage.bind(this));
        if (this.colorTemperature)
            this.mqttClient.on("message-ColorTemperature", this.handleMQTTMessage.bind(this));
    }

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

    parseCharacteristics: function (config) {
        this.power = {};

        /** @namespace config.setPowerTopic */
        /** @namespace config.getPowerTopic */
        if (config.setPowerTopic && config.getPowerTopic) {
            this.power.isMqtt = true;
            try {
                this.power.setTopic = configParser.parseMQTTSetTopicProperty(config.setPowerTopic);
            } catch (error) {
                this.log.warn(`Error occurred while parsing 'setPowerTopic': ${error.message}`);
                return false;
            }
            try {
                this.power.getTopic = configParser.parseMQTTGetTopicProperty(config.getPowerTopic);
            } catch (error) {
                this.log.warn(`Error occurred while parsing 'getPowerTopic': ${error.message}`);
                return false;
            }
        } else if ((config.onUrl || config.power.onUrl) && (config.offUrl || config.power.offUrl)
            && (config.statusUrl || config.power.statusUrl)) {
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
        } else {
            // couldn't detect which way to go
            this.log.warn("Couldn't detect a proper configuration for power!"); // TODO message
            return false;
        }

        this.power.statusPattern = /1/; // default pattern
        try {
            if (config.statusPattern) {
                // statusPattern didn't exist in v0.1.1, no need for backwards compatibility lol
                this.power.statusPattern = configParser.parsePattern(config.statusPattern);
            }
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

                this.brightness.unit = utils.enumValueOf(BrightnessUnit, config.brightness.unit, BrightnessUnit.PERCENT);
                if (!this.brightness.unit) {
                    this.log.warn(`${config.brightness.unit} is a unsupported brightness unit!`);
                    return false;
                }

                this.brightness.statusPattern = /([0-9]{1,3})/; // default pattern
                try {
                    if (this.brightness.statusPattern)
                        this.brightness.statusPattern = configParser.parsePattern(config.brightness.statusPattern);
                } catch (error) {
                    this.log.warn("Property 'brightness.statusPattern' was given in an unsupported type. Using the default one!");
                }
                if (config.brightness.patternGroupToExtract) {
                    this.brightness.patternGroupToExtract = 1;

                    if (typeof config.brightness.patternGroupToExtract === "number")
                        this.brightness.patternGroupToExtract = config.brightness.patternGroupToExtract;
                    else
                        this.log.warn("Property 'brightness.patternGroupToExtract' must be a number! Using default value!");
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

                this.hue.unit = utils.enumValueOf(HueUnit, config.hue.unit, HueUnit.HSV);
                if (!this.hue.unit) {
                    this.log.warn(`${config.hue.unit} is a unsupported hue unit!`);
                    return false;
                }

                this.hue.statusPattern = this.hue.unit === HueUnit.HSV? /([0-9]{1,3})/: /([0-9]{1,5})/; // default pattern
                try {
                    if (this.hue.statusPattern)
                        this.hue.statusPattern = configParser.parsePattern(config.hue.statusPattern);
                } catch (error) {
                    this.log.warn("Property 'hue.statusPattern' was given in an unsupported type. Using the default one!");
                }
                if (config.hue.patternGroupToExtract) {
                    this.hue.patternGroupToExtract = 1;

                    if (typeof config.hue.patternGroupToExtract === "number")
                        this.hue.patternGroupToExtract = config.hue.patternGroupToExtract;
                    else
                        this.log.warn("Property 'hue.patternGroupToExtract' must be a number! Using default value!");
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

                this.saturation.unit = utils.enumValueOf(SaturationUnit, config.saturation.unit, SaturationUnit.PERCENT);
                if (!this.saturation.unit) {
                    this.log.warn(`${config.saturation.unit} is a unsupported saturation unit!`);
                    return false;
                }

                this.saturation.statusPattern = /([0-9]{1,3})/; // default pattern
                try {
                    if (this.saturation.statusPattern)
                        this.saturation.statusPattern = configParser.parsePattern(config.saturation.statusPattern);
                } catch (error) {
                    this.log.warn("Property 'saturation.statusPattern' was given in an unsupported type. Using the default one!");
                }
                if (config.saturation.patternGroupToExtract) {
                    this.saturation.patternGroupToExtract = 1;

                    if (typeof config.saturation.patternGroupToExtract === "number")
                        this.saturation.patternGroupToExtract = config.saturation.patternGroupToExtract;
                    else
                        this.log.warn("Property 'saturation.patternGroupToExtract' must be a number! Using default value!");
                }
            }
            else {
                this.log.warn("Property 'saturation' needs to be an object!");
                return false;
            }
        }

        if (config.colorTemperature) {
            if (typeof config.colorTemperature === "object") {
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

                this.colorTemperature.unit = utils.enumValueOf(TemperatureUnit, config.colorTemperature.unit, TemperatureUnit.MICRORECIPROCAL_DEGREE);
                if (!this.colorTemperature.unit) {
                    this.log.warn(`${config.colorTemperature.unit} is a unsupported temperature unit!`);
                    return false;
                }

                this.colorTemperature.statusPattern = this.colorTemperature.unit === TemperatureUnit.MICRORECIPROCAL_DEGREE? /([0-9]{2,3})/: /([0-9]{4,5})/; // default pattern
                try {
                    if (this.colorTemperature.statusPattern)
                        this.colorTemperature.statusPattern = configParser.parsePattern(config.colorTemperature.statusPattern);
                } catch (error) {
                    this.log.warn("Property 'colorTemperature.statusPattern' was given in an unsupported type. Using the default one!");
                }
                if (config.colorTemperature.patternGroupToExtract) {
                    this.colorTemperature.patternGroupToExtract = 1;

                    if (typeof config.colorTemperature.patternGroupToExtract === "number")
                        this.colorTemperature.patternGroupToExtract = config.colorTemperature.patternGroupToExtract;
                    else
                        this.log.warn("Property 'colorTemperature.patternGroupToExtract' must be a number! Using default value!");
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

    handleNotification: function (body) {
        if (!this.homebridgeService.testCharacteristic(body.characteristic)) {
            this.log("Encountered unknown characteristic when handling notification (or characteristic which wasn't added to the service): " + body.characteristic);
            return;
        }

        let value = body.value;

        if (body.characteristic === "On" && this.pullTimer)
            this.pullTimer.resetTimer();
        if (body.characteristic === "Brightness" && this.brightness.unit === BrightnessUnit.RGB)
            value = Math.round((value / 254) * 100);
        if (body.characteristic === "Hue" && this.hue.unit === HueUnit.ZIGBEE)
            value = Math.round((value / 360) * 65535);
        if (body.characteristic === "Saturation" && this.saturation.unit === SaturationUnit.RGB)
            value = Math.round((value / 254) * 100);
        if (body.characteristic === "ColorTemperature" && this.colorTemperature.unit === TemperatureUnit.KELVIN)
            value = Math.round(1000000 / value);

        // TODO make this configurable if such requests should change the colorMode, could be unwanted
        if (body.characteristic === "Hue" || body.characteristic === "Saturation")
            this.colorMode = ColorMode.COLOR;
        if (body.characteristic === "ColorTemperature")
            this.colorMode = ColorMode.TEMPERATURE;

        this.log("Updating '" + body.characteristic + "' to new value: " + body.value);
        this.homebridgeService.getCharacteristic(body.characteristic).updateValue(value);

        if (this.characteristic === "ColorTemperature")
            this._updateColorByColorTemperature(value);
    },

    handleMQTTMessage: function (value, callback, characteristic) {
        if (characteristic === "On" && this.pullTimer)
            this.pullTimer.resetTimer();
        if (characteristic === "Brightness" && this.brightness.unit === BrightnessUnit.RGB)
            value = Math.round((value / 254) * 100);
        if (characteristic === "Hue" && this.hue.unit === HueUnit.ZIGBEE)
            value = Math.round((value / 360) * 65535);
        if (characteristic === "Saturation" && this.saturation.unit === SaturationUnit.RGB)
            value = Math.round((value / 254) * 100);
        if (characteristic === "ColorTemperature" && this.colorTemperature.unit === TemperatureUnit.KELVIN)
            value = Math.round(1000000 / value);

        // TODO make this configurable if such requests should change the colorMode, could be unwanted
        if (characteristic === "Hue" || characteristic === "Saturation")
            this.colorMode = ColorMode.COLOR;
        if (characteristic === "ColorTemperature")
            this.colorMode = ColorMode.TEMPERATURE;

        callback(value);
    },

    getPowerState: function (callback) {
        if (this.pullTimer)
            this.pullTimer.resetTimer();

        // if mqtt is enabled just return the current value
        if (this.power.isMqtt || !this.statusCache.shouldQuery()) {
            const value = this.homebridgeService.getCharacteristic(Characteristic.On).value;
            if (this.debug) // TODO adjust log message if we got here because mqtt was enabled
                this.log(`getPowerState() returning cached value '${value? "ON": "OFF"}'${this.statusCache.isInfinite()? " (infinite cache)": ""}`);

            callback(null, value);
            return;
        }

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

                this.statusCache.queried();
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

        if (!this.power.isMqtt) {
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
        } else {
            this.mqttClient.publish(this.power.setTopic, on);
        }
    },

    getBrightness: function (callback) {
        if (!this.brightnessCache.shouldQuery()) {
            const value = this.homebridgeService.getCharacteristic(Characteristic.Brightness).value;
            if (this.debug)
                this.log(`getBrightness() returning cached value '${value}'${this.brightnessCache.isInfinite()? " (infinite cache)": ""}`);

            callback(null, value);
            return;
        }

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
                    brightness = utils.extractValueFromPattern(this.brightness.statusPattern, body, this.brightness.patternGroupToExtract);
                } catch (error) {
                    this.log("getBrightness() error occurred while extracting brightness from body: " + error.message);
                    callback(new Error("pattern error"));
                    return;
                }

                if (this.brightness.unit === BrightnessUnit.RGB)
                    brightness = Math.round((brightness / 254) * 100);

                if (brightness >= 0 && brightness <= 100) {
                    if (this.debug)
                        this.log(`getBrightness() brightness is currently at ${brightness}%`);

                    this.brightnessCache.queried();
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
            brightness = Math.round((brightness * 254) / 100);

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
        if (!this.hueCache.shouldQuery() || this.colorMode === ColorMode.TEMPERATURE) {
            const value = this.homebridgeService.getCharacteristic(Characteristic.Hue).value;
            if (this.debug)
                this.log(`getHue() returning cached value '${value}'${this.hueCache.isInfinite()? " (infinite cache)": ""}`);

            callback(null, value);
            return;
        }

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
                   hue = utils.extractValueFromPattern(this.hue.statusPattern, body, this.hue.patternGroupToExtract);
               } catch (error) {
                   this.log("getHue() error occurred while extracting hue from body: " + error.message);
                   callback(new Error("pattern error"));
                   return;
               }

               if (this.hue.unit === HueUnit.ZIGBEE)
                   hue = Math.round((hue * 360) / 65535);

               if (hue >= 0 && hue <= 360) {
                   if (this.debug)
                       this.log("getHue() hue is currently at %s", hue);

                   this.hueCache.queried();
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
        const hueHSV = hue;
        if (this.hue.unit === HueUnit.ZIGBEE)
            hue = Math.round((hue / 360) * 65535);

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
                    this.log(`setHue() Successfully set hue to ${hueHSV}. Body: '${body}'`);

                this.colorMode = ColorMode.COLOR;
                callback();
            }
        }, {searchValue: "%s", replacer: `${hue}`}, this._collectCurrentValuesForReplacer(Characteristic.Hue));
    },

    getSaturation: function (callback) {
        if (!this.saturationCache.shouldQuery() || this.colorMode === ColorMode.TEMPERATURE) {
            const value = this.homebridgeService.getCharacteristic(Characteristic.Saturation).value;
            if (this.debug)
                this.log(`getSaturation() returning cached value '${value}'${this.saturationCache.isInfinite()? " (infinite cache)": ""}`);

            callback(null, value);
            return;
        }

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
                    saturation = utils.extractValueFromPattern(this.saturation.statusPattern, body, this.saturation.patternGroupToExtract);
                } catch (error) {
                    this.log("getSaturation() error occurred while extracting saturation from body: " + error.message);
                    callback(new Error("pattern error"));
                    return;
                }

                if (this.saturation.unit === SaturationUnit.RGB)
                    saturation = Math.round((saturation / 254) * 100);

                if (saturation >= 0 && saturation <= 100) {
                    if (this.debug)
                        this.log("getSaturation() saturation is currently at %s%", saturation);

                    this.saturationCache.queried();
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
        const saturationPercentage = saturation;
        if (this.saturation.unit === SaturationUnit.RGB)
            saturation = Math.round((saturation * 254) / 100);

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
                    this.log(`setSaturation() Successfully set saturation to ${saturationPercentage}%. Body: '${body}'`);

                this.colorMode = ColorMode.COLOR;
                callback();
            }
        }, {searchValue: "%s", replacer: `${saturation}`}, this._collectCurrentValuesForReplacer());
    },

    getColorTemperature: function (callback) {
        if (!this.colorTemperatureCache.shouldQuery()) {
            const value = this.homebridgeService.getCharacteristic(Characteristic.ColorTemperature).value;
            if (this.debug)
                this.log(`getColorTemperature() returning cached value '${value}'${this.colorTemperatureCache.isInfinite()? " (infinite cache)": ""}`);

            callback(null, value);
            return;
        }

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
                    colorTemperature = utils.extractValueFromPattern(this.colorTemperature.statusPattern, body, this.colorTemperature.patternGroupToExtract);
                } catch (error) {
                    this.log("getColorTemperature() error occurred while extracting colorTemperature from body: " + error.message);
                    callback(new Error("pattern error"));
                    return;
                }

                if (this.colorTemperature.unit === TemperatureUnit.KELVIN)
                    colorTemperature = Math.round(1000000 / colorTemperature); // converting Kelvin to mired

                if (colorTemperature >= this.colorTemperature.minValue && colorTemperature <= this.colorTemperature.maxValue) {
                    if (this.debug)
                        this.log(`getColorTemperature() colorTemperature is currently at ${colorTemperature} Mired`);

                    this.colorTemperatureCache.queried();
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
            colorTemperature = Math.round(1000000 / colorTemperature); // converting mired to Kelvin

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

                // when colorMode is set to TEMPERATURE the hue and saturation characteristics will return cached values
                // basically the values we calculate in #_updateColorByColorTemperature
                this.colorMode = ColorMode.TEMPERATURE;
                callback();

                this._updateColorByColorTemperature(colorTemperatureMired);
            }
        }, {searchValue: "%s", replacer: `${colorTemperature}`}, this._collectCurrentValuesForReplacer());
    },

    _collectCurrentValuesForReplacer: function() {
        const args = [];

        if (this.brightness) {
            let brightness = this.homebridgeService.getCharacteristic(Characteristic.Brightness).value;
            if (this.brightness.unit === BrightnessUnit.RGB)
                brightness = Math.round((brightness * 254) / 100);

            args.push({searchValue: "%brightness", replacer: `${brightness}`});
        }
        if (this.hue) {
            let hue = this.homebridgeService.getCharacteristic(Characteristic.Hue).value;
            if (this.hue.unit === HueUnit.ZIGBEE)
                hue = Math.round((hue / 360) * 65535);

            args.push({searchValue: "%hue", replacer: `${hue}`});
        }
        if (this.saturation) {
            let saturation = this.homebridgeService.getCharacteristic(Characteristic.Saturation).value;
            if (this.saturation.unit === BrightnessUnit.RGB)
                saturation = Math.round((saturation * 254) / 100);

            args.push({searchValue: "%saturation", replacer: `${saturation}`});
        }
        /** @namespace Characteristic.ColorTemperature */
        if (this.colorTemperature) {
            let colorTemperature = this.homebridgeService.getCharacteristic(Characteristic.ColorTemperature).value;
            if (this.colorTemperature.unit === TemperatureUnit.KELVIN)
                colorTemperature = Math.round(1000000 / colorTemperature);

            args.push({searchValue: "%colorTemperature", replacer: `${colorTemperature}`});
        }

        return args;
    },

    _updateColorByColorTemperature: function(colorTemperature) {
        if (!this.hue && !this.saturation)
            return;

        const rgbObject = this._temperatureToRGB(colorTemperature);
        const hsvObject = this._RGBtoHSV(rgbObject.red, rgbObject.green, rgbObject.blue);

        if (this.hue)
            this.homebridgeService.getCharacteristic(Characteristic.Hue).updateValue(hsvObject.hue);
        if (this.saturation)
            this.homebridgeService.getCharacteristic(Characteristic.Saturation).updateValue(hsvObject.saturation);
    },

    _temperatureToRGB(temperature) {
      // temperature gets passed in in Mired
      temperature = 1000000 / temperature; // algorithm needs temperature in Kelvin

      temperature /= 100;

        let red = 0;
        let green = 0;
        let blue = 0;

        if (temperature <= 66)
            red = 255;
        else {
            red = temperature - 60;
            red = 329.698727446 * (red ^ -0.1332047592);
            red = Math.min(Math.max(red, 0), 255);
        }

        if (temperature <= 66) {
            green = temperature;
            green = 99.4708025861 * Math.log(green) - 161.1195681661;
            green = Math.min(Math.max(green, 0), 255);
        } else {
            green = temperature - 60;
            green = 288.1221695283 * (green ^ -0.0755148492);
            green = Math.min(Math.max(green, 0), 255);
        }

        if (temperature >= 66)
            blue = 255;
        else {
            if (temperature <= 19)
                blue = 0;
            else {
                blue = temperature - 10;
                blue = 138.5177312231 * Math.log(blue) - 305.0447927307;
                blue = Math.min(Math.max(blue, 0), 255);
            }
        }

        return {red: red, green: green, blue: blue};
    },

    _RGBtoHSV: function(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;

        const max = Math.max(r, Math.max(g, b));
        const min = Math.min(r, Math.min(g, b));
        const delta = max - min;

        let h;
        let s = max === 0? 0: delta / max;
        let v = max;

        if (max === min) {
            h = 0;
        } else if (max === r) {
            // noinspection PointlessArithmeticExpressionJS
            h = 60 * (0 + (g-b) / delta);
        } else if (max === g) {
            h = 60 * (2 + (b-r) / delta);
        } else if (max === b) {
            h = 60 * (4 + (r-g) / delta);
        }

        return {hue: Math.round(h), saturation: Math.round(s * 100), value: Math.round(v * 100)};
    },

};
