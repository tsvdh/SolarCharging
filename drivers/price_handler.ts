import Homey from 'homey';
import axios from 'axios';
import { Collection, MongoClient } from 'mongodb';
import BeautifulDom from 'beautiful-dom';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import Scheduler from './scheduler';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import DateHandler from './date_handler';

type ApiPriceData = {
  // eslint-disable-next-line camelcase
  datum_nl: string;
  // eslint-disable-next-line camelcase
  prijs_excl_belastingen: string;
}

type HourRange = {
  min: number;
  max: number;
}

export type HourPriceData = {
  hour: number;
  price: number;
}

function HourPriceData(hour: number, price: number): HourPriceData {
  return { hour, price };
}

type DbPriceData = {
  prices: number[];
  timestamp: Date;
  insertionTimestamp: Date;
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

  private static app: Homey.App;
  private static marketDataURI = `https://jeroen.nl/api/dynamische-energieprijzen/v2/?period=__day__&type=json&key=${Homey.env.JEROEN_API_KEY}`;
  private static dbURI = `mongodb+srv://admin:${Homey.env.MONGO_PASSWORD}@cluster0.jwqp0hp.mongodb.net/?retryWrites=true&w=majority`;
  private static energyPricesCollection: Collection<DbPriceData>;
  private static controlDataCollection: Collection<ControlData>;
  private static fullPricesCache: Map<number, HourPriceData[]>;
  private static diffWithEssentBackup: number;

  private static getMarketDataURI(day: string): string {
    return this.marketDataURI.replace('__day__', day);
  }

  public static async init(app: Homey.App) {
    this.app = app;

    const client = new MongoClient(this.dbURI);
    await client.connect();

    const apiDataDB = client.db('ApiData');
    await apiDataDB.command({ ping: 1 });
    this.energyPricesCollection = apiDataDB.collection<DbPriceData>('EnergyPrices');

    const centralControlDB = client.db('CentralControl');
    await centralControlDB.command({ ping: 1 });
    this.controlDataCollection = centralControlDB.collection<ControlData>('ControlData');

    this.fullPricesCache = new Map();

    const updateFromDB = async () => {
      this.diffWithEssentBackup = (await this.controlDataCollection.findOne())!.essentDiff;
    };

    const startupUpdater = async () => {
      const today = DateHandler.getToday();
      const cursor = this.energyPricesCollection!.find().sort({ timestamp: -1 });
      const latestResult = await cursor.next();
      if (latestResult) {
        if (DateHandler.isToday(latestResult.timestamp)) {
          this.app.log('latest db price result is today');
          this.fullPricesCache.set(today, this.transformDbPriceDataToHourPriceData(latestResult.prices));
          return;
        }
        const secondLatestResult = await cursor.next();
        if (secondLatestResult) {
          if (DateHandler.isToday(secondLatestResult.timestamp)) {
            this.app.log('second latest db price result is today');
            this.fullPricesCache.set(today, this.transformDbPriceDataToHourPriceData(secondLatestResult.prices));
            return;
          }
        }
      }

      this.app.log('fetching today prices from api and adding to db');

      const todayApiResponse = await axios.get<ApiPriceData[]>(this.getMarketDataURI('vandaag'));
      const todayDbPrices = await this.transformApiPriceDataToDbPriceData(todayApiResponse.data);
      const todayApiDate = new Date(todayApiResponse.data[0].datum_nl);
      await this.energyPricesCollection!.insertOne({ prices: todayDbPrices, insertionTimestamp: new Date(), timestamp: todayApiDate });
      this.fullPricesCache.set(today, this.transformDbPriceDataToHourPriceData(todayDbPrices));
    };

    const dailyUpdater = async () => {
      const today = DateHandler.getToday();
      const tomorrow = DateHandler.getTomorrow();

      const currentHour = DateHandler.getDatePartLocalAsNumber('hour');
      if (currentHour < 18) {
        return;
      }
      if (this.fullPricesCache.has(tomorrow)) {
        return;
      }

      this.app.log('getting tomorrow prices');

      const todayPrices = this.fullPricesCache.get(today)!;
      this.fullPricesCache.clear();
      this.fullPricesCache.set(today, todayPrices);

      const result = await this.energyPricesCollection!.find().sort({ timestamp: -1 }).next();
      if (result) {
        if (DateHandler.isTomorrow(result.timestamp)) {
          this.app.log('tomorrow prices found in db');
          this.fullPricesCache.set(tomorrow, this.transformDbPriceDataToHourPriceData(result.prices));
          return;
        }
      }

      this.app.log('fetching tomorrow prices from api and adding to db');

      const tomorrowApiResponse = await axios.get<ApiPriceData[]>(this.getMarketDataURI('morgen'));
      const tomorrowDbPrices = await this.transformApiPriceDataToDbPriceData(tomorrowApiResponse.data);
      const tomorrowApiDate = new Date(tomorrowApiResponse.data[0].datum_nl);
      await this.energyPricesCollection!.insertOne({ prices: tomorrowDbPrices, insertionTimestamp: new Date(), timestamp: tomorrowApiDate });
      this.fullPricesCache.set(tomorrow, this.transformDbPriceDataToHourPriceData(tomorrowDbPrices));
    };

    await updateFromDB();
    await startupUpdater();
    await dailyUpdater();
    Scheduler.setIntervalAsync(dailyUpdater, 1000 * 60 * 5);
    Scheduler.setIntervalAsync(updateFromDB, 1000 * 60 * 60);
  }

  private static async transformApiPriceDataToDbPriceData(priceData: ApiPriceData[]): Promise<number[]> {
    const diffWithEssent = await this.getDiffWithEssent();
    const data = priceData.map(
      (x, index) => parseFloat(x.prijs_excl_belastingen.replace(',', '.')) * 1.21 + diffWithEssent,
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

  private static transformDbPriceDataToHourPriceData(priceData: number[]): HourPriceData[] {
    return priceData.map((x, i) => { return HourPriceData(i, x); });
  }

  public static hoursToString(hourPrices: HourPriceData[]): string {
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

  private static async getDiffWithEssent(): Promise<number> {
    const response = await axios.get('https://www.essent.nl/dynamische-tarieven');
    if (response.status !== 200) {
      return PriceHandler.diffWithEssentBackup;
    }

    const parseNumber = (text: string): number => {
      return parseFloat(text.slice(7).replace(',', '.'));
    };

    try {
      const dom = new BeautifulDom(response.data);
      const priceElements = dom.getElementsByClassName('dynamic-prices-info__amount');

      if (priceElements.length < 3) {
        return PriceHandler.diffWithEssentBackup;
      }

      const prices: number[] = [];
      for (const priceElement of priceElements) {
        prices.push(parseNumber(priceElement.innerText));
      }
      const lowestEssentPrice = prices.sort()[0];

      if (lowestEssentPrice === undefined) {
        return PriceHandler.diffWithEssentBackup;
      }

      const lowestMarketPrice = PriceHandler.getPrices().sort((a, b) => a.price - b.price)[0].price;

      return lowestEssentPrice - lowestMarketPrice;
    }
    catch (e) {
      return PriceHandler.diffWithEssentBackup;
    }
  }

  private static getPrices(): HourPriceData[] {
    const prices = PriceHandler.fullPricesCache.get(DateHandler.getToday());
    if (prices === undefined) {
      throw new Error(`Prices for today not in cache (today: ${DateHandler.getToday()}, in cache: ${Array.from(PriceHandler.fullPricesCache.keys())}`);
    }
    return prices;
  }

  private activeHours: HourRange;

  public constructor(minHour: number, maxHour: number) {
    this.activeHours = { min: minHour, max: maxHour };
  }

  public getPrices(): HourPriceData[] {
    return PriceHandler.getPrices().slice(this.activeHours.min, this.activeHours.max + 1);
  }

  public getPrice(hour: number): number | undefined {
    if (hour < this.activeHours.min || hour > this.activeHours.max) {
      return undefined;
    }
    return this.getPrices()[hour].price;
  }

  public getAverageOf(prices: HourPriceData[]): number {
    return prices.reduce((acc, cur) => HourPriceData(-1, acc.price + cur.price)).price / prices.length;
  }

  public getAverage(): number {
    return this.getAverageOf(this.getPrices());
  }

  public getAboveAverage(): HourPriceData[] {
    return this.getOffsetAboveAverage(0);
  }

  public getBelowAverage(): HourPriceData[] {
    return this.getOffsetBelowAverage(0);
  }

  public getOffsetAboveAverage(offset: number): HourPriceData[] {
    const average = this.getAverage();
    return this.getPrices().filter((x) => x.price > average + offset);
  }

  public getOffsetBelowAverage(offset: number): HourPriceData[] {
    const average = this.getAverage();
    return this.getPrices().filter((x) => x.price < average - offset);
  }

  public getBelowThreshold(threshold: number): HourPriceData[] {
    return this.getPrices().filter((x) => x.price <= threshold);
  }

  public getAboveThreshold(threshold: number): HourPriceData[] {
    return this.getPrices().filter((x) => x.price >= threshold);
  }

  public getXLowest(amount: number) : HourPriceData[] {
    return this.getPrices()
      .sort((a, b) => a.price - b.price)
      .slice(0, amount)
      .sort((a, b) => a.hour - b.hour);
  }

}
