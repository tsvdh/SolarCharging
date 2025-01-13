import Homey from 'homey';
import { Collection, MongoClient } from 'mongodb';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import { PriceHandler } from '../price_handler';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import DateHandler from '../date_handler';

type Measurement = {
  value: number;
  location: string;
  timestamp: Date;
}

type ChargingState = {
  name: string;
  deviceName: string;
  timestamp: Date;
}

module.exports = class DeviceCharger extends Homey.Device {

  days: string[][] = [
    ['Monday', 'Maandag'],
    ['Tuesday', 'Dinsdag'],
    ['Wednesday', 'Woensdag'],
    ['Thursday', 'Donderdag'],
    ['Friday', 'Vrijdag'],
    ['Saturday', 'Zaterdag'],
    ['Sunday', 'Zondag'],
  ];

  dbURI = `mongodb+srv://admin:${Homey.env.MONGO_PASSWORD}@cluster0.jwqp0hp.mongodb.net/?retryWrites=true&w=majority`
  solarPanelCollection: Collection<Measurement> | undefined;
  chargingCollection: Collection<ChargingState> | undefined;

  measurementsCache: Measurement[] = [];

  lastChange: ChargingState = { name: 'not_set', deviceName: this.getName(), timestamp: new Date(0, 0) }

  priceHandler!: PriceHandler;

  async getDBValues(): Promise<Measurement[]> {
    const documents = await this.solarPanelCollection!.find({ location: 'Tweede Stationsstraat' }).toArray();
    return documents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  getAverageValue(duration: number) : number {
    duration = Math.min(duration, this.measurementsCache.length);

    const wantedValues = this.measurementsCache.slice(0, duration);

    let average = wantedValues
      .map((measurement) => measurement.value)
      .reduce((accumulator, current) => accumulator + current);

    average /= duration;

    return average;
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    const client = new MongoClient(this.dbURI);
    await client.connect();

    const measurementsDB = client.db('Measurements');
    await measurementsDB.command({ ping: 1 });

    const loggingDB = client.db('Logging');
    await loggingDB.command({ ping: 1 });

    this.solarPanelCollection = measurementsDB.collection<Measurement>('SolarPanels');
    this.chargingCollection = loggingDB.collection<ChargingState>('Charging');

    this.priceHandler = await PriceHandler.makeInstance(0, 23);

    this.log('Connected to DB');

    await this.removeCapability('lock_mode');

    await this.addCapability('lock_mode.status');
    await this.setCapabilityOptions('lock_mode.status', {
      title: { en: 'Status', nl: 'Status' },
      setable: false,
      values: [
        { id: 'charging_schedule', title: { en: 'Charging (schedule)', nl: 'Opladen (schema)' } },
        { id: 'charging_min_duration', title: { en: 'Charging (mininum duration)', nl: 'Opladen (minimale duur)' } },
        { id: 'charging_sun', title: { en: 'Charging (sun)', nl: 'Opladen (zon)' } },
        { id: 'waiting', title: { en: 'Waiting', nl: 'Wachten' } },
        { id: 'charging_low_price', title: { en: 'Charging (low price)', nl: 'Opladen (lage prijs)' } },
      ],
    });

    await this.addCapability('date_shower');
    await this.setCapabilityOptions('date_shower', {
      title: { en: 'Charged by', nl: 'Opgeladen voor' },
    });

    await this.addCapability('measure_luminance');
    await this.setCapabilityOptions('measure_luminance', {
      decimals: 0,
      units: 'W',
      title: {
        en: 'Power average',
        nl: 'Gemiddeld vermogen',
      },
    });

    const updater = async () => {
      this.measurementsCache = await this.getDBValues();
      if (this.measurementsCache.length > 0) {
        await this.setCapabilityValue('measure_luminance', this.getAverageValue(this.getSetting('average_duration')));
      }
    };

    await updater();
    this.homey.setInterval(updater, 1000 * 60);

    this.log(`${this.getName()} has been initialized`);
  }

  async shouldChargeCalculator(): Promise<boolean> {
    const curHour = DateHandler.getDatePartAsNumber('hour');
    const curWeekDayName = DateHandler.getDatePart('weekday');

    let curWeekDay = -1;
    for (let i = 0; i < 7; i++) {
      if (this.days[i][0] === curWeekDayName) {
        curWeekDay = i;
        break;
      }
    }
    if (curWeekDay === -1) {
      this.homey.error(`Unknown weekday: ${curWeekDayName}`);
    }

    const curHours = curHour + 24 * curWeekDay;

    const wantedDay = parseInt(this.getSetting('charged_day'), 10);
    let wantedHours: number = this.getSetting('charged_hour') + 24 * wantedDay;

    if (wantedHours < curHours) {
      wantedHours += 24 * 7;
    }

    const shouldChargeSchedule = wantedHours - curHours <= this.getSetting('charging_time');

    const shouldChargeSun: boolean = this.measurementsCache.length > 0
      ? this.getAverageValue(this.getSetting('average_duration')) > this.getSetting('power_threshold')
      : false;

    // TODO: get essent price
    const lowPrice = this.getSetting('price_threshold') - 0.15;
    const lowHours = await this.priceHandler.getBelowThreshold(lowPrice);
    const shouldChargeLowPrice = lowHours.map((x) => x.hour).includes(curHour);

    const minimumMillis = 1000 * 60 * this.getSetting('minimum_time');
    if (new Date().getTime() - this.lastChange.timestamp.getTime() > minimumMillis) {
      // this.log(new Date().getTime() - this.lastChange.timestamp.getTime(), minimumMillis);
      // this.log(shouldChargeSchedule, shouldChargeSun, shouldChargeLowPrice, this.lastChange);

      let putInDB = true;

      if (shouldChargeSchedule && this.lastChange.name !== 'charging_schedule') {
        this.lastChange = { name: 'charging_schedule', deviceName: this.getName(), timestamp: new Date() };
        await this.setCapabilityValue('lock_mode.status', 'charging_schedule');
      }
      else if (shouldChargeSchedule && this.lastChange.name === 'charging_schedule') {
        putInDB = false;
      }

      else if (shouldChargeLowPrice && this.lastChange.name !== 'charging_low_price') {
        this.lastChange = { name: 'charging_low_price', deviceName: this.getName(), timestamp: new Date() };
        await this.setCapabilityValue('lock_mode.status', 'charging_low_price');
      }
      else if (shouldChargeLowPrice && this.lastChange.name !== 'charging_low_price') {
        putInDB = false;
      }

      else if (shouldChargeSun && this.lastChange.name !== 'charging_sun' && this.lastChange.name !== 'charging_min_duration') {
        this.lastChange = { name: 'charging_min_duration', deviceName: this.getName(), timestamp: new Date() };
        await this.setCapabilityValue('lock_mode.status', 'charging_min_duration');
      }
      else if (shouldChargeSun && this.lastChange.name === 'charging_sun') {
        putInDB = false;
      }
      else if (shouldChargeSun && this.lastChange.name === 'charging_min_duration') {
        this.lastChange = { name: 'charging_sun', deviceName: this.getName(), timestamp: new Date() };
        await this.setCapabilityValue('lock_mode.status', 'charging_sun');
      }

      else if (!shouldChargeSchedule && !shouldChargeSun && !shouldChargeLowPrice && this.lastChange.name !== 'waiting') {
        this.lastChange = { name: 'waiting', deviceName: this.getName(), timestamp: new Date() };
        await this.setCapabilityValue('lock_mode.status', 'waiting');
      }
      else {
        putInDB = false;
      }

      if (putInDB) {
        await this.chargingCollection!.insertOne({
          name: await this.getCapabilityValue('lock_mode.status'),
          deviceName: this.getName(),
          timestamp: new Date(),
        });
      }
    }

    // this.log(this.lastChange);
    return this.lastChange.name !== 'waiting';
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
    const curLang = this.homey.i18n.getLanguage();
    const langIndex: number = curLang === 'en' ? 0 : 1;

    const day = this.days[<number>newSettings['charged_day']][langIndex];
    const hour = `${<number>newSettings['charged_hour']}:00`;

    await this.setCapabilityValue('date_shower', `${day} ${hour}`);

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
