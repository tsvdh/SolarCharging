import Homey from 'homey';

export default class DateHandler {

  private static app: Homey.App;

  public static init(app: Homey.App) {
    this.app = app;
  }

  private static getDatePart(partName: string, date: Date, timeZone: string): string {
    const formatter = new Intl.DateTimeFormat([], {
      timeZone: this.app.homey.clock.getTimezone(),
      hour: '2-digit',
      hour12: false,
      weekday: 'long',
      day: '2-digit',
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

}
