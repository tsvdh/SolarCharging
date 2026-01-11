import Homey from 'homey';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import DateHandler from './date_handler';

export default class Scheduler {

  private static app: Homey.App;

  public static init(app: Homey.App) {
    this.app = app;
  }

  public static setIntervalAsync(callback: () => Promise<void>, ms: number) {
    this.app.homey.setInterval(callback, ms);
  }

  public static setInterval(callback: () => void, ms: number) {
    this.app.homey.setInterval(callback, ms);
  }

  static dayLastRun: number[] = [];

  private static scheduleAsync(runHour: number, callback: () => Promise<void>, datePartGetter: (partName: string) => number): void {
    const id = this.dayLastRun.length;
    this.dayLastRun.push(-1);

    const callbackRunner = async (id: number) => {
      const today = datePartGetter('day');
      if (this.dayLastRun[id] === today) {
        return;
      }

      if (runHour === datePartGetter('hour')) {
        await callback();
        this.dayLastRun[id] = today;
      }
    };

    Scheduler.app.homey.setInterval(async () => callbackRunner(id), 1000 * 60 * 5);
  }

  public static scheduleAsyncLocalTime(runHour: number, callback: () => Promise<void>): void {
    this.scheduleAsync(runHour, callback, DateHandler.getDatePartLocalAsNumber.bind(DateHandler));
  }

  public static scheduleAsyncUTC(runHour: number, callback: () => Promise<void>): void {
    this.scheduleAsync(runHour, callback, DateHandler.getDatePartUTCAsNumber.bind(DateHandler));
  }

}
