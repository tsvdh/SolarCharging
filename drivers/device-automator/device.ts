import Homey from 'homey';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import { PriceHandler } from '../price_handler';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import DateHandler from '../date_handler';

module.exports = class Device extends Homey.Device {

  priceHandler!: PriceHandler;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.priceHandler = new PriceHandler(0, 23);
    this.log('Connected to DB');

    const shouldBeOnCalculator = async () => {
      const curHour = DateHandler.getDatePartLocalAsNumber('hour');

      // TODO: replace placeholder temporary code
      const lowestHours = this.priceHandler.getXLowest(18);
      return lowestHours.map((x) => x.hour).includes(curHour);
    };

    const deviceShouldBeOnCondition = this.homey.flow.getConditionCard('device-should-be-on');
    deviceShouldBeOnCondition.registerRunListener(shouldBeOnCalculator);

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
