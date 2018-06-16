"use strict";

let Service, Characteristic, api;
const request = require("request");
const packageJSON = require("./package.json");

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    api = homebridge;

    homebridge.registerAccessory("homebridge-http-lightbulb", "HTTP-LIGHTBULB", HTTP_LIGHTBULB);
};

function HTTP_LIGHTBULB(log, config) {
    this.log = log;
    this.name = config.name;

    this.power = {};
    this.brightness = { enabled: false };
    this.hue = { enabled: false };
    this.saturation = { enabled: false };

    if (typeof config.power === 'object') {
        this.power.httpMethod = config.power.httpMethod || "GET";

        this.power.onUrl = config.power.onUrl;
        this.power.offUrl = config.power.offUrl;
        this.power.statusUrl = config.power.statusUrl;
    }

    if (typeof config.brightness === 'object') {
        this.brightness.enabled = true;

        this.brightness.httpMethod = config.brightness.httpMethod || "GET";

        this.brightness.setUrl = config.brightness.setUrl;
        this.brightness.statusUrl = config.brightness.statusUrl;
    }

    if (typeof config.hue === 'object') {
        this.hue.enabled = true;

        this.hue.httpMethod = config.hue.httpMethod || "GET";

        this.hue.setUrl = config.hue.setUrl;
        this.hue.statusUrl = config.hue.statusUrl;
    }

    if (typeof config.saturation === 'object') {
        this.saturation.enabled = true;

        this.saturation.httpMethod = config.saturation.httpMethod || "GET";

        this.saturation.setUrl = config.saturation.setUrl;
        this.saturation.statusUrl = config.saturation.statusUrl;
    }

    this.homebridgeService = new Service.Lightbulb(this.name);

    this.homebridgeService.getCharacteristic(Characteristic.On)
        .on("get", this.getPowerState.bind(this))
        .on("set", this.setPowerState.bind(this));

    if (this.brightness.enabled)
        this.homebridgeService.addCharacteristic(Characteristic.Brightness)
            .on("get", this.getBrightness.bind(this))
            .on("set", this.setBrightness.bind(this));

    if (this.hue.enabled)
        this.homebridgeService.addCharacteristic(Characteristic.Hue)
            .on("get", this.getHue.bind(this))
            .on("set", this.setHue.bind(this));

    if (this.saturation.enabled)
        this.homebridgeService.addCharacteristic(Characteristic.Saturation)
            .on("get", this.getSaturation.bind(this))
            .on("set", this.setSaturation.bind(this));

    this.notificationID = config.notificationID;
    this.notificationPassword = config.notificationPassword;

    if (this.notificationID) {
        api.on("didFinishLaunching", function () {
            if (api.notificationRegistration && typeof api.notificationRegistration === "function") {
                try {
                    api.notificationRegistration(this.notificationID, this.handleNotification.bind(this), this.notificationPassword);
                    this.log("Detected running notification server. Registered successfully!");
                } catch (error) {
                    this.log("Could not register notification handler. ID '" + this.notificationID + "' is already taken!")
                }
            }
        }.bind(this));
    }
}

HTTP_LIGHTBULB.prototype = {

    identify: function (callback) {
        this.log("Identify requested!");
        callback();
    },

    getServices: function () {
        const informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, "Andreas Bauer")
            .setCharacteristic(Characteristic.Model, "HTTP Lightbulb")
            .setCharacteristic(Characteristic.SerialNumber, "LB01")
            .setCharacteristic(Characteristic.FirmwareRevision, packageJSON.version);

        return [informationService, this.homebridgeService];
    },

    handleNotification: function (body) {
        const value = body.value;

        let characteristic;
        switch (body.characteristic) {
            case "On":
                characteristic = Characteristic.On;
                break;
            case "Brightness":
                characteristic = Characteristic.Brightness;
                break;
            case "Hue":
                characteristic = Characteristic.Hue;
                break;
            case "Saturation":
                characteristic = Characteristic.Saturation;
                break;
            default:
                this.log("Encountered unknown characteristic handling notification: " + body.characteristic);
                return;
        }

        this.log("Updating '" + body.characteristic + "' to new value: " + body.value);

        this.ignoreNextSet = true;
        this.homebridgeService.setCharacteristic(characteristic, value);
    },

    getPowerState: function (callback) {
        this._doRequest("getPowerState", this.power.statusUrl, "GET", "power.statusUrl", callback, function (body) {
            const powerOn = parseInt(body) > 0;
            this.log("power is currently %s", powerOn? "ON": "OFF");

            callback(null, powerOn);
        }.bind(this));
    },

    setPowerState: function (on, callback) {
        if (this.ignoreNextSet) {
            this.ignoreNextSet = false;
            callback(undefined);
            return;
        }

        const url = on ? this.power.onUrl : this.power.offUrl;
        const urlName = on ? "power.onUrl" : "power.offUrl";

        this._doRequest("setPowerState", url, this.power.httpMethod, urlName, callback, function (body) {
            this.log("power successfully set to %s", on? "ON": "OFF");

            callback(undefined, body);
        }.bind(this));
    },

    getBrightness: function (callback) {
        this._doRequest("getBrightness", this.brightness.statusUrl, "GET", "brightness.statusUrl", callback, function (body) {
            const brightness = parseInt(body);
            this.log("brightness is currently at %s %", brightness);

            callback(null, brightness);
        }.bind(this));
    },

    setBrightness: function (brightness, callback) {
        if (this.ignoreNextSet) {
            this.ignoreNextSet = false;
            callback(undefined);
            return;
        }

        let url = this.brightness.setUrl;
        if (url)
            url = this.brightness.setUrl.replace("%s", brightness);

        this._doRequest("setBrightness", url, this.brightness.httpMethod, "brightness.setUrl", callback, function (body) {
            this.log("brightness successfully set to %s %", brightness);

            callback(undefined, body);
        }.bind(this));
    },

    getHue: function (callback) {
        this._doRequest("getHue", this.hue.statusUrl, "GET", "hue.statusUrl", callback, function (body) {
            const hue = parseFloat(body);
            this.log("hue is currently at %s", hue);

            callback(null, hue);
        }.bind(this));
    },

    setHue: function (hue, callback) {
        if (this.ignoreNextSet) {
            this.ignoreNextSet = false;
            callback(undefined);
            return;
        }

        let url = this.hue.setUrl;
        if (url)
            url = this.hue.setUrl.replace("%s", hue);

        this._doRequest("setHue", url, this.hue.httpMethod, "hue.setUrl", callback, function (body) {
            this.log("hue successfully set to %s", hue);

            callback(undefined, body);
        }.bind(this));
    },

    getSaturation: function (callback) {
        this._doRequest("getSaturation", this.saturation.statusUrl, "GET", "saturation.statusUrl", callback, function (body) {
            const saturation = parseFloat(body);
            this.log("saturation is currently at %s", saturation);

            callback(null, saturation);
        }.bind(this));
    },

    setSaturation: function (saturation, callback) {
        if (this.ignoreNextSet) {
            this.ignoreNextSet = false;
            callback(undefined);
            return;
        }

        let url = this.saturation.setUrl;
        if (url)
            url = this.saturation.setUrl.replace("%s", saturation);

        this._doRequest("setSaturation", url, this.saturation.httpMethod, "saturation.setUrl", callback, function (body) {
            this.log("saturation successfully set to %s", saturation);

            callback(undefined, body);
        }.bind(this))
    },

    _doRequest: function (methodName, url, httpMethod, urlName, callback, successCallback) {
        if (!url) {
            this.log.warn("Ignoring " + methodName + "() request, '" + urlName + "' is not defined!");
            callback(new Error("No '" + urlName + "' defined!"));
            return;
        }

        request(
            {
                url: url,
                body: "",
                method: httpMethod,
                rejectUnauthorized: false
            },
            function (error, response, body) {
                if (error) {
                    this.log(methodName + "() failed: %s", error.message);
                    callback(error);
                }
                else if (response.statusCode !== 200) {
                    this.log(methodName + "() returned http error: %s", response.statusCode);
                    callback(new Error("Got http error code " + response.statusCode));
                }
                else {
                    successCallback(body);
                }
            }.bind(this)
        );
    }

};