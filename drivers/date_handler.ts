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
      weekday: 'long',
      hour12: false,
    });

    const timeParts = formatter.formatToParts(new Date());
    return timeParts.find((part) => part.type === partName)!.value;
  }

  public static getDatePartAsNumber(partName: string): number {
    return parseInt(this.getDatePart(partName), 10);
  }

}
