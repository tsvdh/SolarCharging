'use strict';

import Homey from 'homey';
import { Collection, MongoClient } from 'mongodb';

type Measurement = {
  value: number;
  location: string;
  timestamp: Date;
}

module.exports = class SolarCharging extends Homey.App {

  dbURI = `mongodb+srv://admin:${Homey.env.MONGO_PASSWORD}@cluster0.jwqp0hp.mongodb.net/?retryWrites=true&w=majority`
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

    const db = client.db('Measurements');
    await db.command({ ping: 1 });

    this.solarPanelCollection = db.collection<Measurement>('SolarPanels');

    this.log('Connected to DB');

    this.homey.flow.getActionCard('set-power').registerRunListener(async (value) => {
      await this.addToDB(parseInt(value.watt, 10));
    });

    this.log('Solar Charging has been initialized');
  }

};
