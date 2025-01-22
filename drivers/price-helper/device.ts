import Homey from 'homey';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import Scheduler from '../scheduler';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import { PriceHandler } from '../price_handler';

module.exports = class Device extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    await this.addCapability('hour_shower');
    await this.setCapabilityOptions('hour_shower', {
      title: { en: 'Cheapest hours', nl: 'Goedkoopste uren' },
    });

    const showLowPrices = async () => {
      const priceHandler = await PriceHandler.makeInstance(7, 23);
      const lowHours = priceHandler.getOffsetBelowAverage(0.01);
      const averagePrice = priceHandler.getAverage() + PriceHandler.getEssentMargin();

      const curLang = this.homey.i18n.getLanguage();
      let text: string;
      switch (curLang) {
        case 'en':
          text = 'less than';
          break;
        case 'nl':
          text = 'minder dan';
          break;
        default:
          throw Error('Unsupported language');
      }

      const message = `${PriceHandler.hoursToString(lowHours)} ${text} €${averagePrice.toFixed(2)}`;
      await this.setCapabilityValue('hour_shower', message);
    };
    await showLowPrices();
    Scheduler.scheduleAsync(0, showLowPrices);

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
    this.log(`${this.getName()} settings where changed`);
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log(`${this.getName()} was renamed`);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log(`${this.getName()} has been deleted`);
  }

};
