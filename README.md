# homebridge-http-lightbulb Plugin

[![npm](https://img.shields.io/npm/v/homebridge-http-lightbulb?style=for-the-badge)](https://www.npmjs.com/package/homebridge-http-lightbulb)
[![npm](https://img.shields.io/npm/dt/homebridge-http-lightbulb?style=for-the-badge)](https://www.npmjs.com/package/homebridge-http-lightbulb)
[![GitHub Workflow Status](https://img.shields.io/github/workflow/status/Supereg/homebridge-http-lightbulb/Node-CI?style=for-the-badge)](https://github.com/Supereg/homebridge-http-lightbulb/actions?query=workflow%3A%22Node-CI%22)
[![GitHub issues](https://img.shields.io/github/issues/Supereg/homebridge-http-lightbulb?style=for-the-badge)](https://github.com/Supereg/homebridge-http-lightbulb/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/Supereg/homebridge-http-lightbulb?style=for-the-badge)](https://github.com/Supereg/homebridge-http-lightbulb/pulls)


`homebridge-http-lightbulb` is a [Homebridge](https://github.com/nfarina/homebridge) plugin with which you can configure 
HomeKit light bulbs which forward any requests to a defined http server. This comes in handy when you already have home 
automated equipment which can be controlled via http requests. Or you have built your own equipment, for example some sort 
of lightning controlled with an wifi enabled Arduino board which than can be integrated via this plugin into Homebridge.

## Installation

First of all you need to have [Homebridge](https://github.com/nfarina/homebridge) installed. Refer to the repo for 
instructions.  
Then run the following command to install `homebridge-http-lightbulb`

```
sudo npm install -g homebridge-http-lightbulb
```

## Updating the light bulb state in HomeKit

All characteristic from the _'lightbulb'_ service have the permission to `notify` the HomeKit controller of state 
changes. `homebridge-http-lightbulb` supports two concepts to send state changes to HomeKit.

### The 'pull' way:

The 'pull' way is probably the easiest to set up and supported in every scenario. `homebridge-http-lightbulb` requests the 
state of the light in an specified interval (pulling) and sends the value to HomeKit. 
However the pull way is currently only supported for the _'On'_ characteristic!  
Look for `pullInterval` in the list of configuration options if you want to configure it.

### The 'push' way:

When using the 'push' concept, the http device itself sends the updated value to `homebridge-http-lightbulb` whenever 
values change. This is more efficient as the new value is updated instantly and `homebridge-http-lightbulb` does not 
need to make needless requests when the value didn't actually change.  
However because the http device needs to actively notify the `homebridge-http-lightbulb` there is more work needed 
to implement this method into your http device. 

#### Using MQTT:

MQTT (Message Queuing Telemetry Transport) is a protocol widely used by IoT devices. IoT devices can publish messages
on a certain topic to the MQTT broker which then sends this message to all clients subscribed to the specified topic.
In order to use MQTT you need to setup a broker server ([mosquitto](https://github.com/eclipse/mosquitto) is a solid 
open source MQTT broker running perfectly on a device like the Raspberry Pi) and then instruct all clients to 
publish/subscribe to it.

#### Using 'homebridge-http-notification-server':

For those of you who are developing the http device by themselves I developed a pretty simple 'protocol' based on http 
to send push-updates.   
How to implement the protocol into your http device can be read in the chapter 
[**Notification Server**](#notification-server)

## Configuration:

The configuration can contain the following properties:

##### Basic configuration options:

- `accessory` \<string\> **required**: Defines the plugin used and must be set to **"HTTP-LIGHTBULB"** for this plugin.
- `name` \<string\> **required**: Defines the name which is later displayed in HomeKit

* `onUrl` \<string | [urlObject](#urlobject)\> **required**: Defines the url (and other properties when using 
    an urlObject) which is called when you turn on the light bulb.
* `offUrl` \<string | [urlObject](#urlobject)\> **required**: Defines the url (and other properties when using 
    an urlObject) which is called when you turn off the light bulb.
* `statusUrl` \<string | [urlObject](#urlobject)\> **required**: Defines the url (and other properties when using 
    an urlObject) to query the current power state from the light bulb. By default it expects the http server to 
    return **'1'** for ON and **'0'** for OFF leaving out any html markup.  
    You can change this using `statusPattern` option (see below).
* `statusPattern` \<string\> **optional** \(Default: **"1"**\): Defines a regex pattern which is compared to the 
    body of the http response from the `statusUrl`. When matching the status of the light bulb is set to ON otherwise OFF.  
    [More about regex pattern](https://www.w3schools.com/jsref/jsref_obj_regexp.asp).

- `brightness` \<object\> **optional**: Defines everything related to the _'Brightness'_ characteristic:
    - `setUrl` \<string | [urlObject](#urlobject)\> **required**: Defines the url (and other properties when using
        an urlObject) which is called when you set a new brightness level. The brightness is sent in the given unit.  
        When including **%s** in the url and/or body it will be with the brightness to set.
        Have a look at [placeholders](#placeholders-in-seturl-properties).
    - `statusUrl` \<string | [urlObject](#urlobject)\> **required**: Defines the url (and other properties when using 
        and urlObject) to query the current brightness level from the light bulb. By default it expects the http server 
        to return the brightness level in percent (range from 0-100). This can be changed with the `unit` property below.
    - `unit` \<string\> **optional** \(Default: **"percent"**\): Defines unit expected from the http server. The following 
        are available:
        - **"percent"**: Using percent to calculate brightness level
        - **"rgb"**: Using rgb style (range of 0-254) to calculate brightness level
    - `statusPattern` \<string\> **optional** \(Default: **"([0-9]{1,3})"**): Defines a regex pattern with which the 
        brightness is extracted from the body of the http response from the `brightness.statusUrl`. The group which should
        be extracted can be configured with the `brightness.patternGroupToExtract` property.
    - `patternGroupToExtract` <\number\> **optional** \(Default: **1**\): Defines the regex group of which the brightness 
        is extracted.
    - `withholdPowerUpdate` <\boolean\> **optional** \(Default: **false**\): The Home App has the quirk that when setting
        brightness it also send a request to turn the lamp on immediately afterwards. This may be annoying behaviour for
        some people. When this property is to to **true** the plugin prevents those requests.  
        It only lets pass requests:
        - (a) when brightness set to 0%. The http device will receive an 'off' requests
        - (b) when the device is powered off and the brightness is set to something greater than 0%. The device will 
            receive an 'on' requests

* `hue` \<object\> **optional**: Defines everything related to the _'Hue'_ characteristic:
    * `setUrl` \<string | [urlObject](#urlobject)\> **required**: Defines the url (and other properties when using
        an urlObject) which is called when you set a new hue.  
        When including **%s** in the url and/or body it will be replaced with the hue to set.
        Have a look at [placeholders](#placeholders-in-seturl-properties).
    * `statusUrl` \<string | [urlObject](#urlobject)\> **required**: Defines the url (and other properties when using 
        and urlObject) to query the current hue from the light bulb.
    * `unit` \<string\> **optional** \(Default: **"hsv"**\): Defines unit expected from the http server. The following 
        are available:
        - **"hsv"**: Using standard representation of hue in the HSV system (0-360 degree)
        - **"zigbee"**: Using a presentation which is popular in Zigbee bridges like the Phillips Hue bridge.
            The representation of 0-360 is mapped to a range of 0-65535.
    * `statusPattern` \<string\> **optional** \(Default: **"([0-9]{1,3})"** [**"/([0-9]{1,5})/"** when using zigbee unit]): 
        Defines a regex pattern with which the hue is extracted from the body of the http response from the 
        `hue.statusUrl`. The group which should be extracted can be configured with the 
        `hue.patternGroupToExtract` property.
    * `patternGroupToExtract` <\number\> **optional** \(Default: **1**\): Defines the regex group of which the hue 
        is extracted.

- `saturation` \<object\> **optional**: Defines everything related to the _'Saturation'_ characteristic:
    - `setUrl` \<string | [urlObject](#urlobject)\> **required**: Defines the url (and other properties when using
        an urlObject) which is called when you set a new saturation level.  
        When including **%s** in the url and/or body it will be replaced with the saturation to set.
        Have a look at [placeholders](#placeholders-in-seturl-properties).
    - `statusUrl` \<string | [urlObject](#urlobject)\> **required**: Defines the url (and other properties when using 
        and urlObject) to query the current saturation level from the light bulb.
    - `unit` \<string\> **optional** \(Default: **"percent"**\): Defines unit expected from the http server. The following 
        are available:
        - **"percent"**: Using percent to calculate saturation level
        - **"rgb"**: Using rgb style (range of 0-254) to calculate saturation level
    - `statusPattern` \<string\> **optional** \(Default: **"([0-9]{1,3})"**): Defines a regex pattern with which the 
        saturation is extracted from the body of the http response from the `saturation.statusUrl`. The group which should
        be extracted can be configured with the `saturation.patternGroupToExtract` property.
    - `patternGroupToExtract` <\number\> **optional** \(Default: **1**\): Defines the regex group of which the saturation 
        is extracted.

* `colorTemperature` \<object\> **optional**: Defines everything related to the _'ColorTemperature'_ characteristic:  
    _Although the HAP documentation states, that when using `colorTemperature`, `hue` and `saturation` must not 
    be defined, using all three in combination works perfectly fine.  
    When selecting something in the color selector the color is sent via the `Hue` and `Saturation` characteristics. 
    When selecting something in the temperature selector the temperature is sent via the `ColorTemperature` characteristic.  
    If `colorTemperature` is not specified, the color temperature is sent via the `Hue` and `Saturation` characteristics._
    * `setUrl` \<string | [urlObject](#urlobject)\> **required**: Defines the url (and other properties when using
        an urlObject) which is called when you set a new color temperature. The color temperature is sent in the given unit.  
        When including **%s** in the url and/or body it will be replaced with the color temperature to set.
        Have a look at [placeholders](#placeholders-in-seturl-properties).
    * `statusUrl` \<string | [urlObject](#urlobject)\> **required**: Defines the url (and other properties when using 
        and urlObject) to query the current color temperature from the light bulb. By default it expects the http server 
        to return the brightness level in mired. This can be changed with the `unit` property below.
    * `unit` \<string\> **optional** \(Default: **"mired"**\): Defines unit expected from the http server. The following 
        are available:
        * **"mired"**: Using mired (more specifically _microreciprocal degree_) to calculate color temperature
        * **"kelvin"**: Using Kelvin to calculate color temperature
    * `minValue` \<number\> **optional** \(Default: **50**\): Defines the minimum supported temperature in the 
        given `unit`. The defaut is **50** mired or **20.000** Kelvin.
    * `maxValue` \<number\> **optional** \(Default: **400**\): Defines the maximum supported temperature in the 
        given `unit`. The fault is **400** mired or **2.500** Kelvin.
    * `statusPattern` \<string\> **optional** \(Default: **"([0-9]{2,3})"** \[**"([0-9]{4,5})"** when using Kelvin\]): Defines a regex pattern with which the 
        color temperature is extracted from the body of the http response from the `colorTemperature.statusUrl`. 
        The group which should be extracted can be configured with the `colorTemperature.patternGroupToExtract` property.
    * `patternGroupToExtract` <\number\> **optional** \(Default: **1**\): Defines the regex group of which the color temperature 
        is extracted.

##### Advanced configuration options:

* `auth` \<object\> **optional**: If your http server requires authentication, you can specify your credential in this 
object. It uses those credentials for all http requests and thus overrides all possibly specified credentials inside 
an urlObject for any characteristic.  
The object can contain the following properties:
    * `username` \<string\> **required**
    * `password` \<string\> **required**
    * `sendImmediately` \<boolean\> **optional** \(Default: **true**\): When set to **true** the plugin will send the 
        credentials immediately to the http server. This is best practice for basic authentication.  
        When set to **false** the plugin will send the proper authentication header after receiving an 401 error code 
        (unauthenticated). The response from the http server must include a proper `WWW-Authenticate` header.  
        Digest authentication requires this property to be set to **false**!

- `statusCache` \<number\> **optional** \(Default: **0**\): Defines the amount of time in milliseconds a queried value 
   of the _On_ characteristic is cached before a new request is made to the http device.  
   Default is **0** which indicates no caching. A value of **-1** will indicate infinite caching.
- `brightnessCache` \<number\> **optional** \(Default: **0**\): Same as above, but for the _Brightness_ 
    characteristic
- `hueCache` \<number\> **optional** \(Default: **0**\): Same as above, but for the _Hue_ characteristic
- `saturationCache` \<number\> **optional** \(Default: **0**\): Same as above, but for the _Saturation_ 
    characteristic
- `colorTemperatureCache` \<number\> **optional** \(Default: **0**\): Same as above, but for the 
    _ColorTemperature_ characteristic

* `pullInterval` \<integer\> **optional**: The property expects an interval in **milliseconds** in which the plugin 
pulls updates from your http device. For more information read [pulling updates](#the-pull-way).  
(This option is currently only supported for the _'On'_ characteristic!)
* `mqtt` \<[mqttObject](#mqttobject)\> **optional**: Defines all properties used for mqtt connection ([More on MQTT](#using-mqtt)).  
    For configuration see [mqttObject](#mqttobject).

- `debug` \<boolean\> **optional**: If set to true debug mode is enabled and the plugin prints more detailed information.

In the [Examples](#examples) section are some example configurations to get you started.

##### Experimental configuration options

The options in this section are all part of some experimental features and can change in any update.  

I'm currently experimenting with allowing setting and querying device status with mqtt alongside http. 
So that you are for example able to manage the ON characteristic fully over mqtt and the color and 
brightness values over http. Currently this is only supported for the ON characteristic but I'm planning
to add this for any combination of characteristics and in the long run also to get added into my 
homebridge-http-switch plugin if everything works well.


* `setPowerTopic` \<string | object\> **optional**: Defines the mqtt topic to which a message is published when you
    turn the light on or off. 
    * `topic` \<string\> **required**:
    * `qos` \<number\> **optional** \(Default: **0**\):
    * `retain` \<boolean\> **optional** \(Default: **false**\):
    * `dup` \<boolean\> **optional** \(Default: **false**\):
    * `payloadFormatter` \<function body\> **optional**:
* `getPowerTopic` \<string | object\> **optional**: Defines the mqtt topic which is subscribed to in order
    to receive updates of the current power state of the light.
    * `topic` \<string\> **required**:
    * `qos` \<number\> **optional** \(Default: **0**\):
    * `messagePattern` \<string\> **optional**:
    * `patternGroupToExtract` \<number\> **optional** \(Default: **1**\):

##### Placeholders in `setUrl` properties
On every set there are the following placeholders available which will be replaced with the respective value.  
Note that for example when the `setUrl` for the brightness characteristic is called, `%s` will be replaced with the 
**new** value and `%brightness` will be replaced with the **current**/**old** value.  
The value for the placeholders will be supplied in the specified unit.

- `%s` will always be replaced with the **new** value which will be set for the current characteristic
- `%brightness` - current brightness level
- `%hue` - current hue
- `%saturation` - current saturation
- `%colorTemperature` - current color temperature (case sensitise)

#### UrlObject

A urlObject can have the following properties:
* `url` \<string\> **required**: Defines the url pointing to your http server
* `method` \<string\> **optional** \(Default: **"GET"**\): Defines the http method used to make the http request
* `body` \<any\> **optional**: Defines the body sent with the http request. This is usually a string for maximum flexibility with [placeholders](#placeholders-in-seturl-properties). If the value is not a string, it will be
converted to a JSON string automatically.
* `strictSSL` \<boolean\> **optional** \(Default: **false**\): If enabled the SSL certificate used must be valid and 
the whole certificate chain must be trusted. The default is false because most people will work with self signed 
certificates in their homes and their devices are already authorized since being in their networks.
* `auth` \<object\> **optional**: If your http server requires authentication you can specify your credential in this 
object. When defined the object can contain the following properties:
    * `username` \<string\> **required**
    * `password` \<string\> **required**
    * `sendImmediately` \<boolean\> **optional** \(Default: **true**\): When set to **true** the plugin will send the 
            credentials immediately to the http server. This is best practice for basic authentication.  
            When set to **false** the plugin will send the proper authentication header after receiving an 401 error code 
            (unauthenticated). The response must include a proper `WWW-Authenticate` header.  
            Digest authentication requires this property to be set to **false**!
* `headers` \<object\> **optional**: Using this object you can define any http headers which are sent with the http 
request. The object must contain only string key value pairs.  
  
Below is an example of an urlObject containing all properties:
```json
{
  "url": "http://example.com:8080",
  "method": "GET",
  "body": "exampleBody",
  
  "strictSSL": false,
  
  "auth": {
    "username": "yourUsername",
    "password": "yourPassword"
  },
  
  "headers": {
    "Content-Type": "text/html"
  }
}
```

#### MQTTObject

A mqttObject can have the following properties:

##### Basic configuration options:

* `host` \<string\> **required**: Defines the host of the mqtt broker.
* `port` \<number\> **optional** \(Default: **1883**\): Defines the port of the mqtt broker.
* `credentials` \<object\> **optional**: Defines the credentials used to authenticate with the mqtt broker.
    * `username` \<string\> **required**
    * `password` \<string\> **optional**
- `subscriptions` \<object | array\> **required**: Defines an array (or one single object) of subscriptions.
    - `topic` \<string\> **required**: Defines the topic to subscribe to.
    - `characteristic` \<string\> **required**: Defines the characteristic this subscription updates.
    - `messagePattern` \<string\> **optional**: Defines a regex pattern. If `messagePattern` is not specified the 
        message received will be used as value. If the characteristic expects a boolean value it is tested if the 
        specified regex is contained in the received message. Otherwise the pattern is matched against the message 
        and the data from regex group can be extracted using the given `patternGroupToExtract`.
    - `patternGroupToExtract` \<number\> **optional** \(Default: **1**\): Defines the regex group of which data is 
        extracted.

##### Advanced configuration options:

* `protocol` \<string\> **optional** \(Default: **"mqtt"**\): Defines protocol used to connect to the mqtt broker
* `qos` \<number\> **optional** \(Default: **1**\): Defines the Quality of Service (Notice, the QoS of the publisher 
           must also be configured accordingly).  
           In contrast to most implementations the default value is **1**.
    * `0`: 'At most once' - the message is sent only once and the client and broker take no additional steps to 
                            acknowledge delivery (fire and forget).
    * `1`: 'At least once' - the message is re-tried by the sender multiple times until acknowledgement is 
                            received (acknowledged delivery).
    * `2`: 'Exactly once' - the sender and receiver engage in a two-level handshake to ensure only one copy of the 
                            message is received (assured delivery).
* `clientId` \<string\> **optional** \(Default: `'mqttjs_' + Math.random().toString(16).substr(2, 8)`\): Defines clientId
* `keepalive` \<number\> **optional** \(Default: **60**\): Time in seconds to send a keepalive. Set to 0 to disable.
* `clean` \<boolean\> **optional** \(Default: **true**\): Set to false to receive QoS 1 and 2 messages while offline.
* `reconnectPeriod` \<number\> **optional** \(Default: **1000**\): Time in milliseconds after which a reconnect is tried.
* `connectTimeout` \<number\> **optional** \(Default: **30000**\): Time in milliseconds the client waits until the 
        CONNECT needs to be acknowledged (CONNACK).

Below is an example of an mqttObject containing the basic properties for a light bulb service:
```json
{
  "host": "127.0.0.1",
  "port": "1883",
  
  "credentials": {
    "username": "yourUsername",
    "password": "yourPassword"
  },
  
  "subscriptions": [
    {
      "topic": "your/topic/here",
      "characteristic": "On",
      "messagePattern": "on"
    },
    {
      "topic": "your/other/topic/here",
      "characteristic": "Brightens",
      "messagePattern": "([0-9]{1,3})"
    }
  ]
}
```

### Examples

#### Basic light bulb with power and brightness
This is a basic light bulb configuration supporting the required On and the optional brightness characteristic.  
Note that every url is simply a string and are only examples. You could also define every url using a [urlObject](#urlobject).
````json
{
  "accessory": "HTTP-LIGHTBULB",
  "name": "Light",
  
  "onUrl": "http://localhost/api/lightOn",
  "offUrl": "http://localhost/api/lightOff",
  "statusUrl": "http://localhost/api/lightStatus",

  "brightness": {
    "setUrl": "http://localhost/api/setBrightness?brightness=%s",
    "statusUrl": "http://localhost/api/getBrightness"
  }
}
````

#### Light bulb supporting color

````json
{
  "accessory": "HTTP-LIGHTBULB",
  "name": "Light",
  
  "onUrl": "http://localhost/api/lightOn",
  "offUrl": "http://localhost/api/lightOff",
  "statusUrl": "http://localhost/api/lightStatus",
  
  "brightness": {
    "setUrl": "http://localhost/api/setBrightness?brightness=%s",
    "statusUrl": "http://localhost/api/getBrightness"
  },
  
  "hue": {
    "setUrl": "http://localhost/api/setHue?hue=%s",
    "statusUrl": "http://localhost/api/getHue"
  },
  "saturation": {
    "setUrl": "http://localhost/api/setSaturation?saturation=%s",
    "statusUrl": "http://localhost/api/getSaturation"
  }
}
````

#### Light bulb support color temperature
````json
{
  "accessory": "HTTP-LIGHTBULB",
  "name": "Light",
  
  "onUrl": "http://localhost/api/lightOn",
  "offUrl": "http://localhost/api/lightOff",
  "statusUrl": "http://localhost/api/lightStatus",
    
  "brightness": {
    "setUrl": "http://localhost/api/setBrightness?brightness=%s",
    "statusUrl": "http://localhost/api/getBrightness"
  },
  
  "colorTemperature": {
    "setUrl": "http://localhost/api/setColorTemperature?temperature=%s",
    "statusUrl": "http://localhost/api/getColorTemperature",
    "unit": "mired"
  }
}
````

#### Light bulb using body parameters
````json
{
  "accessory": "HTTP-LIGHTBULB",
  "name": "Light",
  "debug": true,
  "onUrl": {
    "url": "http://localhost/api/light",
    "method": "PUT",
    "body": "{ \"on\": 1 }"
  },
  "offUrl": {
    "url": "http://localhost/api/light",
    "method": "PUT",
    "body": "{ \"on\": 0 }"
  },
  "statusUrl": "http://localhost/api/light",
  "brightness": {
    "statusUrl": "http://localhost/api/light",
    "setUrl": {
      "url": "http://localhost/api/light",
      "method": "PUT",
      "body": "{ \"brightness\": %s }"
    }
  },
  "colorTemperature": {
    "statusUrl": "http://localhost/api/light",
    "unit": "mired",
    "minValue": 143,
    "maxValue": 344,
    "setUrl": {
      "url": "http://localhost/api/light",
      "method": "PUT",
      "body": "{\"temperature\": %s }"
    }
  }
}
````

## Notification Server

`homebridge-http-lightbulb` can be used together with 
[homebridge-http-notification-server](https://github.com/Supereg/homebridge-http-notification-server) in order to receive
updates when the state changes at your external program. For details on how to implement those updates and how to 
install and configure `homebridge-http-notification-server`, please refer to the 
[README](https://github.com/Supereg/homebridge-http-notification-server) of the repository first.

Down here is an example on how to configure `homebridge-http-lightbulb` to work with your implementation of the 
`homebridge-http-notification-server`.

```json
{
    "accessories": [
        {
          "accessory": "HTTP-LIGHTBULB",
          "name": "Light",
          
          "notificationID": "my-switlightch",
          "notificationPassword": "superSecretPassword",
          
          "onUrl": "http://localhost/api/lightOn",
          "offUrl": "http://localhost/api/lightOff",
          
          "statusUrl": "http://localhost/api/lightStatus"
        }   
    ]
}
```

* `notificationID` is an per Homebridge instance unique id which must be included in any http request.  
* `notificationPassword` is **optional**. It can be used to secure any incoming requests.

To get more details about the configuration have a look at the 
[README](https://github.com/Supereg/homebridge-http-notification-server).

**Available characteristics (for the POST body)**

Down here are all characteristics listed which can be updated with an request to the `homebridge-http-notification-server`

* `characteristic` "On": expects a boolean `value`
* `characteristic` "Brightness": expects a number `value` in mired
* `characteristic` "Hue": expects a number `value`
* `characteristic` "Saturation": expects a number `value`
* `characteristic` "ColorTemperature": expects a number `value` TODO
