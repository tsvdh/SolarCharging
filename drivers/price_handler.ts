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
  private static fullPricesCache: HourPriceData[];
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

    const energyPriceUpdater = async () => {
      const result = await this.energyPricesCollection!.findOne();
      const today = DateHandler.getDatePartLocalAsNumber('day');
      const dbDay = DateHandler.getDatePartLocalAsNumber('day', result?.timestamp);
      const todayInDB = dbDay === today;

      this.app.log(today, dbDay, result);

      if (result) {
        if (todayInDB) {
          this.fullPricesCache = PriceHandler.transformDbPriceDataToHourPriceData(result.prices);
          return;
        }
        await this.energyPricesCollection!.deleteOne();
      }

      const todayResponse = await axios.get<ApiPriceData[]>(this.getMarketDataURI('vandaag'));
      const tomorrowResponse = await axios.get<ApiPriceData[]>(this.getMarketDataURI('morgen'));
      const todayResponseDay = DateHandler.getDatePartLocalAsNumber('day', new Date(todayResponse.data[0].datum_nl));

      this.app.log(todayResponseDay, tomorrowResponse.data.length > 0);
      if (tomorrowResponse.data.length > 0) {
        this.app.log(DateHandler.getDatePartLocalAsNumber('day', new Date(tomorrowResponse.data[0].datum_nl)));
      }

      const processApiData = async (apiData: ApiPriceData[]) => {
        const prices = PriceHandler.transformApiPriceDataToDbPriceData(apiData);
        await this.energyPricesCollection!.insertOne({ prices, timestamp: new Date() });
        this.fullPricesCache = PriceHandler.transformDbPriceDataToHourPriceData(prices);
      };

      if (todayResponseDay === today) {
        await processApiData(todayResponse.data);
        return;
      }
      if (tomorrowResponse.data.length > 0) {
        const tomorrowResponseDay = DateHandler.getDatePartLocalAsNumber('day', new Date(tomorrowResponse.data[0].datum_nl));

        if (tomorrowResponseDay === today) {
          await processApiData(tomorrowResponse.data);
          return;
        }
      }

      this.app.error('Failed to get price data from Api');
    };
    await energyPriceUpdater();
    Scheduler.scheduleAsyncLocalTime(0, energyPriceUpdater);

    const updateFromDB = async () => {
      this.diffWithEssentBackup = (await this.controlDataCollection.findOne())!.essentDiff;
    };
    await updateFromDB();
    Scheduler.setIntervalAsync(updateFromDB, 1000 * 60 * 60);
  }

  private static transformApiPriceDataToDbPriceData(priceData: ApiPriceData[]): number[] {
    const data = priceData.map(
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

  private activeHours: HourRange;

  public constructor(minHour: number, maxHour: number) {
    this.activeHours = { min: minHour, max: maxHour };
  }

  private getPrices(): HourPriceData[] {
    return PriceHandler.fullPricesCache.slice(this.activeHours.min, this.activeHours.max + 1);
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

  public async getDiffWithEssent(): Promise<number> {
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

      const lowestMarketPrice = this.getPrices().sort((a, b) => a.price - b.price)[0].price;

      return lowestEssentPrice - lowestMarketPrice;
    }
    catch (e) {
      return PriceHandler.diffWithEssentBackup;
    }
  }

}
