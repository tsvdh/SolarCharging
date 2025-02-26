import Homey from 'homey';
import axios from 'axios';
import { Collection, MongoClient } from 'mongodb';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import Scheduler from './scheduler';

type PriceData = {
  datum: Date;
  // eslint-disable-next-line camelcase
  prijs_excl_belastingen: string;
}

type HourRange = {
  min: number;
  max: number;
}

export type HourPrice = {
  hour: number;
  price: number;
}

function HourPrice(hour: number, price: number): HourPrice {
  return { hour, price };
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

  public static getEssentMargin(): number {
    return 0.15;
  }

  private static marketDataURI = `https://jeroen.nl/api/dynamische-energieprijzen?period=vandaag&type=json&key=${Homey.env.JEROEN_API_KEY}`;

  public static async getData(): Promise<number[]> {
    const response = await axios.get<PriceData[]>(this.marketDataURI);
    return response.data.map((x, index) => parseFloat(x.prijs_excl_belastingen.replace(',', '.')) * 1.21);
  }

  public static async makeInstance(minHour: number, maxHour: number): Promise<PriceHandler> {
    const instance = new PriceHandler(minHour, maxHour);
    await instance.init();
    return instance;
  }

  public static hoursToString(hourPrices: HourPrice[]): string {
    const ranges: HourRange[] = [];
    for (const hourPrice of hourPrices) {
      const thisHourRange: HourRange = { min: hourPrice.hour, max: hourPrice.hour };
      if (ranges.length === 0) {
        ranges.push(thisHourRange);
      }
      else if (ranges[ranges.length - 1].max === hourPrice.hour - 1) {
        ranges[ranges.length - 1].max += 1;
      } else {
        ranges.push(thisHourRange);
      }
    }

    let result = '';
    for (const range of ranges) {
      const multiHourRange = range.min !== range.max;
      result += `${range.min}${multiHourRange ? `-${range.max}` : ''}, `;
    }
    result = result.slice(0, result.length - 2);
    return result;
  }

  private dbURI = `mongodb+srv://admin:${Homey.env.MONGO_PASSWORD}@cluster0.jwqp0hp.mongodb.net/?retryWrites=true&w=majority`;
  private energyPricesCollection!: Collection<EnergyPrices>;
  private activeHours: HourRange;
  private pricesCache: HourPrice[];

  private constructor(minHour: number, maxHour: number) {
    this.activeHours = { min: minHour, max: maxHour };
    this.pricesCache = [];
  }

  private async init() {
    const client = new MongoClient(this.dbURI);
    await client.connect();

    const apiDataDB = client.db('ApiData');
    await apiDataDB.command({ ping: 1 });
    this.energyPricesCollection = apiDataDB.collection<EnergyPrices>('EnergyPrices');

    const updateCache = async () => {
      this.pricesCache = await this.getPrices();
    };
    await updateCache();
    Scheduler.setIntervalAsync(updateCache, 1000 * 60 * 60);
  }

  private async getPrices(): Promise<HourPrice[]> {
    const { prices } = (await this.energyPricesCollection.findOne())!;
    return prices
      .map((x, i): HourPrice => HourPrice(i, x))
      .slice(this.activeHours.min, this.activeHours.max + 1);
  }

  public getAverageOf(prices: HourPrice[]): number {
    return prices.reduce((acc, cur) => HourPrice(-1, acc.price + cur.price)).price / prices.length;
  }

  public getAverage(): number {
    return this.getAverageOf(this.pricesCache);
  }

  public getAboveAverage(): HourPrice[] {
    return this.getOffsetAboveAverage(0);
  }

  public getBelowAverage(): HourPrice[] {
    return this.getOffsetBelowAverage(0);
  }

  public getOffsetAboveAverage(offset: number): HourPrice[] {
    const average = this.getAverage();
    return this.pricesCache.filter((x) => x.price > average + offset);
  }

  public getOffsetBelowAverage(offset: number): HourPrice[] {
    const average = this.getAverage();
    return this.pricesCache.filter((x) => x.price < average - offset);
  }

  public getBelowThreshold(threshold: number): HourPrice[] {
    return this.pricesCache.filter((x) => x.price <= threshold);
  }

  public getAboveThreshold(threshold: number): HourPrice[] {
    return this.pricesCache.filter((x) => x.price >= threshold);
  }

  public getXLowest(amount: number) : HourPrice[] {
    return this.pricesCache
      .sort((a, b) => a.price - b.price)
      .slice(0, amount)
      .sort((a, b) => a.hour - b.hour);
  }

}
