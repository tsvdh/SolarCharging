'use strict';

import Homey from 'homey';

module.exports = class ChargingDevice extends Homey.Device {

  hoursToCharge: number = -1;
  dayWhenCharged: number = -1;
  hourWhenCharged: number = -1;

  shouldChargeCalculator?: () => Promise<boolean>;

  days: string[][] = [
    ['Monday', 'Maandag'],
    ['Tuesday', 'Dinsdag'],
    ['Wednesday', 'Woensdag'],
    ['Thursday', 'Donderdag'],
    ['Friday', 'Vrijdag'],
    ['Saturday', 'Zaterdag'],
    ['Sunday', 'Zondag'],
  ];

  getDays(): object {
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push({ id: i.toString(), title: { en: this.days[i][0], nl: this.days[i][1] } });
    }
    return days;
  }

  getHours(): object {
    const hours = [];
    for (let i = 0; i < 24; i++) {
      hours.push({ id: i.toString(), title: i.toString() });
    }
    return hours;
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    await this.removeCapability('onoff');

    await this.removeCapability('lock_mode');

    await this.addCapability('lock_mode.status');
    await this.setCapabilityOptions('lock_mode.status', {
      title: { en: 'Status', nl: 'Status' },
      setable: false,
      values: [
        { id: 'charging', title: { en: 'Charging', nl: 'Opladen' } },
        { id: 'waiting', title: { en: 'Waiting', nl: 'Waiting' } },
      ],
    });

    await this.addCapability('lock_mode.day');
    await this.setCapabilityOptions('lock_mode.day', {
      title: { en: 'Day', nl: 'Dag' },
      values: this.getDays(),
    });

    this.registerCapabilityListener('lock_mode.day', async (value) => {
      this.dayWhenCharged = parseInt(value, 10);
    });

    await this.addCapability('lock_mode.hour');
    await this.setCapabilityOptions('lock_mode.hour', {
      title: { en: 'Hour', nl: 'Uur' },
      values: this.getHours(),
    });

    this.registerCapabilityListener('lock_mode.hour', async (value) => {
      this.hourWhenCharged = parseInt(value, 10);
    });

    this.shouldChargeCalculator = async () => {
      const formatter = new Intl.DateTimeFormat([], {
        timeZone: this.homey.clock.getTimezone(),
        hour: '2-digit',
        weekday: 'long',
        hour12: false,
      });

      const timeParts = formatter.formatToParts(new Date());
      const curHour = parseInt(timeParts.find((part) => part.type === 'hour')!.value, 10);
      const curDayName = timeParts.find((part) => part.type === 'weekday')!.value;

      let curDay = -1;
      for (let i = 0; i < 7; i++) {
        if (this.days[i][0] === curDayName) {
          curDay = i;
          break;
        }
      }

      if (curDay === -1) {
        this.homey.error(`Unknown weekday: ${curDayName}`);
      }

      const curHours = curHour + 24 * curDay;
      let wantedHours = this.hourWhenCharged + 24 * this.dayWhenCharged;

      if (wantedHours < curHours) {
        wantedHours += 24 * 7;
      }

      const shouldCharge = wantedHours - curHours <= this.hoursToCharge;
      if (shouldCharge) {
        await this.setCapabilityValue('lock_mode.status', 'charging');
      } else {
        await this.setCapabilityValue('lock_mode.status', 'waiting');
      }
      return shouldCharge;
    };

    const deviceShouldChargeCondition = this.homey.flow.getConditionCard('device-should-charge');
    deviceShouldChargeCondition.registerRunListener(this.shouldChargeCalculator);

    this.hoursToCharge = this.getSetting('charging_time');
    this.hourWhenCharged = parseInt(this.getCapabilityValue('lock_mode.hour'), 10);
    this.dayWhenCharged = parseInt(this.getCapabilityValue('lock_mode.day'), 10);

    this.log(`${this.getName()} has been initialized`);
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log(`${this.getName()} has been added`);
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    if ('charging_time' in changedKeys) {
      this.hoursToCharge = <number>newSettings['charging_time'];
      await this.shouldChargeCalculator?.();
    }

    this.log(`${this.getName()} ${changedKeys} settings were changed`);
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log(`${this.getName()} was renamed to ${name}`);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log(`${this.getName()} has been deleted`);
  }

};
