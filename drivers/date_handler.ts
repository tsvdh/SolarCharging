import Homey from 'homey';

export default class DateHandler {

  private static app: Homey.App;

  public static init(app: Homey.App) {
    this.app = app;
  }

  private static getDatePart(partName: string, date: Date, timeZone: string): string {
    const formatter = new Intl.DateTimeFormat([], {
      timeZone,
      hour: '2-digit',
      hour12: false,
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      hourCycle: 'h24',
    });

    const timeParts = formatter.formatToParts(date);
    const timePart = timeParts.find((part) => part.type === partName)!.value;
    if (partName !== 'hour') {
      return timePart;
    }

    let hourAsNumber = parseInt(timePart, 10);
    if (hourAsNumber === 24) {
      hourAsNumber = 0;
    }
    return hourAsNumber.toString(10);
  }

  private static getDatePartAsNumber(partName: string, date: Date, timeZone: string): number {
    return parseInt(this.getDatePart(partName, date, timeZone), 10);
  }

  public static getDatePartLocal(partName: string, date: Date = new Date()): string {
    return this.getDatePart(partName, date, this.app.homey.clock.getTimezone());
  }

  public static getDatePartLocalAsNumber(partName: string, date: Date = new Date()): number {
    return this.getDatePartAsNumber(partName, date, this.app.homey.clock.getTimezone());
  }

  public static getDatePartUTC(partName: string, date: Date = new Date()): string {
    return this.getDatePart(partName, date, 'UTC');
  }

  public static getDatePartUTCAsNumber(partName: string, date: Date = new Date()): number {
    return this.getDatePartAsNumber(partName, date, 'UTC');
  }

  public static isToday(date: Date): boolean {
    return this.getDatePartLocalAsNumber('day') === this.getDatePartLocalAsNumber('day', date)
      && this.getDatePartLocalAsNumber('month') === this.getDatePartLocalAsNumber('month', date);
  }

  public static isTomorrow(date: Date): boolean {
    return this.isToday(new Date(date.getTime() - 24 * 60 * 60 * 1000));
  }

  public static getToday(): number {
    return this.getDatePartLocalAsNumber('day');
  }

  public static getTomorrow(): number {
    return this.getDatePartLocalAsNumber('day', new Date(new Date().getTime() + 24 * 60 * 60 * 1000));
  }

}
