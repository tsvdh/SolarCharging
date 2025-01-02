import Homey from 'homey';
import axios from 'axios';
import { Collection, MongoClient } from 'mongodb';

type PriceData = {
  datum: Date;
  // eslint-disable-next-line camelcase
  prijs_excl_btw: string;
}

type HourRange = {
  min: number;
  max: number;
}

type EnergyPrices = {
  prices: number[];
  timestamp: Date;
}

export enum PriceHandlerMode {
  AwakeHours,
  AllHours,
  MaxFuture
}

export class PriceHandler {

  private static dataURI = `https://jeroen.nl/api/dynamische-energieprijzen?period=vandaag&type=json&key=${Homey.env.JEROEN_API_KEY}`;

  public static async getData(): Promise<number[]> {
    const response = await axios.get<PriceData[]>(this.dataURI);
    return response.data.map((x, index) => parseFloat(x.prijs_excl_btw.replace(',', '.')) * 1.21);
  }

  public static async makeInstance(minHour: number, maxHour: number): Promise<PriceHandler> {
    const instance = new PriceHandler(minHour, maxHour);
    await instance.init();
    return instance;
  }

  private dbURI = `mongodb+srv://admin:${Homey.env.MONGO_PASSWORD}@cluster0.jwqp0hp.mongodb.net/?retryWrites=true&w=majority`;
  private energyPricesCollection!: Collection<EnergyPrices>;
  private activeHours: HourRange;

  public constructor(minHour: number, maxHour: number) {
    this.activeHours = { min: minHour, max: maxHour };
  }

  private async init() {
    const client = new MongoClient(this.dbURI);
    await client.connect();

    const apiDataDB = client.db('ApiData');
    await apiDataDB.command({ ping: 1 });
    this.energyPricesCollection = apiDataDB.collection<EnergyPrices>('EnergyPrices');
  }

  private async getPrices(): Promise<number[]> {
    const { prices } = (await this.energyPricesCollection.findOne())!;
    return prices.slice(this.activeHours.min, this.activeHours.max + 1);
  }

  private getAverage(prices: number[]): number {
    return prices.reduce((acc, cur) => acc + cur) / prices.length;
  }

  public async getAboveAverage(): Promise<number[]> {
    return this.getOffsetAboveAverage(0);
  }

  public async getBelowAverage(): Promise<number[]> {
    return this.getOffsetBelowAverage(0);
  }

  public async getOffsetAboveAverage(offset: number): Promise<number[]> {
    const prices = await this.getPrices();
    const average = this.getAverage(prices);
    return prices.filter((x) => x > average + offset);
  }

  public async getOffsetBelowAverage(offset: number): Promise<number[]> {
    const prices = await this.getPrices();
    const average = this.getAverage(prices);
    return prices.filter((x) => x < average - offset);
  }

}
