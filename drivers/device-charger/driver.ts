'use strict';

import Homey from 'homey';

module.exports = class Driver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    const conditionCard = this.homey.flow.getConditionCard('device-should-charge');
    conditionCard.registerRunListener(async (args, state): Promise<boolean> => {
      return args.device.shouldChargeCalculator();
    });

    this.log('Device Charger has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    return [
      {
        name: 'Car 1',
        data: {
          id: 'car1',
        },
      },
      {
        name: 'Car 2',
        data: {
          id: 'car2',
        },
      },
      {
        name: 'Car 3',
        data: {
          id: 'car3',
        },
      },
      {
        name: 'Bike',
        data: {
          id: 'bike1',
        },
      },
    ];
  }

};
