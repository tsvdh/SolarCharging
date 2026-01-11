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

module.exports = class SmartEnergy extends Homey.App {

  dbURI = `mongodb+srv://admin:${Homey.env.MONGO_PASSWORD}@cluster0.jwqp0hp.mongodb.net/?retryWrites=true&w=majority`;
  solarPanelCollection: Collection<Measurement> | undefined;

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
    this.log('Connected to DB');

    this.homey.flow.getActionCard('set-power').registerRunListener(async (value) => {
      await this.addToDB(parseInt(value.watt, 10));
    });

    DateHandler.init(this);
    Scheduler.init(this);
    await PriceHandler.init(this);

    this.log('Smart Energy has been initialized');
  }

};
