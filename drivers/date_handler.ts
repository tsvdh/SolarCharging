import Homey from 'homey';

export default class DateHandler {

  private static app: Homey.App;

  public static init(app: Homey.App) {
    this.app = app;
  }

  public static getDatePart(partName: string): string {
    const formatter = new Intl.DateTimeFormat([], {
      timeZone: this.app.homey.clock.getTimezone(),
      hour: '2-digit',
      hour12: false,
      weekday: 'long',
      day: '2-digit',
      hourCycle: 'h24',
    });

    const timeParts = formatter.formatToParts(new Date());
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

  public static getDatePartAsNumber(partName: string): number {
    return parseInt(this.getDatePart(partName), 10);
  }

}
