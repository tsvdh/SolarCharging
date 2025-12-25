import Homey from 'homey';
import axios from 'axios';
import { Collection, MongoClient } from 'mongodb';
import BeautifulDom from 'beautiful-dom';
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

type ControlData = {
  priceThreshold: number;
  active: boolean;
  name: string;
  essentDiff: number;
}

export class PriceHandler {

  private static marketDataURI = `https://jeroen.nl/api/dynamische-energieprijzen?period=vandaag&type=json&key=${Homey.env.JEROEN_API_KEY}`;

  public static async getData(): Promise<number[]> {
    const response = await axios.get<PriceData[]>(this.marketDataURI);
    const data = response.data.map(
      (x, index) => parseFloat(x.prijs_excl_belastingen.replace(',', '.')) * 1.21,
    );
    const hourlyData: number[] = [];
    const numDataPointsPerHour = data.length / 24;

    let curSum = 0;
    let curNumDataPoints = 0;
    for (const dataPoint of data) {
      curSum += dataPoint;

      if (++curNumDataPoints === numDataPointsPerHour) {
        hourlyData.push(curSum / numDataPointsPerHour);
        curSum = 0;
        curNumDataPoints = 0;
      }
    }

    return hourlyData;
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
  private controlDataCollection!: Collection<ControlData>;
  private diffWithEssentBackup: number;

  private constructor(minHour: number, maxHour: number) {
    this.activeHours = { min: minHour, max: maxHour };
    this.pricesCache = [];
    this.diffWithEssentBackup = -1;
  }

  private async init() {
    const client = new MongoClient(this.dbURI);
    await client.connect();

    const apiDataDB = client.db('ApiData');
    await apiDataDB.command({ ping: 1 });
    this.energyPricesCollection = apiDataDB.collection<EnergyPrices>('EnergyPrices');

    const centralControlDB = client.db('CentralControl');
    await centralControlDB.command({ ping: 1 });
    this.controlDataCollection = centralControlDB.collection<ControlData>('ControlData');

    const updateFromDB = async () => {
      this.pricesCache = await this.getPrices();
      this.diffWithEssentBackup = (await this.controlDataCollection.findOne())!.essentDiff;
    };
    await updateFromDB();
    Scheduler.setIntervalAsync(updateFromDB, 1000 * 60 * 60);
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

  public async getDiffWithEssent(): Promise<number> {
    const response = await axios.get('https://www.essent.nl/dynamische-tarieven');
    if (response.status !== 200) {
      return this.diffWithEssentBackup;
    }

    const parseNumber = (text: string): number => {
      return parseFloat(text.slice(7).replace(',', '.'));
    };

    try {
      const dom = new BeautifulDom(response.data);
      const priceElements = dom.getElementsByClassName('dynamic-prices-info__amount');

      if (priceElements.length < 3) {
        return this.diffWithEssentBackup;
      }

      const prices: number[] = [];
      for (const priceElement of priceElements) {
        prices.push(parseNumber(priceElement.innerText));
      }
      const lowestEssentPrice = prices.sort()[0];

      if (lowestEssentPrice === undefined) {
        return this.diffWithEssentBackup;
      }

      const lowestMarketPrice = this.pricesCache.sort((a, b) => a.price - b.price)[0].price;

      return lowestEssentPrice - lowestMarketPrice;
    }
    catch (e) {
      return this.diffWithEssentBackup;
    }
  }

}
