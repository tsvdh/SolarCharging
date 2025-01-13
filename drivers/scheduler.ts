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

  public static scheduleAsync(runHour: number, callback: () => Promise<void>): void {
    const id = this.dayLastRun.length;
    this.dayLastRun.push(-1);

    const callbackRunner = async (id: number) => {
      const today = DateHandler.getDatePartAsNumber('day');
      if (this.dayLastRun[id] === today) {
        return;
      }

      if (runHour === DateHandler.getDatePartAsNumber('hour')) {
        await callback();
        this.dayLastRun[id] = today;
      }
    };

    Scheduler.app.homey.setInterval(() => callbackRunner(id), 1000 * 60 * 5);
  }

  public static schedule(runHour: number, callback: () => void): void {
    this.scheduleAsync(runHour, async () => callback());
  }

}
