import Homey from 'homey';
import { Collection, MongoClient } from 'mongodb';

type ControlData = {
  priceThreshold: number;
  active: boolean;
  name: string;
  essentDiff: number;
}

module.exports = class Device extends Homey.Device {

  dbURI = `mongodb+srv://admin:${Homey.env.MONGO_PASSWORD}@cluster0.jwqp0hp.mongodb.net/?retryWrites=true&w=majority`
  controlDataCollection: Collection<ControlData> | undefined;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    const client = new MongoClient(this.dbURI);
    await client.connect();

    const controlDataDB = client.db('CentralControl');
    await controlDataDB.command({ ping: 1 });

    this.controlDataCollection = controlDataDB.collection<ControlData>('ControlData');
    const result = await this.controlDataCollection.findOne({ name: this.getData().id });
    if (!result) {
      await this.controlDataCollection.insertOne({
        priceThreshold: 0.3, active: true, name: this.getData().id, essentDiff: 0.15,
      });
    }

    this.log('Connected to DB');

    await this.addCapability('target_temperature');
    await this.setCapabilityOptions('target_temperature', {
      min: 0,
      max: 0.5,
      step: 0.01,
      decimals: 2,
    });
    this.registerCapabilityListener('target_temperature', async (value: number, opts) => {
      await this.controlDataCollection!.updateOne({ name: this.getData().id }, { $set: { priceThreshold: value } });
    });

    await this.addCapability('onoff');
    this.registerCapabilityListener('onoff', async (value: boolean, opts) => {
      await this.controlDataCollection!.updateOne({ name: this.getData().id }, { $set: { active: value } });
    });

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
    await this.controlDataCollection!.updateOne({ name: this.getData().id }, { $set: { essentDiff: <number>newSettings['essent_diff'] } });
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
