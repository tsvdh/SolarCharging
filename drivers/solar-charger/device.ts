import Homey from 'homey';
import { Collection, MongoClient } from 'mongodb';

type Measurement = {
  value: number;
  location: string;
  timestamp: Date;
}

type StateChange = {
  timestamp: Date;
  newState: boolean;
}

module.exports = class ChargingDevice extends Homey.Device {

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

  dbURI = `mongodb+srv://admin:${Homey.env.MONGO_PASSWORD}@cluster0.jwqp0hp.mongodb.net/?retryWrites=true&w=majority`
  solarPanelCollection: Collection<Measurement> | undefined;

  measurementsCache: Measurement[] = [];

  lastChange: StateChange = { newState: false, timestamp: new Date(0, 0) }

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

    const db = client.db('Measurements');
    await db.command({ ping: 1 });

    this.solarPanelCollection = db.collection<Measurement>('SolarPanels');

    this.log('Connected to DB');

    await this.removeCapability('lock_mode');

    await this.addCapability('lock_mode.status');
    await this.setCapabilityOptions('lock_mode.status', {
      title: { en: 'Status', nl: 'Status' },
      setable: false,
      values: [
        { id: 'charging_schedule', title: { en: 'Charging (schedule', nl: 'Opladen (schema)' } },
        { id: 'charging_time', title: { en: 'Charging (time)', nl: 'Opladen (tijd)' } },
        { id: 'charging_sun', title: { en: 'Charging (sun)', nl: 'Opladen (zon)' } },
        { id: 'waiting_time', title: { en: 'Waiting (time)', nl: 'Wachten (tijd)' } },
        { id: 'waiting_sun', title: { en: 'Waiting (sun)', nl: 'Wachten (zon)' } },
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

      const chargedDay = parseInt(this.getSetting('charged_day'), 10);
      let wantedHours = this.getSetting('charged_hour') + 24 * chargedDay;

      if (wantedHours < curHours) {
        wantedHours += 24 * 7;
      }

      const shouldChargeTime = wantedHours - curHours <= this.getSetting('charging_time');

      const shouldChargeSun = this.measurementsCache.length > 0
        ? this.getAverageValue(this.getSetting('average_duration')) > this.getSetting('power_threshold')
        : false;

      const minimumMillis = 1000 * 60 * this.getSetting('minimum_time');

      if (new Date().getTime() - this.lastChange.timestamp.getTime() > minimumMillis) {
        // this.log(new Date().getTime() - this.lastChange.timestamp.getTime(), minimumMillis);
        // this.log(shouldChargeTime, shouldChargeSun, this.lastChange.newState);

        if (shouldChargeTime && !this.lastChange.newState) {
          this.lastChange = { newState: true, timestamp: new Date() };
          await this.setCapabilityValue('lock_mode.status', 'charging_schedule');
        }
        else if (shouldChargeSun && !this.lastChange.newState) {
          this.lastChange = { newState: true, timestamp: new Date() };
          await this.setCapabilityValue('lock_mode.status', 'charging_time');
        }
        else if (shouldChargeSun && this.lastChange.newState) {
          await this.setCapabilityValue('lock_mode.status', 'charging_sun');
        }
        else if (this.lastChange.newState) {
          this.lastChange = { newState: false, timestamp: new Date() };
          await this.setCapabilityValue('lock_mode.status', 'waiting_time');
        }
        else if (!this.lastChange.newState) {
          await this.setCapabilityValue('lock_mode.status', 'waiting_sun');
        }
      }

      return this.lastChange.newState;
    };

    const deviceShouldChargeCondition = this.homey.flow.getConditionCard('device-should-charge');
    deviceShouldChargeCondition.registerRunListener(this.shouldChargeCalculator);

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
