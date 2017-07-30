"use strict";

var Service, Characteristic;
var request = require("request");

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

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
}

HTTP_LIGHTBULB.prototype = {

    identify: function (callback) {
        this.log("Identify requested!");
        callback();
    },

    getServices: function () {
        return [this.homebridgeService];
    },

    getPowerState: function (callback) {
        var that = this;

        this._doRequest("getPowerState", this.power.statusUrl, "GET", "power.statusUrl", callback, function (body) {
            var powerOn = parseInt(body) > 0;
            that.log("power is currently %s", powerOn? "ON": "OFF");

            callback(null, powerOn);
        });
    },

    setPowerState: function (on, callback) {
        var that = this;

        var url = on? this.power.onUrl: this.power.offUrl;
        var urlName = on? "power.onUrl": "power.offUrl";

        this._doRequest("setPowerState", url, this.power.httpMethod, urlName, callback, function (body) {
            that.log("power successfully set to %s", on? "ON": "OFF");

            callback(undefined, body);
        });
    },

    getBrightness: function (callback) {
        var that = this;

        this._doRequest("getBrightness", this.brightness.statusUrl, "GET", "brightness.statusUrl", callback, function (body) {
            var brightness = parseInt(body);
            that.log("brightness is currently at %s %", brightness);

            callback(null, brightness);
        });
    },

    setBrightness: function (brightness, callback) {
        var that = this;

        var url = this.brightness.setUrl;
        if (url)
            url = this.brightness.setUrl.replace("%s", brightness);

        this._doRequest("setBrightness", url, this.brightness.httpMethod, "brightness.setUrl", callback, function (body) {
            that.log("brightness successfully set to %s %", brightness);

            callback(undefined, body);
        });
    },

    getHue: function (callback) {
        var that = this;

        this._doRequest("getHue", this.hue.statusUrl, "GET", "hue.statusUrl", callback, function (body) {
            var hue = parseFloat(body);
            that.log("hue is currently at %s", hue);

            callback(null, hue);
        });
    },

    setHue: function (hue, callback) {
        var that = this;

        var url = this.hue.setUrl;
        if (url)
            url = this.hue.setUrl.replace("%s", hue);

        this._doRequest("setHue", url, this.hue.httpMethod, "hue.setUrl", callback, function (body) {
            that.log("hue successfully set to %s", hue);

            callback(undefined, body);
        })
    },

    getSaturation: function (callback) {
        var that = this;

        this._doRequest("getSaturation", this.saturation.statusUrl, "GET", "saturation.statusUrl", callback, function (body) {
            var saturation = parseFloat(body);
            that.log("saturation is currently at %s", saturation);

            callback(null, saturation);
        });
    },

    setSaturation: function (saturation, callback) {
        var that = this;

        var url = this.saturation.setUrl;
        if (url)
            url = this.saturation.setUrl.replace("%s", saturation);

        this._doRequest("setSaturation", url, this.saturation.httpMethod, "saturation.setUrl", callback, function (body) {
            that.log("saturation successfully set to %s", saturation);

            callback(undefined, body);
        })
    },

    _doRequest: function (methodName, url, httpMethod, urlName, callback, successCallback) {
        if (!url) {
            this.log.warn("Ignoring " + methodName + "() request, '" + urlName + "' is not defined!");
            callback(new Error("No '" + urlName + "' defined!"));
            return;
        }

        var that = this;

        request(
            {
                url: url,
                body: "",
                method: httpMethod,
                rejectUnauthorized: false
            },
            function (error, response, body) {
                if (error) {
                    that.log(methodName + "() failed: %s", error.message);
                    callback(error);
                }
                else if (response.statusCode !== 200) {
                    that.log(methodName + "() returned http error: %s", response.statusCode);
                    callback(new Error("Got http error code " + response.statusCode));
                }
                else {
                    successCallback(body);
                }
            }
        );
    }

};