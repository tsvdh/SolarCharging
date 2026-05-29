'use strict';

import Homey from 'homey';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import { PriceHandler } from './drivers/price_handler';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import DateHandler from './drivers/date_handler';
// eslint-disable-next-line import/extensions,import/no-unresolved,node/no-missing-import
import Scheduler from './drivers/scheduler';

module.exports = class SmartEnergy extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    DateHandler.init(this);
    Scheduler.init(this);
    await PriceHandler.init(this);

    this.log('Smart Energy has been initialized');
  }

};
