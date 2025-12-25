'use strict';

import Homey from 'homey';
import { Collection, MongoClient } from 'mongodb';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import { PriceHandler } from './drivers/price_handler';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import DateHandler from './drivers/date_handler';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import Scheduler from './drivers/scheduler';

type Measurement = {
  value: number;
  location: string;
  timestamp: Date;
}

type EnergyPrices = {
  prices: number[];
  timestamp: Date;
}

module.exports = class SolarCharging extends Homey.App {

  dbURI = `mongodb+srv://admin:${Homey.env.MONGO_PASSWORD}@cluster0.jwqp0hp.mongodb.net/?retryWrites=true&w=majority`;
  solarPanelCollection: Collection<Measurement> | undefined;
  energyPricesCollection: Collection<EnergyPrices> | undefined;

  async addToDB(measurement: number) {
    await this.solarPanelCollection!.insertOne({
      value: measurement,
      location: 'Tweede Stationsstraat',
      timestamp: new Date(),
    });
  }

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    const client = new MongoClient(this.dbURI);
    await client.connect();

    const measurementsDB = client.db('Measurements');
    await measurementsDB.command({ ping: 1 });
    this.solarPanelCollection = measurementsDB.collection<Measurement>('SolarPanels');
    this.log('Connected to Measurements DB');

    const apiDataDB = client.db('ApiData');
    await apiDataDB.command({ ping: 1 });
    this.energyPricesCollection = apiDataDB.collection<EnergyPrices>('EnergyPrices');
    this.log('Connected to Energy Prices DB');

    this.homey.flow.getActionCard('set-power').registerRunListener(async (value) => {
      await this.addToDB(parseInt(value.watt, 10));
    });

    DateHandler.init(this);
    Scheduler.init(this);

    const updater = async () => {
      const curDay = DateHandler.getDatePartAsNumber('day');

      const result = await this.energyPricesCollection!.findOne();
      const dbDay = DateHandler.getDatePartAsNumber('hour', result?.timestamp);
      const todayInDB = dbDay === curDay;

      if (result && !todayInDB) {
        await this.energyPricesCollection!.deleteOne();
      }
      if (!todayInDB) {
        const prices = await PriceHandler.getData();
        await this.energyPricesCollection!.insertOne({ prices, timestamp: new Date() });
      }
    };
    await updater();
    Scheduler.scheduleAsync(0, updater);

    this.log('Smart Energy has been initialized');
  }

};
