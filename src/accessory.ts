import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  Logger,
} from 'homebridge';

import { SlidePlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SlideAccessory {
  private service: Service;
  private readonly characteristic;

  private readonly name: string;
  private readonly ip: string;
  private readonly identifier: string | null;

  private calibrationTime: number;
  private tolerance: number;
  private pollInterval: number;

  constructor(
    private readonly platform: SlidePlatform,
    private readonly accessory: PlatformAccessory,
    public readonly log: Logger,
  ) {
    this.characteristic = this.platform.Characteristic;

    // extract data from config
    this.name = accessory.context.device.name;
    this.ip = accessory.context.device.ip;
    this.identifier = accessory.context.device.id || null;
    this.tolerance = accessory.context.device.tolerance || 7;
    this.calibrationTime = (accessory.context.device.closingTime || 20) * 1000; // 20 seconds
    this.pollInterval = accessory.context.device.pollInterval || 10;

    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        'Innovation in Motion',
      )
      .setCharacteristic(this.platform.Characteristic.Model, 'Slide')
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        'Default-Serial',
      );

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service =
      this.accessory.getService(this.platform.Service.WindowCovering) ||
      this.accessory.addService(this.platform.Service.WindowCovering);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      this.name,
    );

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/WindowCovering

    this.service
      .getCharacteristic(this.characteristic.CurrentPosition)
      .onGet(this.handleCurrentPositionGet.bind(this));

    this.service
      .getCharacteristic(this.characteristic.PositionState)
      .onGet(this.handlePositionStateGet.bind(this));

    this.service
      .getCharacteristic(this.characteristic.TargetPosition)
      .onGet(this.handleTargetPositionGet.bind(this))
      .onSet(this.handleTargetPositionSet.bind(this));
  }

  /**
   * Calculates difference between two numbers
   * @param first number
   * @param second number
   * @returns number
   */
  calculateDifference(first, second) {
    let difference = first - second;
    if (difference < 0) {
      difference = difference * -1;
    }
    return difference;
  }

  /**
   * Converts HomeKit position to Slide API capable value
   * @param position number
   * @returns number
   */
  homekitPositionToSlideAPI(position) {
    let newPosition = 100 - position;
    newPosition = newPosition / 100;
    return Math.min(Math.max(newPosition, 0), 1);
  }

  /**
   * Converts slide position to HomeKit capable value
   * @param position number
   * @returns number
   */
  slideAPIPositionToHomekit(position) {
    let newPosition = position * 100;
    newPosition = 100 - newPosition;
    return Math.min(Math.max(newPosition, 0), 100);
  }

  getSlideInfo() {
    return this.platform
      .request(
        this.accessory.context.device,
        'GET',
        this.ip ? 'rpc/Slide.GetInfo' : `slide/${this.identifier}/info`,
        false,
        !this.ip,
      )
      .catch((error) => {
        this.log.error(error);
        return error;
      });
  }

  updateSlideInfo() {
    this.getSlideInfo().then((slideInfo: any) => {
      this.log.debug('updateSlideInfo slideInfo', slideInfo);
    });
  }

  /**
   * Handle requests to get the current value of the "Current Position" characteristic
   */
  handleCurrentPositionGet() {
    this.log.debug('Triggered GET CurrentPosition');

    return this.getSlideInfo()
      .then((slideInfo: any) => {
        // this.log.debug('slideInfo', slideInfo);

        const position = this.slideAPIPositionToHomekit(
          slideInfo.pos || slideInfo.data.pos,
        );

        // this.log.debug('position', position);

        return position;
      })
      .catch((error) => {
        this.log.error(error);
        return error;
      });
  }

  /**
   * Handle requests to get the current value of the "Target Position" characteristic
   */
  handleTargetPositionGet() {
    this.log.debug('Triggered GET TargetPosition');

    return this.getSlideInfo()
      .then((slideInfo: any) => {
        let position = this.slideAPIPositionToHomekit(
          slideInfo.pos || slideInfo.data.pos,
        );

        if (this.calculateDifference(position, 100) <= this.tolerance) {
          position = 100;
        } else if (this.calculateDifference(position, 0) <= this.tolerance) {
          position = 0;
        }

        return position;
      })
      .catch((error) => {
        this.log.error(error);
        return error;
      });
  }

  /**
   * Handle requests to set the "Target Position" characteristic
   */
  handleTargetPositionSet(value) {
    this.log.debug('Triggered SET TargetPosition:', value);

    const parameters = {
      pos: this.homekitPositionToSlideAPI(value),
    };

    this.log.debug('parameters', parameters);

    this.platform
      .request(
        this.accessory.context.device,
        'POST',
        this.ip ? 'rpc/Slide.SetPos' : `slide/${this.identifier}/position`,
        parameters,
        !this.ip,
      )
      .then(() => {
        this.log.debug('API returned');
      })
      .catch((error) => {
        this.log.error(error);
        return error;
      });
  }

  /**
   * Handle requests to get the current value of the "Position State" characteristic
   */
  handlePositionStateGet() {
    this.log.debug('Triggered GET PositionState');

    const currentPosition = this.service.getCharacteristic(
      this.characteristic.CurrentPosition,
    ).value;
    const targetPosition = this.service.getCharacteristic(
      this.characteristic.TargetPosition,
    ).value;

    if (targetPosition > currentPosition) {
      return this.characteristic.PositionState.INCREASING;
    } else if (targetPosition < currentPosition) {
      return this.characteristic.PositionState.DECREASING;
    } else {
      return this.characteristic.PositionState.STOPPED;
    }
  }
}
